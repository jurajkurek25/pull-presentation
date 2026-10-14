import { getQuestions, responseCounts } from './db.js';

export const QUESTION_TYPES = ['single', 'multi', 'scale', 'text'];
export const SCALE_OPTIONS = ['1', '2', '3', '4', '5'];
const MAX_TEXT = 500;
const MAX_TEXT_ITEMS = 60;

// Returns the normalized value to store, null to delete the answer, or throws on invalid input.
export function normalizeValue(question, value) {
  if (value === null || value === undefined) return null;
  const inRange = (v) => Number.isInteger(v) && v >= 0 && v < question.options.length;
  switch (question.type) {
    case 'single':
    case 'scale':
      if (!inRange(value)) throw new Error('Neplatná odpoveď');
      return value;
    case 'multi': {
      if (!Array.isArray(value) || !value.every(inRange)) throw new Error('Neplatná odpoveď');
      const unique = [...new Set(value)].sort((a, b) => a - b);
      return unique.length ? unique : null;
    }
    case 'text': {
      if (typeof value !== 'string') throw new Error('Neplatná odpoveď');
      const text = value.trim().slice(0, MAX_TEXT);
      return text || null;
    }
  }
  throw new Error('Neznámy typ otázky');
}

// Sums a respondent's points per category. Returns null when none of their answers is scored,
// otherwise the indexes of the winning categories (more than one = tie).
export function classify(questions, categories, answers) {
  const totals = categories.map(() => 0);
  let scored = 0;
  for (const q of questions) {
    if (!q.scores.length || answers[q.id] === undefined) continue;
    scored++;
    for (const option of [answers[q.id]].flat()) {
      q.scores[option]?.forEach((points, c) => (totals[c] += points));
    }
  }
  if (!scored) return null;
  const max = Math.max(...totals);
  return totals.flatMap((t, c) => (t === max ? [c] : []));
}

// Aggregates answers per question, split into submitted ("final") and still-editable ("pending").
// For scored forms also tallies each respondent's result; the extra last slot counts ties.
export function computeStats(db, form) {
  const questions = getQuestions(db, form.id);
  const rows = db
    .prepare(
      `SELECT a.response_id AS rid, a.question_id AS qid, a.value, r.submitted_at IS NOT NULL AS final
       FROM answers a JOIN responses r ON r.id = a.response_id
       WHERE r.form_id = ? ORDER BY a.updated_at DESC, a.rowid DESC`
    )
    .all(form.id);

  const byQuestion = new Map(
    questions.map((q) => [
      q.id,
      q.type === 'text'
        ? { id: q.id, items: [], total: 0 }
        : { id: q.id, final: q.options.map(() => 0), pending: q.options.map(() => 0), answered: 0 },
    ])
  );
  const byResponse = new Map(); // response id -> { final, answers }

  for (const row of rows) {
    const s = byQuestion.get(row.qid);
    if (!s) continue;
    const value = JSON.parse(row.value);
    if (!byResponse.has(row.rid)) byResponse.set(row.rid, { final: !!row.final, answers: {} });
    byResponse.get(row.rid).answers[row.qid] = value;
    if (s.items) {
      s.total++;
      if (s.items.length < MAX_TEXT_ITEMS) s.items.push({ text: value, final: !!row.final });
      continue;
    }
    s.answered++;
    const bucket = row.final ? s.final : s.pending;
    for (const i of Array.isArray(value) ? value : [value]) {
      if (i < bucket.length) bucket[i]++;
    }
  }

  const stats = { counts: responseCounts(db, form.id), questions: [...byQuestion.values()] };
  if (form.mode === 'scored') {
    const zeros = () => [...form.categories.map(() => 0), 0];
    const result = { final: zeros(), pending: zeros() };
    for (const { final, answers } of byResponse.values()) {
      const winners = classify(questions, form.categories, answers);
      if (!winners) continue;
      const slot = winners.length === 1 ? winners[0] : form.categories.length;
      (final ? result.final : result.pending)[slot]++;
    }
    stats.result = result;
  }
  return stats;
}
