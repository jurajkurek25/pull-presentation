// Respondent form: every change is saved immediately so the presentation updates live.
const slug = location.pathname.split('/')[1];
const $ = (id) => document.getElementById(id);
const api = `/api/f/${encodeURIComponent(slug)}`;
const tokenKey = `pp:${slug}`;
// TEMPORARY for testing: lets the same browser fill in the form again after submitting.
// Set back to false to restore the one-response-per-browser protection.
const ALLOW_REPEAT = true;

function getToken() {
  const key = tokenKey;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
  } catch {}
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(key, token);
  } catch {}
  return token;
}
const token = getToken();

let questions = [];
let answers = {};
let locked = false;

async function load() {
  const res = await fetch(`${api}?token=${token}`);
  if (!res.ok) return ($('title').textContent = 'Dotazník neexistuje');
  const data = await res.json();
  questions = data.questions;
  answers = data.state.answers;
  document.title = data.form.title;
  $('title').textContent = data.form.title;

  const notice = $('notice');
  notice.hidden = true;
  locked = data.state.submitted || data.form.status !== 'open';
  if (data.state.submitted) {
    notice.innerHTML = '<h2>Ďakujeme!</h2><p class="muted">Tvoje odpovede boli odovzdané. Výsledky sleduj na plátne.</p>';
    const result = data.state.result;
    if (result?.length) {
      const p = document.createElement('p');
      p.className = 'result';
      p.append(result.length === 1 ? 'Tvoj výsledok: ' : 'Si na pomedzí: ');
      result.forEach((name, i) => {
        if (i) p.append(' / ');
        p.append(Object.assign(document.createElement('b'), { textContent: name }));
      });
      notice.querySelector('h2').after(p);
    }
    if (ALLOW_REPEAT) {
      const again = Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Vyplniť znova' });
      again.addEventListener('click', () => {
        try {
          localStorage.removeItem(tokenKey);
        } catch {}
        location.reload();
      });
      notice.append(again);
    }
    notice.hidden = false;
  } else if (data.form.status === 'draft') {
    notice.innerHTML = '<h2>Dotazník ešte nie je otvorený</h2><p class="muted">Stránka sa sama obnoví, keď sa otvorí.</p>';
    notice.hidden = false;
    setTimeout(load, 3000);
  } else if (data.form.status === 'closed') {
    notice.innerHTML = '<h2>Dotazník je uzavretý</h2><p class="muted">Odpovede sa už neprijímajú.</p>';
    notice.hidden = false;
  }
  $('questions').classList.toggle('locked', locked);
  $('actions').hidden = locked;
  render();
}

function render() {
  const container = $('questions');
  container.replaceChildren(
    ...(locked && !Object.keys(answers).length ? [] : questions.map((q, i) => renderQuestion(q, i)))
  );
}

function renderQuestion(q, index) {
  const card = document.createElement('div');
  card.className = 'card';
  const h = document.createElement('h2');
  h.textContent = `${index + 1}. ${q.text}`;
  card.append(h);

  if (q.type === 'text') {
    const ta = document.createElement('textarea');
    ta.maxLength = 500;
    ta.placeholder = 'Tvoja odpoveď…';
    ta.value = answers[q.id] ?? '';
    ta.disabled = locked;
    let timer;
    const commit = () => {
      clearTimeout(timer);
      const value = ta.value.trim() || null;
      if (value !== (answers[q.id] ?? null)) setAnswer(q.id, value);
    };
    ta.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(commit, 500);
    });
    ta.addEventListener('change', commit);
    card.append(ta);
    return card;
  }

  if (q.type === 'scale') {
    const row = document.createElement('div');
    row.className = 'scale';
    q.options.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', answers[q.id] === i);
      b.addEventListener('click', () => {
        setAnswer(q.id, answers[q.id] === i ? null : i);
        render();
      });
      row.append(b);
    });
    const legend = document.createElement('div');
    legend.className = 'scale-legend';
    legend.innerHTML = '<span>najmenej</span><span>najviac</span>';
    card.append(row, legend);
    return card;
  }

  const list = document.createElement('div');
  list.className = 'choices';
  if (q.type === 'multi') {
    const hint = document.createElement('p');
    hint.className = 'muted small';
    hint.textContent = 'Môžeš vybrať viac možností.';
    card.append(hint);
  }
  q.options.forEach((label, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `choice ${q.type}`;
    const selected = q.type === 'multi' ? (answers[q.id] ?? []).includes(i) : answers[q.id] === i;
    b.setAttribute('aria-pressed', selected);
    b.innerHTML = '<span class="mark"></span><span></span>';
    b.lastChild.textContent = label;
    b.addEventListener('click', () => {
      if (q.type === 'multi') {
        const set = new Set(answers[q.id] ?? []);
        set.has(i) ? set.delete(i) : set.add(i);
        setAnswer(q.id, set.size ? [...set].sort((a, b) => a - b) : null);
      } else {
        setAnswer(q.id, answers[q.id] === i ? null : i);
      }
      render();
    });
    list.append(b);
  });
  card.append(list);
  return card;
}

// ---------- saving: latest value per question, sent one request at a time ----------
const queue = new Map();
let flushing = null;

function setAnswer(questionId, value) {
  if (value === null) delete answers[questionId];
  else answers[questionId] = value;
  queue.set(questionId, value);
  $('saved').textContent = 'Ukladám…';
  flushing ??= flush().finally(() => (flushing = null));
}

async function flush() {
  while (queue.size) {
    const [questionId, value] = queue.entries().next().value;
    queue.delete(questionId);
    try {
      const res = await fetch(`${api}/answers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, questionId, value }),
      });
      if (res.status === 409) {
        queue.clear();
        return load();
      }
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (e) {
      if (!queue.has(questionId)) queue.set(questionId, value);
      $('saved').textContent = 'Nepodarilo sa uložiť, skúšam znova…';
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  $('saved').textContent = 'Uložené ✓';
}

$('submit').addEventListener('click', async () => {
  // Text answers are saved after a short pause; push any pending text right away.
  document.querySelectorAll('textarea').forEach((ta) => ta.dispatchEvent(new Event('change')));
  const missing = questions.filter((q) => answers[q.id] === undefined).length;
  const word = missing === 1 ? 'otázku' : missing < 5 ? 'otázky' : 'otázok';
  if (missing && !confirm(`Chýba odpoveď na ${missing} ${word}. Odovzdať aj tak?`)) return;
  $('submit').disabled = true;
  await flushing;
  const res = await fetch(`${api}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  $('submit').disabled = false;
  if (!res.ok && res.status !== 409) return alert((await res.json()).error);
  window.scrollTo(0, 0);
  load();
});

load();
