// Presentation for the consistency test. It is opened twice from the slides:
//   1st time (phase round1): QR slide for round 1. "Next" on it ends round 1 and closes the page.
//   2nd time (phase break):  opening it starts round 2. QR slide for round 2, then the histogram.
// Changing the phase needs the presenter to be logged in to /admin in this browser.
// Keys and closing work like on the survey presentation (see present.js).
const KEYS = {
  next: ['PageDown', 'ArrowRight', 'ArrowDown', ' ', 'Enter'],
  prev: ['PageUp', 'ArrowLeft', 'ArrowUp', 'Backspace'],
  close: ['Escape', '.', 'b', 'B'],
  fullscreen: ['F5'],
};
const BAR_COLOR = '#2563eb';

const slug = location.pathname.split('/')[1];
const $ = (id) => document.getElementById(id);

let fillUrl = '';
let qrSvg = '';
let wifi = null;
let deck = ''; // 'round1' or 'round2'
let slides = []; // { el, kind: 'round' | 'histogram', chart }
let current = 0;
let stats = null;
let leaving = false; // round 1 just ended: keep its slide until the page closes

async function init() {
  const res = await fetch(`/api/p/${encodeURIComponent(slug)}`);
  if (!res.ok) return ($('title').textContent = 'Test neexistuje');
  const payload = await res.json();
  fillUrl = payload.fillUrl;
  qrSvg = payload.qrSvg;
  wifi = payload.wifi;
  apply(payload);
  if (payload.form.phase === 'break') setPhase('round2');

  const es = new EventSource(`/api/p/${encodeURIComponent(slug)}/stream`);
  es.onmessage = (e) => {
    $('conn').hidden = true;
    const p = JSON.parse(e.data);
    if (p) apply(p);
  };
  es.onerror = () => ($('conn').hidden = false);
}

async function setPhase(phase) {
  const res = await fetch(`/api/p/${encodeURIComponent(slug)}/phase`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase }),
  });
  if (res.ok) return true;
  toast(res.status === 401 ? 'Kolo sa nedá prepnúť: v tomto prehliadači sa prihlás do /admin.' : 'Kolo sa nepodarilo prepnúť.');
  return false;
}

function apply({ form, stats: s }) {
  document.title = form.title;
  $('title').textContent = form.title;
  stats = s;
  const wanted = form.phase === 'round1' ? 'round1' : 'round2';
  if (wanted !== deck && !leaving) build(wanted);
  const round = stats.rounds[deck === 'round1' ? 0 : 1];
  $('done').textContent = round.done;
  $('inProgress').textContent = round.inProgress;
  renderStatus(form.status, round);
  for (const slide of slides) if (slide.kind === 'histogram') updateHistogram(slide);
}

function renderStatus(status, { done, inProgress }) {
  const pill = $('status');
  let cls = '', text;
  if (status === 'draft') text = 'Neotvorený';
  else if (status === 'closed') (cls = 'final'), (text = 'Uzavretý');
  else if (done > 0 && inProgress === 0) (cls = 'final'), (text = 'Všetci hotoví');
  else (cls = 'live'), (text = 'Naživo');
  pill.className = `pill ${cls}`;
  pill.textContent = text;
}

function fromTemplate(id) {
  return $(id).content.firstElementChild.cloneNode(true);
}

function build(kind) {
  for (const s of slides) s.chart?.destroy();
  deck = kind;
  const round = fromTemplate('tpl-round');
  round.querySelector('[data-round-title]').textContent =
    kind === 'round1' ? 'Kolo 1: ku každému písmenu vyber farbu' : 'Kolo 2: tie isté písmená, iné poradie';
  round.querySelector('[data-round-hint]').textContent =
    kind === 'round1'
      ? 'Rýchlo, bez rozmýšľania, prvý nápad. Výsledok si nechaj pre seba.'
      : 'Opäť rýchlo. Nesnaž sa spomenúť si na prvé kolo. Otvor stránku v tom istom prehliadači ako v kole 1.';
  if (wifi) {
    round.classList.add('has-wifi');
    round.querySelector('.wifi-step').hidden = false;
    round.querySelector('[data-wifi-qr]').innerHTML = wifi.qrSvg;
    round.querySelector('[data-wifi-ssid]').textContent = wifi.ssid;
  }
  round.querySelector('[data-qr]').innerHTML = qrSvg;
  round.querySelector('[data-url]').textContent = fillUrl.replace(/^https?:\/\//, '');
  slides = [{ el: round, kind: 'round' }];
  if (kind === 'round2') slides.push({ el: fromTemplate('tpl-histogram'), kind: 'histogram', chart: null });
  $('slides').replaceChildren(...slides.map((s) => s.el));
  show(0);
}

function show(index) {
  current = index;
  slides.forEach((s, i) => s.el.classList.toggle('active', i === index));
  $('position').textContent = `${index + 1} / ${slides.length}`;
  if (slides[index].kind === 'histogram') updateHistogram(slides[index]);
}

function updateHistogram(slide) {
  const total = stats.histogram.reduce((a, b) => a + b, 0);
  slide.el.querySelector('[data-note]').textContent = `Obe kolá dokončilo: ${total}`;
  if (slide.chart) {
    slide.chart.data.datasets[0].data = stats.histogram;
    return slide.chart.update();
  }
  if (slides[current] !== slide) return; // Chart.js needs a visible canvas to size itself
  const font = { size: Math.round(innerHeight * 0.028) };
  slide.chart = new Chart(slide.el.querySelector('canvas'), {
    type: 'bar',
    data: {
      labels: stats.histogram.map((_, k) => String(k)),
      datasets: [{ data: stats.histogram, backgroundColor: BAR_COLOR, borderRadius: 6 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { title: { display: true, text: 'počet zhôd (z 9)', font }, ticks: { font }, grid: { display: false } },
        y: { title: { display: true, text: 'počet ľudí', font }, ticks: { font, precision: 0 }, beginAtZero: true, suggestedMax: 3 },
      },
    },
  });
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
  setTimeout(() => {
    if (history.length > 1) history.back();
    else toast('Prehliadač nedovolil zavrieť kartu – zavri ju cez Ctrl+W.');
  }, 300);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

document.addEventListener('keydown', async (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (KEYS.next.includes(e.key)) {
    e.preventDefault();
    if (current < slides.length - 1) return show(current + 1);
    // Leaving round 1 forward ends it; the next time the page opens, round 2 starts.
    if (deck === 'round1') {
      leaving = true;
      if (!(await setPhase('break'))) return (leaving = false);
    }
    closeTab();
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
