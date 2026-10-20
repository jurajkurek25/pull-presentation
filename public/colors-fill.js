// Consistency test on the phone: one letter at a time, tapping a colour saves it and moves on.
// Round 1 uses the letters in their usual order, round 2 a shuffled one.
const slug = location.pathname.split('/')[1];
const $ = (id) => document.getElementById(id);
const api = `/api/k/${encodeURIComponent(slug)}`;

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

let data = null; // { form, letters, colors, state }
let order = null; // letters in the order of the round being filled in
let orderRound = 0;
let pos = 0;
let pending = 0; // picks sent but not yet confirmed
let saving = Promise.resolve();
let pollTimer;

async function load() {
  clearTimeout(pollTimer);
  const res = await fetch(`${api}?token=${token}`);
  if (!res.ok) return ($('title').textContent = 'Test neexistuje');
  data = await res.json();
  document.title = data.form.title;
  $('title').textContent = data.form.title;
  render();
}

function shuffled(letters) {
  let out;
  do {
    out = [...letters];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
  } while (out.join() === letters.join());
  return out;
}

// Which round the phone should be filling in now, or null.
function activeRound() {
  const { form, state } = data;
  if (form.status !== 'open') return null;
  if (!state.done[0]) return form.phase === 'round2' ? null : 1;
  if (!state.done[1] && form.phase === 'round2') return 2;
  return null;
}

function card(html) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = html;
  return el;
}

function render() {
  const { form, state } = data;
  const screen = $('screen');
  const round = activeRound();
  let wait = false;
  if (round) return renderRound(round);
  if (state.matches !== null) screen.replaceChildren(resultCard());
  else if (form.status === 'draft') {
    screen.replaceChildren(card('<h2>Test ešte nie je otvorený</h2><p class="muted">Stránka sa sama obnoví, keď sa otvorí.</p>'));
    wait = true;
  } else if (form.status === 'closed') {
    screen.replaceChildren(card('<h2>Test je uzavretý</h2><p class="muted">Odpovede sa už neprijímajú.</p>'));
  } else if (state.done[0]) {
    screen.replaceChildren(
      card(`<h2>Kolo 1 je hotové ✓</h2>
        <p>Tvoje farby sú uložené a skryté, ani tu ich neuvidíš. Skús si ich nezapamätať.</p>
        <p class="muted">Kolo 2 príde na konci prezentácie, stránka sa prepne sama. Nechaj ju otvorenú,
          alebo potom znova naskenuj QR kód v tom istom prehliadači.</p>`)
    );
    wait = true;
  } else {
    screen.replaceChildren(
      card('<h2>Kolo 1 už skončilo</h2><p class="muted">Bez prvého kola sa zhoda nedá spočítať. Sleduj výsledky triedy na plátne.</p>')
    );
  }
  if (wait) pollTimer = setTimeout(load, 3000);
}

function renderRound(round) {
  const { letters, colors, state } = data;
  const picks = state.picks[round];
  if (orderRound !== round) {
    orderRound = round;
    order = round === 1 ? letters : shuffled(letters);
    pos = Math.max(0, order.findIndex((l) => picks[l] === undefined));
  }
  if (pos >= order.length) {
    // All letters are picked; the screen moves on once the server confirms.
    $('screen').replaceChildren(card('<p class="muted">Ukladám…</p>'));
    return;
  }
  const letter = order[pos];
  const el = card(`
    <div class="row"><b>Kolo ${round}</b><span class="spacer"></span><span class="muted">${pos + 1} / ${order.length}</span></div>
    <p class="muted small">${round === 1 ? 'Rýchlo, bez rozmýšľania: prvá farba, ktorá ti napadne.' : 'Opäť rýchlo. Nesnaž sa spomenúť si na prvé kolo.'}</p>
    <div class="letter"></div>
    <div class="colors"></div>
    <button class="back" ${pos === 0 ? 'disabled' : ''}>← Späť</button>`);
  el.querySelector('.letter').textContent = letter;
  el.querySelector('.colors').append(
    ...colors.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color';
      b.setAttribute('aria-pressed', picks[letter] === i);
      b.innerHTML = '<span class="swatch"></span><span></span>';
      b.firstChild.style.background = c.hex;
      b.lastChild.textContent = c.name;
      b.addEventListener('click', () => pick(round, letter, i));
      return b;
    })
  );
  el.querySelector('.back').addEventListener('click', () => {
    pos--;
    renderRound(round);
  });
  $('screen').replaceChildren(el);
}

function pick(round, letter, color) {
  data.state.picks[round][letter] = color;
  pos++;
  pending++;
  renderRound(round);
  saving = saving.then(async () => {
    const state = await send({ token, round, letter, color });
    pending--;
    if (!state) {
      // The round closed meanwhile (or the test did): show whatever applies now.
      orderRound = 0;
      return load();
    }
    if (pending === 0) {
      data.state = state;
      $('saved').textContent = '';
      if (activeRound() !== round) render();
    }
  });
}

async function send(body) {
  for (;;) {
    try {
      const res = await fetch(`${api}/pick`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 409) return null;
      if (!res.ok) throw new Error((await res.json()).error);
      return (await res.json()).state;
    } catch {
      $('saved').textContent = 'Nepodarilo sa uložiť, skúšam znova…';
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function resultCard() {
  const { letters, colors, state } = data;
  const el = card(`<h2>Hotovo!</h2>
    <p class="result">Rovnakú farbu v oboch kolách: <b>${state.matches} z ${letters.length}</b></p>
    <table class="compare"><thead><tr><th></th><th>Kolo 1</th><th>Kolo 2</th><th></th></tr></thead><tbody></tbody></table>
    <p class="muted small">Výsledky celej triedy sú na plátne.</p>`);
  const swatch = (i) => `<span class="swatch" style="background:${colors[i].hex}"></span>${colors[i].name}`;
  el.querySelector('tbody').innerHTML = letters
    .map((l) => {
      const a = state.picks[1][l], b = state.picks[2][l];
      return `<tr><td><b>${l}</b></td><td>${swatch(a)}</td><td>${swatch(b)}</td><td>${a === b ? '✓' : ''}</td></tr>`;
    })
    .join('');
  return el;
}

load();
