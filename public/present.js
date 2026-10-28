// Presentation page: QR slide + one slide per question, live via Server-Sent Events.
// Navigation never touches history (no hash/pushState), so window.close() stays allowed
// for a tab opened from a link in Canva.

// Keys a wireless presenter typically sends. Use the key test (press K) to check yours.
const KEYS = {
  next: ['PageDown', 'ArrowRight', 'ArrowDown', ' ', 'Enter'],
  prev: ['PageUp', 'ArrowLeft', 'ArrowUp', 'Backspace'],
  close: ['Escape', '.', 'b', 'B'],
  fullscreen: ['F5'],
};
const TIE_COLOR = '#9ca3af';
const COLORS = ['#2563eb', '#f97316', '#16a34a', '#dc2626', '#9333ea', '#0891b2', '#ca8a04', '#db2777', '#4b5563', '#65a30d', '#7c3aed', '#0d9488'];

const slug = location.pathname.split('/')[1];
const $ = (id) => document.getElementById(id);

let fillUrl = '';
let qrSvg = '';
let wifi = null; // { ssid, qrSvg } when the server advertises a hotspot
let questionsSig = '';
let slides = []; // { el, question, chart }
let current = 0;

async function init() {
  const res = await fetch(`/api/p/${encodeURIComponent(slug)}`);
  if (!res.ok) return ($('title').textContent = 'Dotazník neexistuje');
  const payload = await res.json();
  fillUrl = payload.fillUrl;
  qrSvg = payload.qrSvg;
  wifi = payload.wifi;
  apply(payload);

  const es = new EventSource(`/api/p/${encodeURIComponent(slug)}/stream`);
  es.onmessage = (e) => {
    $('conn').hidden = true;
    const p = JSON.parse(e.data);
    if (p) apply(p);
  };
  es.onerror = () => ($('conn').hidden = false);
}

let currentForm = null;

function apply({ form, questions, stats }) {
  currentForm = form;
  document.title = form.title;
  $('title').textContent = form.title;
  const quizMode = form.mode === 'quiz';
  document.querySelectorAll('.survey-count').forEach((el) => (el.hidden = quizMode));
  $('playersCount').hidden = !quizMode;
  if (quizMode) return applyQuiz(form, questions, stats.quiz);
  quizKey = '';
  const sig = JSON.stringify([questions, form.mode, form.categories, form.showQuestions, form.resultTitle]);
  if (sig !== questionsSig) {
    questionsSig = sig;
    build(form, questions);
  }
  $('submitted').textContent = stats.counts.submitted;
  $('inProgress').textContent = stats.counts.inProgress;
  renderStatus(form.status, stats.counts);
  const byId = new Map(stats.questions.map((s) => [s.id, s]));
  for (const slide of slides) {
    if (slide.question) updateSlide(slide, slide.question.id === 'result' ? stats.result : byId.get(slide.question.id));
  }
}

function renderStatus(status, { submitted, inProgress }) {
  const pill = $('status');
  let cls = '', text;
  if (status === 'draft') text = 'Neotvorený';
  else if (status === 'closed') (cls = 'final'), (text = 'Uzavretý');
  else if (submitted > 0 && inProgress === 0) (cls = 'final'), (text = 'Všetci odovzdali');
  else (cls = 'live'), (text = 'Naživo');
  pill.className = `pill ${cls}`;
  pill.textContent = text;
}

function fromTemplate(id) {
  return $(id).content.firstElementChild.cloneNode(true);
}

