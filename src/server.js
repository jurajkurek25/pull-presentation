import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { openDb, getForm, getQuestions, responseCounts } from './db.js';
import { createUser, currentUser, hashPassword, login, logout, requireUser } from './auth.js';
import { QUESTION_TYPES, SCALE_OPTIONS, classify, computeStats, normalizeValue } from './stats.js';
import { createHub } from './hub.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'static', 'healthz', 'favicon.ico', 'robots.txt']);
const STATUSES = ['draft', 'open', 'closed'];
const MODES = ['survey', 'scored'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

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

function validateQuestions(input, categories) {
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
    return { type: q.type, text, options, scores: validateScores(q.scores, options, categories, n) };
  });
}

function validateToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9-]{16,100}$/.test(token)) fail(400, 'Neplatný token.');
  return token;
}

export function createApp({ db, publicUrl } = {}) {
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
  });
  // Scores stay on the server so respondents can't see which answer leads where.
  const publicQuestions = (formId) => getQuestions(db, formId).map(({ scores, ...q }) => q);
  const livePayload = (formId) => {
    const form = formById(formId);
    if (!form) return null;
    return { form: publicForm(form), questions: publicQuestions(formId), stats: computeStats(db, form) };
  };
  const hub = createHub(livePayload);

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
  app.get('/:slug', (req, res) => {
    if (!formBySlug(req.params.slug)) return res.status(404).sendFile(path.join(pub, '404.html'));
    res.sendFile(path.join(pub, 'present.html'));
  });
  app.get('/:slug/vyplnit', (req, res) => {
    if (!formBySlug(req.params.slug)) return res.status(404).sendFile(path.join(pub, '404.html'));
    res.sendFile(path.join(pub, 'fill.html'));
  });

  // ---------- presentation (public, read-only) ----------
  app.get('/api/p/:slug', async (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    const fillUrl = `${baseUrl(req)}/${form.slug}/vyplnit`;
    const qrSvg = await QRCode.toString(fillUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.json({ ...livePayload(form.id), fillUrl, qrSvg });
  });
  app.get('/api/p/:slug/stream', (req, res) => {
    const form = mustForm(formBySlug(req.params.slug));
    hub.subscribe(form.id, req, res);
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
    const token = validateToken(req.body.token);
    db.transaction(() => {
      const response = openResponse(form, token);
      db.prepare('UPDATE responses SET submitted_at = CURRENT_TIMESTAMP WHERE id = ?').run(response.id);
    })();
    hub.notify(form.id);
    res.json({ ok: true });
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
      .map((f) => ({ ...f, counts: responseCounts(db, f.id) }));
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
    res.json({ form, questions: getQuestions(db, form.id), counts: responseCounts(db, form.id) });
  });
  admin.put('/forms/:id', (req, res) => {
    const form = mustForm(formById(req.params.id));
    const title = validateTitle(req.body.title);
    const slug = validateSlug(req.body.slug);
    const mode = req.body.mode ?? form.mode;
    if (!MODES.includes(mode)) fail(400, 'Neplatný režim.');
    const categories = mode === 'scored' ? validateCategories(req.body.categories ?? form.categories) : [];
    const questions = validateQuestions(req.body.questions, categories);
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
        const update = db.prepare('UPDATE questions SET scores = ? WHERE id = ?');
        existing.forEach((q, i) => update.run(JSON.stringify(questions[i].scores), q.id));
      } else {
        db.prepare('DELETE FROM questions WHERE form_id = ?').run(form.id);
        const insert = db.prepare(
          'INSERT INTO questions (form_id, position, type, text, options, scores) VALUES (?, ?, ?, ?, ?, ?)'
        );
        questions.forEach((q, i) =>
          insert.run(form.id, i, q.type, q.text, JSON.stringify(q.options), JSON.stringify(q.scores))
        );
      }
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
    hub.notify(form.id);
    res.json({ ok: true });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(process.env.DB_FILE || path.join(root, 'data/app.db'));
  const port = Number(process.env.PORT || 3000);
  createApp({ db, publicUrl: process.env.PUBLIC_URL }).listen(port, () => {
    console.log(`Server beží na http://localhost:${port}`);
    if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
      console.log('Zatiaľ neexistuje žiadny admin. Vytvor ho: npm run create-user -- <email> <meno> <heslo>');
    }
  });
}
