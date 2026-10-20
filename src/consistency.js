// "Test konzistencie": every respondent picks a colour for each letter twice (round 1 early in the
// talk, round 2 at the end, letters in a different order) and scores how many letters got the
// same colour both times.
export const LETTERS = ['A', 'B', 'D', 'E', 'H', 'M', 'R', 'S', 'T'];
export const COLORS = [
  { name: 'červená', hex: '#dc2626' },
  { name: 'oranžová', hex: '#f97316' },
  { name: 'žltá', hex: '#facc15' },
  { name: 'zelená', hex: '#16a34a' },
  { name: 'modrá', hex: '#2563eb' },
  { name: 'fialová', hex: '#9333ea' },
  { name: 'hnedá', hex: '#92400e' },
  { name: 'sivá', hex: '#9ca3af' },
];
// round1: round 1 is open. break: round 1 is over on the slides, late phones may still finish it.
// round2: round 2 is open for those who finished round 1; round 1 is closed.
export const PHASES = ['round1', 'break', 'round2'];

export const isComplete = (roundPicks) => Object.keys(roundPicks).length === LETTERS.length;
const matches = (picks) => LETTERS.filter((l) => picks[1][l] === picks[2][l]).length;

// { 1: { letter: colorIndex }, 2: { ... } }
export function getPicks(db, responseId) {
  const picks = { 1: {}, 2: {} };
  for (const p of db.prepare('SELECT round, letter, color FROM color_picks WHERE response_id = ?').all(responseId)) {
    picks[p.round][p.letter] = p.color;
  }
  return picks;
}

export function isRoundOpen(form, picks, round) {
  if (isComplete(picks[round])) return false;
  return round === 1 ? form.phase !== 'round2' : form.phase === 'round2' && isComplete(picks[1]);
}

// Round 1 colours stay on the server until round 2 is finished, so they can't be looked up in between.
export function respondentState(picks) {
  const done = [isComplete(picks[1]), isComplete(picks[2])];
  return {
    done,
    picks: { 1: done[0] && !done[1] ? {} : picks[1], 2: picks[2] },
    matches: done[1] ? matches(picks) : null,
  };
}

// Per-round progress and the class histogram: histogram[k] = respondents with k matching letters.
export function consistencyStats(db, formId) {
  const byResponse = new Map();
  const rows = db
    .prepare(
      `SELECT p.response_id AS rid, p.round, p.letter, p.color
       FROM color_picks p JOIN responses r ON r.id = p.response_id WHERE r.form_id = ?`
    )
    .all(formId);
  for (const p of rows) {
    if (!byResponse.has(p.rid)) byResponse.set(p.rid, { 1: {}, 2: {} });
    byResponse.get(p.rid)[p.round][p.letter] = p.color;
  }
  const rounds = [{ done: 0, inProgress: 0 }, { done: 0, inProgress: 0 }];
  const histogram = Array(LETTERS.length + 1).fill(0);
  for (const picks of byResponse.values()) {
    [1, 2].forEach((r) => {
      if (isComplete(picks[r])) rounds[r - 1].done++;
      else if (Object.keys(picks[r]).length) rounds[r - 1].inProgress++;
    });
    if (isComplete(picks[2])) histogram[matches(picks)]++;
  }
  // "submitted" = finished both rounds, the rest who started count as in progress (admin list).
  const counts = { submitted: rounds[1].done, inProgress: byResponse.size - rounds[1].done };
  return { counts, rounds, histogram };
}