function introSlide(fillTitle, hint) {
  const intro = fromTemplate('tpl-intro');
  intro.querySelector('[data-fill-title]').textContent = fillTitle;
  if (hint) intro.querySelector('[data-hint]').textContent = hint;
  if (wifi) {
    intro.classList.add('has-wifi');
    intro.querySelector('.wifi-step').hidden = false;
    intro.querySelector('[data-wifi-qr]').innerHTML = wifi.qrSvg;
    intro.querySelector('[data-wifi-ssid]').textContent = wifi.ssid;
    intro.querySelector('[data-fill-title]').textContent = `2. ${fillTitle}`;
  }
  intro.querySelectorAll('[data-qr]').forEach((n) => (n.innerHTML = qrSvg));
  intro.querySelectorAll('[data-url]').forEach((n) => (n.textContent = fillUrl.replace(/^https?:\/\//, '')));
  return intro;
}

// Scored test: one pie of respondents' results (+ "Nerozhodne" for ties), optionally followed by the questions.
function resultQuestion(categories, title) {
  return {
    id: 'result',
    type: 'single',
    text: title || 'Výsledky',
    options: [...categories, 'Nerozhodne'],
    colors: [...categories.map((_, i) => COLORS[i % COLORS.length]), TIE_COLOR],
    tieIndex: categories.length,
  };
}

const colorOf = (question, i) => question.colors?.[i] ?? COLORS[i % COLORS.length];

function build(form, questions) {
  for (const s of slides) s.chart?.destroy();
  const container = $('slides');
  container.replaceChildren();
  slides = [{ el: introSlide('Naskenuj QR kód a odpovedaj'), question: null }];
  const scored = form.mode === 'scored';
  const shown = [...(scored ? [resultQuestion(form.categories, form.resultTitle)] : []), ...(!scored || form.showQuestions ? questions : [])];
  for (const q of shown) {
    const el = fromTemplate(q.type === 'text' ? 'tpl-text' : 'tpl-chart');
    el.querySelector('.q-text').textContent = q.text;
    slides.push({ el, question: q, chart: null, stats: null });
  }
  for (const s of slides) {
    s.el.querySelectorAll('[data-qr]').forEach((n) => (n.innerHTML = qrSvg));
    s.el.querySelectorAll('[data-url]').forEach((n) => (n.textContent = fillUrl.replace(/^https?:\/\//, '')));
    container.append(s.el);
  }
  show(Math.min(current, slides.length - 1));
}

function show(index) {
  current = index;
  slides.forEach((s, i) => s.el.classList.toggle('active', i === index));
  $('position').textContent = `${index + 1} / ${slides.length}`;
  const slide = slides[index];
  if (slide.question && slide.question.type !== 'text' && !slide.chart && slide.stats) {
    slide.chart = createChart(slide);
  }
}

// Each option gets two adjacent slices: solid = submitted, translucent = still being filled in.
function chartData(question, stats) {
  const data = [];
  question.options.forEach((_, i) => data.push(stats.final[i], stats.pending[i]));
  return data;
}

function createChart(slide) {
  const { question, stats } = slide;
  const colors = [];
  question.options.forEach((_, i) => {
    const c = colorOf(question, i);
    colors.push(c, c + '59');
  });
  return new Chart(slide.el.querySelector('canvas'), {
    type: 'pie',
    data: { datasets: [{ data: chartData(question, stats), backgroundColor: colors, borderColor: '#fff', borderWidth: 3 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

function updateSlide(slide, stats) {
  if (!stats) return;
  slide.stats = stats;
  if (slide.question.type === 'text') return renderWall(slide, stats);

  const total = stats.final.reduce((a, b) => a + b, 0) + stats.pending.reduce((a, b) => a + b, 0);
  slide.el.querySelector('.empty').hidden = total > 0;
  if (slide.chart) {
    slide.chart.data.datasets[0].data = chartData(slide.question, stats);
    slide.chart.update();
  } else if (slides[current] === slide) {
    slide.chart = createChart(slide);
  }

  const legend = slide.el.querySelector('.legend');
  if (legend.children.length !== slide.question.options.length) {
    legend.replaceChildren(
      ...slide.question.options.map((label, i) => {
        const li = document.createElement('li');
        const color = colorOf(slide.question, i);
        li.innerHTML = `<span class="swatch"></span><span class="label"></span><span class="num"></span>
          <span class="bar-track"><span class="f"></span><span class="p"></span></span>`;
        li.querySelector('.swatch').style.background = color;
        li.querySelector('.f').style.background = color;
        li.querySelector('.p').style.background = color + '59';
        li.querySelector('.label').textContent = label;
        return li;
      })
    );
  }
  [...legend.children].forEach((li, i) => {
    const f = stats.final[i], p = stats.pending[i], n = f + p;
    const pct = total ? Math.round((n / total) * 100) : 0;
    li.hidden = i === slide.question.tieIndex && n === 0;
    li.querySelector('.num').innerHTML = `${pct} %<small>${n}${p ? ` (${p} rozprac.)` : ''}</small>`;
    li.querySelector('.f').style.width = total ? `${(f / total) * 100}%` : '0';
    li.querySelector('.p').style.width = total ? `${(p / total) * 100}%` : '0';
  });
}

function renderWall(slide, stats) {
  slide.el.querySelector('.empty').hidden = stats.items.length > 0;
  const wall = slide.el.querySelector('.wall');
  const unused = [...wall.children];
  const items = stats.items.map(({ text, final }) => {
    const cls = final ? '' : 'pending';
    const idx = unused.findIndex((li) => li.textContent === text && li.className.replace(' new', '') === cls);
    if (idx >= 0) return unused.splice(idx, 1)[0];
    const li = document.createElement('li');
    li.className = `${cls} new`.trim();
    li.textContent = text;
    li.addEventListener('animationend', () => li.classList.remove('new'), { once: true });
    return li;
  });
  wall.replaceChildren(...items);
}

// ---------- quiz ----------
// The quiz state lives on the server; the presenter's arrow key asks it to move on.
let quizKey = '';
let quizDeadline = 0;
let clockOffset = 0;
let quizRefetched = false;

const shapeTile = (i, cls = '') =>
  `<div class="quiz-opt ${cls}" style="background:${QUIZ_SHAPES[i].color}">${QUIZ_SHAPES[i].svg}<span></span></div>`;

function quizSection(cls, html) {
  const el = document.createElement('section');
  el.className = `slide active quiz-view ${cls}`;
  el.innerHTML = html;
  return el;
}

function renderQuizOptions(el, question, correct) {
  el.querySelector('.quiz-options').innerHTML = question.options
    .map((_, i) => shapeTile(i, correct === undefined ? '' : i === correct ? 'correct' : 'wrong'))
    .join('');
  el.querySelectorAll('.quiz-opt span').forEach((s, i) => (s.textContent = question.options[i] + (i === correct ? ' ✓' : '')));
}

function applyQuiz(form, questions, q) {
  for (const s of slides) s.chart?.destroy();
  slides = [];
  questionsSig = '';
  const { phase, index } = q.state;
  const question = questions[index];
  $('playersCount').querySelector('b').textContent = q.players;
  const pill = $('status');
  pill.className = `pill ${form.status === 'open' ? 'live' : ''}`;
  pill.textContent = form.status !== 'open' ? 'Neotvorený' : phase === 'question' ? 'Odpovedajte!' : 'Kvíz';
  $('position').textContent = question && phase !== 'final' ? `Otázka ${index + 1} / ${q.total}` : '';
  clockOffset = q.serverNow - Date.now();
  quizDeadline = phase === 'question' ? q.state.deadline : 0;

  const key = `${phase}:${index}`;
  if (key !== quizKey) {
    quizKey = key;
    quizRefetched = false;
    let el;
    if (phase === 'lobby') {
      el = introSlide('Naskenuj QR kód a hraj', 'Zadaj prezývku a čakaj na štart.');
      el.classList.add('active', 'quiz-lobby');
      el.insertAdjacentHTML('beforeend', '<div class="quiz-players"></div>');
    } else if (phase === 'question' || phase === 'reveal') {
      el = quizSection(`quiz-${phase}`, `<div class="quiz-head"><span class="quiz-answered"></span>
          ${phase === 'question' ? '<span class="quiz-clock" id="quizClock"></span>' : ''}</div>
        <h2 class="quiz-text"></h2>
        ${phase === 'reveal' ? '<div class="quiz-bars"></div>' : ''}
        <div class="quiz-options ${question.options.length === 2 ? 'two' : ''}"></div>`);
      el.querySelector('.quiz-text').textContent = question.text;
      renderQuizOptions(el, question, phase === 'reveal' ? q.correct : undefined);
    } else if (phase === 'leaderboard') {
      el = quizSection('quiz-board-view', `<h2 class="quiz-title">Poradie po ${index + 1}. otázke</h2><ol class="quiz-board"></ol>`);
    } else {
      el = quizSection('quiz-final', `<h2 class="quiz-title">Víťazi</h2><div class="quiz-podium"></div><ol class="quiz-board rest" start="4"></ol>`);
    }
    $('slides').replaceChildren(el);
  }

  const el = $('slides').firstElementChild;
  if (phase === 'lobby') {
    const box = el.querySelector('.quiz-players');
    box.replaceChildren(
      ...q.names.map((n) => Object.assign(document.createElement('span'), { className: 'quiz-chip', textContent: n }))
    );
    if (!q.names.length) box.innerHTML = '<span class="quiz-wait">Čakáme na hráčov…</span>';
  }
  if (phase === 'question' || phase === 'reveal') {
    el.querySelector('.quiz-answered').textContent = `Odpovede: ${q.answered ?? 0} / ${q.players}`;
  }
  if (phase === 'reveal') {
    const max = Math.max(1, ...q.counts);
    el.querySelector('.quiz-bars').innerHTML = q.counts
      .map(
        (n, i) => `<div class="quiz-bar ${i === q.correct ? 'correct' : 'wrong'}">
          <span class="quiz-bar-n">${n}${i === q.correct ? ' ✓' : ''}</span>
          <span class="quiz-bar-fill" style="background:${QUIZ_SHAPES[i].color};--h:${(n / max) * 100}%"></span>
          <span class="quiz-bar-icon" style="background:${QUIZ_SHAPES[i].color}">${QUIZ_SHAPES[i].svg}</span></div>`
      )
      .join('');
  }
  if (phase === 'leaderboard' || phase === 'final') {
    const board = q.leaderboard ?? [];
    const entry = (tag, p, cls = '') => {
      const node = document.createElement(tag);
      node.className = cls;
      node.innerHTML = '<span class="name"></span><span class="score"></span>';
      node.querySelector('.name').textContent = p.name;
      node.querySelector('.score').textContent = `${p.score} b.`;
      return node;
    };
    if (phase === 'leaderboard') el.querySelector('.quiz-board').replaceChildren(...board.map((p) => entry('li', p)));
    else {
      // Podium order on screen: 2nd, 1st, 3rd.
      el.querySelector('.quiz-podium').replaceChildren(
        ...[1, 0, 2]
          .filter((i) => board[i])
          .map((i) => {
            const step = entry('div', board[i], `quiz-step place-${i + 1}`);
            step.insertAdjacentHTML('beforeend', `<div class="block">${i + 1}</div>`);
            return step;
          })
      );
      el.querySelector('.rest').replaceChildren(...board.slice(3).map((p) => entry('li', p)));
    }
  }
}

setInterval(() => {
  const clock = $('quizClock');
  if (!clock || !quizDeadline) return;
  const left = quizDeadline - (Date.now() + clockOffset);
  clock.textContent = Math.max(0, Math.ceil(left / 1000));
  // The server reveals the question when time is up; ask once in case its notice got lost.
  if (left < -1500 && !quizRefetched) {
    quizRefetched = true;
    fetch(`/api/p/${encodeURIComponent(slug)}`).then((r) => r.json()).then(apply, () => {});
  }
}, 250);

async function quizNext() {
  const res = await fetch(`/api/admin/quiz/${encodeURIComponent(slug)}/next`, { method: 'POST' });
  if (res.status === 401) toast('Na ovládanie kvízu sa v tomto prehliadači prihlás do /admin.');
  else if (!res.ok) toast((await res.json().catch(() => ({}))).error || 'Kvíz sa nepodarilo posunúť.');
}

// ---------- presenter / keyboard ----------
let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000);
}

function closeTab() {
  window.close();
  // Browsers only let a page close itself when its tab has a single history entry (opened by a
  // link in a new tab). If it was opened in the same tab as the presentation, or the address was
  // typed into a used tab, going back is the closest thing: it returns to the previous page.
  setTimeout(() => {
    if (history.length > 1) history.back();
    else toast(`Prehliadač nedovolil zavrieť kartu – zavri ju cez Ctrl+W. (história: ${history.length}, opener: ${!!window.opener})`);
  }, 300);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const keytest = $('keytest');
  if (e.key === 'k' || e.key === 'K') {
    keytest.hidden = !keytest.hidden;
    return;
  }
  if (!keytest.hidden) {
    e.preventDefault();
    const li = document.createElement('li');
    li.innerHTML = `key: <code></code> · code: <code></code>${e.shiftKey ? ' · Shift' : ''}`;
    li.querySelectorAll('code')[0].textContent = e.key === ' ' ? 'Space' : e.key;
    li.querySelectorAll('code')[1].textContent = e.code;
    $('keylog').prepend(li);
    return;
  }

  if (currentForm?.mode === 'quiz' && (KEYS.next.includes(e.key) || KEYS.prev.includes(e.key))) {
    e.preventDefault();
    const phase = quizKey.split(':')[0];
    if (KEYS.next.includes(e.key)) phase === 'final' ? closeTab() : quizNext();
    else if (phase === 'lobby') closeTab();
    return;
  }
  if (KEYS.next.includes(e.key)) {
    e.preventDefault();
    if (current === slides.length - 1) closeTab();
    else show(current + 1);
  } else if (KEYS.prev.includes(e.key)) {
    e.preventDefault();
    if (current === 0) closeTab();
    else show(current - 1);
  } else if (KEYS.close.includes(e.key)) {
    e.preventDefault();
    closeTab();
  } else if (KEYS.fullscreen.includes(e.key)) {
    e.preventDefault(); // F5 would otherwise reload the page
    toggleFullscreen();
  }
});

init();
