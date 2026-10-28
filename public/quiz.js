// Quiz player (phone): nickname → coloured answer tiles per question → result after each reveal.
const slug = location.pathname.split('/')[1];
const screen = document.getElementById('screen');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function getToken() {
  const key = `pp:${slug}`;
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

let payload = null; // latest live payload from the server
let me = null; // { joined, name, score, rank, players, answered, correct, points }
let clockOffset = 0; // server time - local time
let viewKey = '';
let error = '';

async function api(method, path, body) {
  const res = await fetch(`/api/q/${encodeURIComponent(slug)}/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Chyba');
  return data;
}

async function refreshMe() {
  me = await api('GET', `me?token=${token}`);
  render();
}

function quiz() {
  return payload?.stats.quiz;
}

function remainingSeconds() {
  const state = quiz()?.state;
  if (state?.phase !== 'question') return 0;
  return Math.max(0, Math.ceil((state.deadline - (Date.now() + clockOffset)) / 1000));
}

function render() {
  if (!payload || !me) return;
  const q = quiz();
  const { phase, index } = q.state;
  const key = JSON.stringify([payload.form.status, me, phase, index, error]);
  if (key === viewKey) return;
  viewKey = key;
  const err = error ? `<p class="quiz-error">${esc(error)}</p>` : '';

  if (!me.joined) {
    if (payload.form.status !== 'open') return center('<h1>Kvíz ešte nezačal</h1><p>Počkaj, kým ho otvoríme.</p>');
    center(`<h1>${esc(payload.form.title)}</h1><p>Zadaj prezývku a hraj</p>
      <form class="quiz-join"><input name="name" maxlength="20" placeholder="Prezývka" autocomplete="off" required>
      <button>Hrať</button></form>${err}`);
    screen.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        error = '';
        await api('POST', 'join', { token, name: e.target.name.value });
        await refreshMe();
      } catch (ex) {
        error = ex.message;
        viewKey = '';
        render();
      }
    });
    return;
  }

  const score = `<p class="quiz-score">${esc(me.name)} · ${me.score} bodov${me.rank ? ` · ${me.rank}. miesto z ${me.players}` : ''}</p>`;
  if (phase === 'lobby') return center(`<h1>Si v hre!</h1><p>Pozri sa na plátno, kvíz čoskoro začne.</p><p class="quiz-score">${esc(me.name)}</p>`);
  if (phase === 'final') {
    return center(`<h1>Koniec kvízu</h1><div class="quiz-result ${me.rank === 1 ? 'ok' : 'none'}">
      <div class="big">${me.rank}. miesto</div><p>${me.score} bodov</p></div><p>${esc(me.name)}</p>`);
  }

  const question = payload.questions[index];
  if (phase === 'question') {
    if (me.answered) return center(`<h1>Odpoveď odoslaná</h1><p>Čakáme na ostatných…</p>${score}`);
    screen.innerHTML = `<div class="quiz-top"><span>Otázka ${index + 1}/${q.total}</span><span class="quiz-timer" id="timer">${remainingSeconds()}</span></div>
      <p class="quiz-question">${esc(question.text)}</p>${err}
      <div class="quiz-tiles ${question.options.length === 2 ? 'two' : ''}">${question.options
        .map((o, i) => `<button class="quiz-tile" data-i="${i}" style="background:${QUIZ_SHAPES[i].color}">${QUIZ_SHAPES[i].svg}<span>${esc(o)}</span></button>`)
        .join('')}</div>`;
    screen.querySelectorAll('.quiz-tile').forEach((b) =>
      b.addEventListener('click', async () => {
        screen.querySelectorAll('.quiz-tile').forEach((t) => (t.disabled = true));
        try {
          error = '';
          await api('POST', 'answer', { token, index, choice: Number(b.dataset.i) });
        } catch (ex) {
          error = ex.message;
        }
        await refreshMe();
      })
    );
    return;
  }

  // reveal / leaderboard: how did my answer go?
  const result = !me.answered
    ? `<div class="quiz-result none"><div class="big">Čas vypršal</div></div>`
    : me.correct
      ? `<div class="quiz-result ok"><div class="big">Správne!</div><p>+${me.points} bodov</p></div>`
      : `<div class="quiz-result bad"><div class="big">Nesprávne</div><p>Nabudúce to vyjde.</p></div>`;
  center(`${result}${score}`);
}

function center(html) {
  screen.innerHTML = `<div class="quiz-center">${html}</div>`;
}

setInterval(() => {
  const timer = document.getElementById('timer');
  if (timer) timer.textContent = remainingSeconds();
}, 250);

async function init() {
  const es = new EventSource(`/api/p/${encodeURIComponent(slug)}/stream`);
  es.onmessage = async (e) => {
    const next = JSON.parse(e.data);
    if (!next) return;
    const before = quiz()?.state;
    payload = next;
    clockOffset = quiz().serverNow - Date.now();
    const after = quiz().state;
    // Score, rank and my result only change when the phase or question changes.
    if (!me || before?.phase !== after.phase || before?.index !== after.index) {
      error = '';
      await refreshMe();
    } else render();
  };
}

init();
