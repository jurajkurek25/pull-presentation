import { getQuestions } from './db.js';
import { fail } from './errors.js';

// Quiz flow driven by the presenter: lobby → question → reveal → leaderboard → question … → final.
export const QUIZ_DEFAULT_TIME = 20;
export const QUIZ_MAX_OPTIONS = 4;
const GRACE_MS = 500; // network delay allowance after the deadline
const LEADERBOARD_SIZE = 5;
const LOBBY_NAMES = 60;
const REVEALED = ['reveal', 'leaderboard'];

function saveState(db, form, state) {
  form.quiz_state = JSON.stringify(state);
  db.prepare('UPDATE forms SET quiz_state = ? WHERE id = ?').run(form.quiz_state, form.id);
  return state;
}

export function quizState(db, form) {
  const state = JSON.parse(form.quiz_state);
  // Time ran out (also covers a server restart mid-question): reveal on first read.
  if (state.phase === 'question' && Date.now() > state.deadline + GRACE_MS) {
    return saveState(db, form, { phase: 'reveal', index: state.index });
  }
  return state;
}

export function resetQuiz(db, form) {
  return saveState(db, form, { phase: 'lobby' });
}

function startQuestion(db, form, index) {
  const question = getQuestions(db, form.id)[index];
  const startedAt = Date.now();
  const deadline = startedAt + (question.time_limit ?? QUIZ_DEFAULT_TIME) * 1000;
  return saveState(db, form, { phase: 'question', index, startedAt, deadline });
}

export function advanceQuiz(db, form) {
  const state = quizState(db, form);
  const count = getQuestions(db, form.id).length;
  if (!count) fail(409, 'Kvíz nemá žiadne otázky.');
  switch (state.phase) {
    case 'lobby':
      return startQuestion(db, form, 0);
    case 'question':
      return saveState(db, form, { phase: 'reveal', index: state.index });
    case 'reveal':
      return saveState(db, form, state.index + 1 < count ? { phase: 'leaderboard', index: state.index } : { phase: 'final' });
    case 'leaderboard':
      return startQuestion(db, form, state.index + 1);
    default:
      return state;
  }
}

function scores(db, formId) {
  return db
    .prepare(
      `SELECT r.id, r.name, COALESCE(SUM(a.points), 0) AS score
       FROM responses r LEFT JOIN answers a ON a.response_id = r.id
       WHERE r.form_id = ? AND r.name IS NOT NULL
       GROUP BY r.id ORDER BY score DESC, r.id`
    )
    .all(formId);
}

const playerCount = (db, formId) =>
  db.prepare('SELECT COUNT(*) AS n FROM responses WHERE form_id = ? AND name IS NOT NULL').get(formId).n;

export function joinQuiz(db, form, token, rawName) {
  if (form.status !== 'open') fail(409, 'Kvíz momentálne neprijíma hráčov.');
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 20) fail(400, 'Zadaj prezývku (max. 20 znakov).');
  const existing = db.prepare('SELECT * FROM responses WHERE form_id = ? AND token = ?').get(form.id, token);
  if (existing?.name) return existing.name;
  const taken = db
    .prepare('SELECT 1 FROM responses WHERE form_id = ? AND lower(name) = lower(?)')
    .get(form.id, name);
  if (taken) fail(409, 'Túto prezývku už niekto má, vyber si inú.');
  db.prepare(
    `INSERT INTO responses (form_id, token, name) VALUES (?, ?, ?)
     ON CONFLICT (form_id, token) DO UPDATE SET name = excluded.name`
  ).run(form.id, token, name);
  return name;
}

// Kahoot-style points: 1000 for an instant correct answer, down to 500 at the deadline.
export function answerQuiz(db, form, token, index, choice) {
  if (form.status !== 'open') fail(409, 'Kvíz momentálne neprijíma odpovede.');
  const state = quizState(db, form);
  if (state.phase !== 'question' || state.index !== index) fail(409, 'Na túto otázku sa už nedá odpovedať.');
  const response = db.prepare('SELECT * FROM responses WHERE form_id = ? AND token = ?').get(form.id, token);
  if (!response?.name) fail(409, 'Najprv sa pripoj do hry.');
  const question = getQuestions(db, form.id)[index];
  if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length) fail(400, 'Neplatná odpoveď.');

  const limitMs = state.deadline - state.startedAt;
  const elapsed = Math.min(Math.max(Date.now() - state.startedAt, 0), limitMs);
  const points = choice === question.correct ? Math.round(1000 * (1 - elapsed / limitMs / 2)) : 0;
  const inserted = db
    .prepare('INSERT OR IGNORE INTO answers (response_id, question_id, value, points) VALUES (?, ?, ?, ?)')
    .run(response.id, question.id, JSON.stringify(choice), points);
  if (!inserted.changes) fail(409, 'Na túto otázku už máš odpoveď.');

  // Everybody answered: no need to wait for the timer.
  const answered = db.prepare('SELECT COUNT(*) AS n FROM answers WHERE question_id = ?').get(question.id).n;
  if (answered >= playerCount(db, form.id)) saveState(db, form, { phase: 'reveal', index });
}

// What the presentation and the phones see. The correct option is only included once revealed.
export function quizStats(db, form) {
  const state = quizState(db, form);
  const questions = getQuestions(db, form.id);
  const players = db
    .prepare('SELECT name FROM responses WHERE form_id = ? AND name IS NOT NULL ORDER BY id DESC LIMIT ?')
    .all(form.id, LOBBY_NAMES)
    .map((r) => r.name)
    .reverse();
  const stats = { state, serverNow: Date.now(), players: playerCount(db, form.id), names: players, total: questions.length };

  const question = questions[state.index];
  if (question && state.phase !== 'lobby' && state.phase !== 'final') {
    const counts = question.options.map(() => 0);
    for (const a of db.prepare('SELECT value FROM answers WHERE question_id = ?').all(question.id)) {
      counts[JSON.parse(a.value)]++;
    }
    stats.answered = counts.reduce((x, y) => x + y, 0);
    if (REVEALED.includes(state.phase)) {
      stats.counts = counts;
      stats.correct = question.correct;
    }
  }
  if (state.phase === 'leaderboard' || state.phase === 'final') {
    stats.leaderboard = scores(db, form.id)
      .slice(0, LEADERBOARD_SIZE)
      .map(({ name, score }) => ({ name, score }));
  }
  return stats;
}

// A player's own view: score, rank and how their answer to the current question went.
export function playerInfo(db, form, token) {
  const response = db.prepare('SELECT * FROM responses WHERE form_id = ? AND token = ?').get(form.id, token);
  if (!response?.name) return { joined: false };
  const state = quizState(db, form);
  const all = scores(db, form.id);
  const me = all.findIndex((s) => s.id === response.id);
  const info = { joined: true, name: response.name, score: all[me].score, rank: me + 1, players: all.length };

  const question = getQuestions(db, form.id)[state.index];
  if (question) {
    const answer = db
      .prepare('SELECT value, points FROM answers WHERE response_id = ? AND question_id = ?')
      .get(response.id, question.id);
    info.answered = !!answer;
    if (REVEALED.includes(state.phase)) {
      info.correct = !!answer && JSON.parse(answer.value) === question.correct;
      info.points = answer?.points ?? 0;
    }
  }
  return info;
}
