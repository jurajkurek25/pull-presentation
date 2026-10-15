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

function apply({ form, questions, stats }) {
  document.title = form.title;
  $('title').textContent = form.title;
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
  slides = [{ el: fromTemplate('tpl-intro'), question: null }];
  if (wifi) {
    const intro = slides[0].el;
    intro.classList.add('has-wifi');
    intro.querySelector('.wifi-step').hidden = false;
    intro.querySelector('[data-wifi-qr]').innerHTML = wifi.qrSvg;
    intro.querySelector('[data-wifi-ssid]').textContent = wifi.ssid;
    intro.querySelector('[data-fill-title]').textContent = '2. Naskenuj QR kód a odpovedaj';
  }
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
