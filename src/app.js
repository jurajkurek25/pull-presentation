import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { getForm, getQuestions, responseCounts } from './db.js';
import { createUser, currentUser, hashPassword, login, logout, requireUser } from './auth.js';
import { QUESTION_TYPES, SCALE_OPTIONS, classify, computeStats, normalizeValue } from './stats.js';
import { createHub } from './hub.js';
import { HttpError, fail } from './errors.js';
import {
  QUIZ_DEFAULT_TIME,
  QUIZ_MAX_OPTIONS,
  advanceQuiz,
  answerQuiz,
  joinQuiz,
  playerInfo,
  quizState,
  quizStats,
  resetQuiz,
} from './quiz.js';
import { COLORS, LETTERS, PHASES, consistencyStats, getPicks, isRoundOpen, respondentState as colorState } from './consistency.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'static', 'healthz', 'favicon.ico', 'robots.txt']);
const STATUSES = ['draft', 'open', 'closed'];
const MODES = ['survey', 'scored', 'quiz', 'consistency'];


function validateSlug(slug) {
  slug = String(slug ?? '').trim().toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    fail(400, 'Slovo v adrese môže obsahovať len malé písmená bez diakritiky, čísla a pomlčky (max. 40 znakov).');
  }
  return slug;
}

function validateTitle(title) {
  title = String(title ?? '').trim();
  if (!title || title.length > 200) fail(400, 'Zadaj názov (max. 200 znakov).');
  return title;
}

function validateCategories(input) {
  const categories = (Array.isArray(input) ? input : []).map((c) => String(c).trim()).filter(Boolean);
  if (categories.length < 2 || categories.length > 8) fail(400, 'Test potrebuje 2 až 8 výsledkov (kategórií).');
  if (categories.some((c) => c.length > 60)) fail(400, 'Názov výsledku je dlhší ako 60 znakov.');
  return categories;
}

// Scores: one row per option, one integer per category. Empty for text questions and surveys.
function validateScores(scores, options, categories, n) {
  if (!categories.length || !options.length) return [];
  const ok =
    Array.isArray(scores) &&
    scores.length === options.length &&
    scores.every(
      (row) => Array.isArray(row) && row.length === categories.length && row.every((v) => Number.isInteger(v) && Math.abs(v) <= 100)
    );
  if (!ok) fail(400, `Otázka ${n}: body musia byť celé čísla od -100 do 100 pre každú možnosť a výsledok.`);
  return scores;
}

// Quiz: single choice with 2–4 options, one correct option and a time limit in seconds.
function validateQuizFields(q, options, n) {
  if (q.type !== 'single') fail(400, `Otázka ${n}: v kvíze musí byť typ „Jedna možnosť“.`);
  if (options.length > QUIZ_MAX_OPTIONS) fail(400, `Otázka ${n}: kvíz má najviac ${QUIZ_MAX_OPTIONS} možnosti.`);
  if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= options.length) {
    fail(400, `Otázka ${n}: vyber správnu odpoveď.`);
  }
  const timeLimit = q.timeLimit ?? QUIZ_DEFAULT_TIME;
  if (!Number.isInteger(timeLimit) || timeLimit < 5 || timeLimit > 240) fail(400, `Otázka ${n}: čas musí byť 5 až 240 sekúnd.`);
  return { correct: q.correct, timeLimit };
}

function validateQuestions(input, categories, mode) {
  if (!Array.isArray(input) || input.length > 50) fail(400, 'Neplatný zoznam otázok.');
  return input.map((q, i) => {
    const n = i + 1;
    if (!QUESTION_TYPES.includes(q?.type)) fail(400, `Otázka ${n}: neznámy typ.`);
    const text = String(q.text ?? '').trim();
    if (!text || text.length > 300) fail(400, `Otázka ${n}: zadaj text otázky (max. 300 znakov).`);
    let options = [];
    if (q.type === 'scale') options = SCALE_OPTIONS;
    if (q.type === 'single' || q.type === 'multi') {
      options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean);
      if (options.length < 2 || options.length > 12) fail(400, `Otázka ${n}: zadaj 2 až 12 možností.`);
      if (options.some((o) => o.length > 100)) fail(400, `Otázka ${n}: možnosť je dlhšia ako 100 znakov.`);
    }
    const quiz = mode === 'quiz' ? validateQuizFields(q, options, n) : { correct: null, timeLimit: null };
    return { type: q.type, text, options, scores: validateScores(q.scores, options, categories, n), ...quiz };
  });
}

function validateToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9-]{16,100}$/.test(token)) fail(400, 'Neplatný token.');
  return token;
}

// Wi-Fi QR payload (understood by iOS and Android cameras) for an open network.
const wifiQrText = (ssid) => `WIFI:T:nopass;S:${ssid.replace(/([\\;,:"])/g, '\\$1')};;`;

export function createApp({ db, publicUrl, wifiSsid } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));

  const formBySlug = (slug) => getForm(db, 'slug', String(slug).toLowerCase());
  const formById = (id) => getForm(db, 'id', id);
  const mustForm = (form) => form ?? fail(404, 'Dotazník neexistuje.');
  const hasResponses = (formId) => !!db.prepare('SELECT 1 FROM responses WHERE form_id = ? LIMIT 1').get(formId);
  const baseUrl = (req) => (publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  const publicForm = (form) => ({
    slug: form.slug,
    title: form.title,
    status: form.status,
    mode: form.mode,
    categories: form.categories,
    showQuestions: form.show_questions,
    resultTitle: form.result_title,
    phase: form.phase,
  });
  // Scores and quiz answers stay on the server so respondents can't see which answer leads where.
  const publicQuestions = (formId) => getQuestions(db, formId).map(({ scores, correct, ...q }) => q);
  const livePayload = (formId) => {
    const form = formById(formId);
    if (!form) return null;
    const stats = form.mode === 'consistency' ? consistencyStats(db, formId) : computeStats(db, form);
    if (form.mode === 'quiz') stats.quiz = quizStats(db, form);
    return { form: publicForm(form), questions: publicQuestions(formId), stats };
  };
  const counts = (form) => (form.mode === 'consistency' ? consistencyStats(db, form.id).counts : responseCounts(db, form.id));
  const hub = createHub(livePayload);

  // Reveal the question when its time is up, even if nobody calls the API at that moment.
  const scheduleReveal = (form, state) => {
    if (state.phase !== 'question') return;
    setTimeout(() => {
      const current = formById(form.id);
      if (current) quizState(db, current);
      hub.notify(form.id);
    }, state.deadline - Date.now() + 600).unref();
  };
  const notQuiz = (form) => form.mode === 'quiz' && fail(409, 'Toto je kvíz, odpovedá sa v ňom inak.');
  const mustQuiz = (form) => form.mode === 'quiz' || fail(409, 'Toto nie je kvíz.');

  // ---------- static pages ----------
  app.use('/static', express.static(pub, { maxAge: '1h' }));
  app.get('/static/vendor/chart.umd.min.js', (req, res) =>
    res.sendFile(path.join(root, 'node_modules/chart.js/dist/chart.umd.min.js'))
  );
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.redirect('/admin'));
  app.get('/admin/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
  app.get(['/admin', '/admin/*splat'], (req, res) => {
    if (!currentUser(db, req)) return res.redirect('/admin/login');
    res.sendFile(path.join(pub, 'admin.html'));
  });
  // The consistency test has its own pages; the addresses (and QR codes) stay the same.
  app.get('/:slug', (req, res) => {
    const form = formBySlug(req.params.slug);
    if (!form) return res.status(404).sendFile(path.join(pub, '404.html'));
    res.sendFile(path.join(pub, form.mode === 'consistency' ? 'colors-present.html' : 'present.html'));
  });
  app.get('/:slug/vyplnit', (req, res) => {
    const form = formBySlug(req.params.slug);
    if (!form) return res.status(404).sendFile(path.join(pub, '404.html'));
    const page = { quiz: 'quiz.html', consistency: 'colors-fill.html' }[form.mode] ?? 'fill.html';
    res.sendFile(path.join(pub, page));
  });
  // Consistency test, round 2: the slide that links here starts round 2 when it opens the page.
  app.get('/:slug/kolo2', (req, res) => {
    const form = formBySlug(req.params.slug);
    if (form?.mode !== 'consistency') return res.status(404).sendFile(path.join(pub, '404.html'));
    res.sendFile(path.join(pub, 'colors-present.html'));
  });

  // ---------- presentation (public, read-only) ----------
  app.get('/api/p/:slug', async (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    const fillUrl = `${baseUrl(req)}/${form.slug}/vyplnit`;
    const qrSvg = await QRCode.toString(fillUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    const wifi = wifiSsid
      ? { ssid: wifiSsid, qrSvg: await QRCode.toString(wifiQrText(wifiSsid), { type: 'svg', margin: 1 }) }
      : null;
    res.json({ ...livePayload(form.id), fillUrl, qrSvg, wifi });
  });
  app.get('/api/p/:slug/stream', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    hub.subscribe(form.id, req, res);
  });
  // Moves the consistency test between rounds; the round 2 page does it when it opens,
  // so it needs the presenter to be logged in in that browser.
  app.put('/api/p/:slug/phase', requireUser(db), (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    if (!PHASES.includes(req.body.phase)) fail(400, 'Neplatná fáza.');
    db.prepare('UPDATE forms SET phase = ? WHERE id = ?').run(req.body.phase, form.id);
    hub.notify(form.id);
    res.json({ ok: true });
  });

  // ---------- respondents ----------
  const respondentState = (form, token) => {
    const response = db.prepare('SELECT * FROM responses WHERE form_id = ? AND token = ?').get(form.id, token);
    if (!response) return { answers: {}, submitted: false };
    const answers = {};
    for (const a of db.prepare('SELECT question_id, value FROM answers WHERE response_id = ?').all(response.id)) {
      answers[a.question_id] = JSON.parse(a.value);
    }
    const state = { answers, submitted: !!response.submitted_at };
    if (state.submitted && form.mode === 'scored') {
      const winners = classify(getQuestions(db, form.id), form.categories, answers);
      state.result = winners ? winners.map((c) => form.categories[c]) : null;
    }
    return state;
  };
  const openResponse = (form, token) => {
    if (form.status !== 'open') fail(409, 'Dotazník momentálne neprijíma odpovede.');
    db.prepare('INSERT OR IGNORE INTO responses (form_id, token) VALUES (?, ?)').run(form.id, token);
    const response = db.prepare('SELECT * FROM responses WHERE form_id = ? AND token = ?').get(form.id, token);
    if (response.submitted_at) fail(409, 'Dotazník už bol odovzdaný.');
    return response;
  };

  app.get('/api/f/:slug', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    const state = req.query.token ? respondentState(form, validateToken(req.query.token)) : null;
    res.json({ form: publicForm(form), questions: publicQuestions(form.id), state });
  });
  app.put('/api/f/:slug/answers', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    notQuiz(form);
    const token = validateToken(req.body.token);
    const question = getQuestions(db, form.id).find((q) => q.id === req.body.questionId) ?? fail(400, 'Neznáma otázka.');
    let value;
    try {
      value = normalizeValue(question, req.body.value);
    } catch (e) {
      fail(400, e.message);
    }
    db.transaction(() => {
      const response = openResponse(form, token);
      if (value === null) {
        db.prepare('DELETE FROM answers WHERE response_id = ? AND question_id = ?').run(response.id, question.id);
      } else {
        db.prepare(
          `INSERT INTO answers (response_id, question_id, value) VALUES (?, ?, ?)
           ON CONFLICT (response_id, question_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
        ).run(response.id, question.id, JSON.stringify(value));
      }
    })();
    hub.notify(form.id);
    res.json({ ok: true });
  });
  app.post('/api/f/:slug/submit', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    notQuiz(form);
    const token = validateToken(req.body.token);
    db.transaction(() => {
      const response = openResponse(form, token);
      db.prepare('UPDATE responses SET submitted_at = CURRENT_TIMESTAMP WHERE id = ?').run(response.id);
    })();
    hub.notify(form.id);
    res.json({ ok: true });
  });

  // ---------- quiz players ----------
  app.get('/api/q/:slug/me', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    mustQuiz(form);
    res.json(playerInfo(db, form, validateToken(req.query.token)));
  });
  app.post('/api/q/:slug/join', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    mustQuiz(form);
    const name = joinQuiz(db, form, validateToken(req.body.token), req.body.name);
    hub.notify(form.id);
    res.json({ name });
  });
  app.post('/api/q/:slug/answer', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    mustQuiz(form);
    answerQuiz(db, form, validateToken(req.body.token), req.body.index, req.body.choice);
    hub.notify(form.id);
    res.json({ ok: true });
  });

  // ---------- consistency test (respondents) ----------
  const colorForm = (slug) => {
    const form = mustForm(formBySlug(slug));
    if (form.mode !== 'consistency') fail(404, 'Toto nie je test konzistencie.');
    return form;
  };
  app.get('/api/k/:slug', (req, res) => {
    const form = colorForm(req.params.slug);
    const response = req.query.token
      ? db.prepare('SELECT id FROM responses WHERE form_id = ? AND token = ?').get(form.id, validateToken(req.query.token))
      : null;
    const state = colorState(response ? getPicks(db, response.id) : { 1: {}, 2: {} });
    res.json({ form: publicForm(form), letters: LETTERS, colors: COLORS, state });
  });
  app.put('/api/k/:slug/pick', (req, res) => {
    const form = colorForm(req.params.slug);
    const token = validateToken(req.body.token);
    const { round, letter, color } = req.body;
    if (![1, 2].includes(round) || !LETTERS.includes(letter) || !Number.isInteger(color) || color < 0 || color >= COLORS.length) {
      fail(400, 'Neplatná odpoveď.');
    }
    const picks = db.transaction(() => {
      if (form.status !== 'open') fail(409, 'Test momentálne neprijíma odpovede.');
      db.prepare('INSERT OR IGNORE INTO responses (form_id, token) VALUES (?, ?)').run(form.id, token);
      const { id } = db.prepare('SELECT id FROM responses WHERE form_id = ? AND token = ?').get(form.id, token);
      if (!isRoundOpen(form, getPicks(db, id), round)) fail(409, 'Toto kolo je pre teba uzavreté.');
      db.prepare(
        `INSERT INTO color_picks (response_id, round, letter, color) VALUES (?, ?, ?, ?)
         ON CONFLICT (response_id, round, letter) DO UPDATE SET color = excluded.color`
      ).run(id, round, letter, color);
      return getPicks(db, id);
    })();
    hub.notify(form.id);
    res.json({ state: colorState(picks) });
  });

  // ---------- auth ----------
  app.post('/api/auth/login', (req, res) => {
    const user = login(db, req, res, req.body.email ?? '', req.body.password ?? '');
    if (!user) fail(401, 'Nesprávny e-mail alebo heslo.');
    res.json({ user });
  });
  app.post('/api/auth/logout', (req, res) => {
    logout(db, req, res);
    res.json({ ok: true });
  });

  // ---------- admin ----------
  const admin = express.Router();
  admin.use(requireUser(db));
  admin.get('/me', (req, res) => res.json({ user: req.user }));

  admin.get('/forms', (req, res) => {
    const forms = db
      .prepare(
        `SELECT f.id, f.slug, f.title, f.status, f.mode, f.created_at, u.name AS created_by_name
         FROM forms f LEFT JOIN users u ON u.id = f.created_by ORDER BY f.id DESC`
      )
      .all()
      .map((f) => ({ ...f, counts: counts(f) }));
    res.json({ forms });
  });
  admin.post('/forms', (req, res) => {
    const title = validateTitle(req.body.title);
    const slug = validateSlug(req.body.slug);
    if (formBySlug(slug)) fail(409, 'Toto slovo v adrese už je obsadené.');
    const info = db.prepare('INSERT INTO forms (slug, title, created_by) VALUES (?, ?, ?)').run(slug, title, req.user.id);
    res.status(201).json({ id: info.lastInsertRowid });
  });
  admin.get('/forms/:id', (req, res) => {
    const form = mustForm(formById(req.params.id));
    res.json({ form, questions: getQuestions(db, form.id), counts: counts(form) });
  });
  admin.put('/forms/:id', (req, res) => {
    const form = mustForm(formById(req.params.id));
    const title = validateTitle(req.body.title);
    const slug = validateSlug(req.body.slug);
    const mode = req.body.mode ?? form.mode;
    if (!MODES.includes(mode)) fail(400, 'Neplatný režim.');
    const categories = mode === 'scored' ? validateCategories(req.body.categories ?? form.categories) : [];
    const questions = validateQuestions(req.body.questions, categories, mode);
    const resultTitle = String(req.body.resultTitle ?? form.result_title).trim();
    if (resultTitle.length > 200) fail(400, 'Nadpis výsledkov môže mať max. 200 znakov.');
    const other = formBySlug(slug);
    if (other && other.id !== form.id) fail(409, 'Toto slovo v adrese už je obsadené.');

    // Scores and results may change any time (they're recomputed); the questions themselves may not.
    const structure = (qs) => JSON.stringify(qs.map(({ type, text, options }) => ({ type, text, options })));
    const existing = getQuestions(db, form.id);
    if (structure(existing) !== structure(questions) && hasResponses(form.id)) {
      fail(409, 'Dotazník už má odpovede. Otázky môžeš meniť až po vymazaní odpovedí.');
    }
    db.transaction(() => {
      db.prepare(
        'UPDATE forms SET title = ?, slug = ?, mode = ?, categories = ?, show_questions = ?, result_title = ? WHERE id = ?'
      ).run(
        title,
        slug,
        mode,
        JSON.stringify(categories),
        (req.body.showQuestions ?? form.show_questions) ? 1 : 0,
        resultTitle,
        form.id
      );
      if (structure(existing) === structure(questions)) {
        const update = db.prepare('UPDATE questions SET scores = ?, correct = ?, time_limit = ? WHERE id = ?');
        existing.forEach((q, i) =>
          update.run(JSON.stringify(questions[i].scores), questions[i].correct, questions[i].timeLimit, q.id)
        );
      } else {
        db.prepare('DELETE FROM questions WHERE form_id = ?').run(form.id);
        const insert = db.prepare(
          'INSERT INTO questions (form_id, position, type, text, options, scores, correct, time_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        questions.forEach((q, i) =>
          insert.run(form.id, i, q.type, q.text, JSON.stringify(q.options), JSON.stringify(q.scores), q.correct, q.timeLimit)
        );
      }
      if (mode !== form.mode || structure(existing) !== structure(questions)) resetQuiz(db, form);
    })();
    hub.notify(form.id);
    res.json({ ok: true });
  });
  admin.put('/forms/:id/status', (req, res) => {
    const form = mustForm(formById(req.params.id));
    if (!STATUSES.includes(req.body.status)) fail(400, 'Neplatný stav.');
    db.prepare('UPDATE forms SET status = ? WHERE id = ?').run(req.body.status, form.id);
    hub.notify(form.id);
    res.json({ ok: true });
  });
  admin.delete('/forms/:id/responses', (req, res) => {
    const form = mustForm(formById(req.params.id));
    db.prepare('DELETE FROM responses WHERE form_id = ?').run(form.id);
    resetQuiz(db, form);
    db.prepare("UPDATE forms SET phase = 'round1' WHERE id = ?").run(form.id);
    hub.notify(form.id);
    res.json({ ok: true });
  });
  // The presenter's arrow key moves the quiz on; only a signed-in admin can do that.
  admin.post('/quiz/:slug/next', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    mustQuiz(form);
    const state = advanceQuiz(db, form);
    scheduleReveal(form, state);
    hub.notify(form.id);
    res.json({ state });
  });
  admin.delete('/forms/:id', (req, res) => {
    const form = mustForm(formById(req.params.id));
    db.prepare('DELETE FROM forms WHERE id = ?').run(form.id);
    res.json({ ok: true });
  });

  admin.get('/users', (req, res) => {
    res.json({ users: db.prepare('SELECT id, email, name, created_at FROM users ORDER BY id').all() });
  });
  admin.post('/users', (req, res) => {
    const email = String(req.body.email ?? '').trim();
    const name = String(req.body.name ?? '').trim();
    const password = String(req.body.password ?? '');
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !name) fail(400, 'Zadaj meno a platný e-mail.');
    if (password.length < 8) fail(400, 'Heslo musí mať aspoň 8 znakov.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase())) fail(409, 'Používateľ s týmto e-mailom už existuje.');
    res.status(201).json({ id: createUser(db, { email, name, password }) });
  });
  admin.delete('/users/:id', (req, res) => {
    if (Number(req.params.id) === req.user.id) fail(400, 'Nemôžeš zmazať sám seba.');
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  admin.put('/me/password', (req, res) => {
    const password = String(req.body.password ?? '');
    if (password.length < 8) fail(400, 'Heslo musí mať aspoň 8 znakov.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
    res.json({ ok: true });
  });
  app.use('/api/admin', admin);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Nenájdené' }));
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Neplatné JSON dáta.' });
    console.error(err);
    res.status(500).json({ error: 'Chyba servera' });
  });
  return app;
}
