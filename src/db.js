import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS forms (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY,
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY,
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      submitted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (form_id, token)
    );
    CREATE TABLE IF NOT EXISTS answers (
      response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (response_id, question_id)
    );
    CREATE TABLE IF NOT EXISTS color_picks (
      response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      letter TEXT NOT NULL,
      color INTEGER NOT NULL,
      PRIMARY KEY (response_id, round, letter)
    );
  `);
  // Columns added after the first release (scored "test" mode).
  addColumn(db, 'forms', 'mode', "TEXT NOT NULL DEFAULT 'survey'");
  addColumn(db, 'forms', 'categories', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, 'forms', 'show_questions', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'questions', 'scores', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, 'forms', 'result_title', "TEXT NOT NULL DEFAULT ''");
  // Quiz mode.
  addColumn(db, 'forms', 'quiz_state', `TEXT NOT NULL DEFAULT '{"phase":"lobby"}'`);
  addColumn(db, 'questions', 'correct', 'INTEGER');
  addColumn(db, 'questions', 'time_limit', 'INTEGER');
  addColumn(db, 'responses', 'name', 'TEXT');
  addColumn(db, 'answers', 'points', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'forms', 'phase', "TEXT NOT NULL DEFAULT 'round1'"); // consistency test
  return db;
}

function addColumn(db, table, column, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getForm(db, where, value) {
  const form = db.prepare(`SELECT * FROM forms WHERE ${where} = ?`).get(value);
  if (form) {
    form.categories = JSON.parse(form.categories);
    form.show_questions = !!form.show_questions;
  }
  return form;
}

export function getQuestions(db, formId) {
  return db
    .prepare('SELECT id, type, text, options, scores, correct, time_limit FROM questions WHERE form_id = ? ORDER BY position')
    .all(formId)
    .map((q) => ({ ...q, options: JSON.parse(q.options), scores: JSON.parse(q.scores) }));
}

export function responseCounts(db, formId) {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE submitted_at IS NOT NULL) AS submitted,
         COUNT(*) FILTER (WHERE submitted_at IS NULL
           AND EXISTS (SELECT 1 FROM answers a WHERE a.response_id = r.id)) AS inProgress
       FROM responses r WHERE form_id = ?`
    )
    .get(formId);
  return { submitted: row.submitted, inProgress: row.inProgress };
}
