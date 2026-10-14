const view = document.getElementById('view');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const STATUS_LABELS = { draft: 'Koncept', open: 'Otvorený', closed: 'Uzavretý' };
const TYPE_LABELS = { single: 'Jedna možnosť', multi: 'Viac možností', scale: 'Škála 1–5', text: 'Voľný text' };
const SCALE_OPTIONS = ['1', '2', '3', '4', '5'];

// Options as the server will store them (blank lines dropped, scale fixed).
function effectiveOptions(q) {
  if (q.type === 'scale') return SCALE_OPTIONS;
  if (q.type === 'text') return [];
  return q.options.map((o) => o.trim()).filter(Boolean);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) location.assign('/admin/login');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Chyba');
  return data;
}

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

function showError(el, e) {
  el.textContent = e.message;
  el.hidden = false;
}

// ---------- routing ----------
function navigate(url) {
  history.pushState(null, '', url);
  route();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', route);

function route() {
  const path = location.pathname;
  const formMatch = path.match(/^\/admin\/forms\/(\d+)$/);
  document.querySelectorAll('[data-nav]').forEach((a) =>
    a.classList.toggle('active', a.dataset.nav === (path.startsWith('/admin/users') ? 'users' : 'forms'))
  );
  if (formMatch) return formView(formMatch[1]);
  if (path === '/admin/users') return usersView();
  return formsView();
}

// ---------- forms list ----------
async function formsView() {
  const { forms } = await api('GET', '/api/admin/forms');
  view.innerHTML = `
    <div class="row" style="margin-bottom:16px"><h1 style="margin:0">Dotazníky</h1></div>
    <form id="create" class="card">
      <h2>Nový dotazník</h2>
      <div class="row" style="align-items:flex-end">
        <div style="flex:2;min-width:200px"><label for="title">Názov</label><input id="title" required maxlength="200"></div>
        <div style="flex:1;min-width:160px"><label for="slug">Slovo v adrese</label><input id="slug" required maxlength="40" placeholder="napr. anketa"></div>
        <button class="primary">Vytvoriť</button>
      </div>
      <p class="muted small" id="preview"></p>
      <p class="error" id="err" hidden></p>
    </form>
    <div class="card">
      ${
        forms.length
          ? `<table><thead><tr><th>Názov</th><th>Adresa</th><th>Stav</th><th class="hide-sm">Odpovede</th><th></th></tr></thead><tbody>
          ${forms
            .map(
              (f) => `<tr>
                <td><a href="/admin/forms/${f.id}" data-link><b>${esc(f.title)}</b></a>${f.mode === 'scored' ? ' <span class="badge">Test</span>' : ''}
                  <div class="muted small">${esc(f.created_by_name ?? '')}</div></td>
                <td><a href="/${esc(f.slug)}" target="_blank">/${esc(f.slug)}</a></td>
                <td><span class="badge ${f.status}">${STATUS_LABELS[f.status]}</span></td>
                <td class="hide-sm">${f.counts.submitted} odovzdaných · ${f.counts.inProgress} rozpracovaných</td>
                <td><a class="btn" href="/admin/forms/${f.id}" data-link>Upraviť</a></td>
              </tr>`
            )
            .join('')}</tbody></table>`
          : '<p class="muted">Zatiaľ žiadne dotazníky.</p>'
      }
    </div>`;

  const title = view.querySelector('#title');
  const slug = view.querySelector('#slug');
  const preview = view.querySelector('#preview');
  let slugTouched = false;
  const updatePreview = () => (preview.textContent = slug.value ? `${location.origin}/${slug.value}` : '');
  title.addEventListener('input', () => {
    if (!slugTouched) slug.value = slugify(title.value);
    updatePreview();
  });
  slug.addEventListener('input', () => {
    slugTouched = true;
    updatePreview();
  });
  view.querySelector('#create').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { id } = await api('POST', '/api/admin/forms', { title: title.value, slug: slug.value });
      navigate(`/admin/forms/${id}`);
    } catch (err) {
      showError(view.querySelector('#err'), err);
    }
  });
}

// ---------- form editor ----------
async function formView(id) {
  const { form, questions, counts } = await api('GET', `/api/admin/forms/${id}`);
  const hasResponses = counts.submitted + counts.inProgress > 0;
  const presentUrl = `${location.origin}/${form.slug}`;
  const fillUrl = `${presentUrl}/vyplnit`;
  let mode = form.mode;
  let categories = form.categories;
  // Points are kept per option label, so editing/reordering options keeps their points.
  let qs = questions.map(({ type, text, options, scores }) => ({
    type,
    text,
    options,
    points: Object.fromEntries(options.map((o, i) => [o, scores[i] ?? []])),
  }));

  view.innerHTML = `
    <p><a href="/admin" data-link>← Dotazníky</a></p>
    <div class="card">
      <div class="row">
        <div style="flex:2;min-width:200px"><label for="title">Názov</label><input id="title" value="${esc(form.title)}"></div>
        <div style="flex:1;min-width:160px"><label for="slug">Slovo v adrese</label><input id="slug" value="${esc(form.slug)}"></div>
      </div>
      <p style="margin:16px 0 6px"><b>Odkaz do prezentácie:</b> <code class="url">${esc(presentUrl)}</code>
        <button data-copy="${esc(presentUrl)}">Kopírovať</button> <a class="btn" href="${esc(presentUrl)}" target="_blank">Otvoriť</a></p>
      <p style="margin:0"><b>Odkaz na vyplnenie:</b> <code class="url">${esc(fillUrl)}</code>
        <button data-copy="${esc(fillUrl)}">Kopírovať</button></p>
    </div>
    <div class="card">
      <div class="row">
        <div><b>Stav:</b></div>
        <div class="seg" id="status">
          ${Object.entries(STATUS_LABELS)
            .map(([k, v]) => `<button data-status="${k}" aria-pressed="${form.status === k}">${v}</button>`)
            .join('')}
        </div>
        <span class="spacer"></span>
        <span class="muted">${counts.submitted} odovzdaných · ${counts.inProgress} rozpracovaných</span>
        <button id="reset" class="danger" ${hasResponses ? '' : 'disabled'}>Vymazať odpovede</button>
      </div>
      <p class="muted small" style="margin:8px 0 0">Koncept: respondenti vidia „ešte nie je otvorený“. Otvorený: prijíma odpovede. Uzavretý: odpovede sa už neprijímajú.</p>
    </div>
    <div class="card">
      <div class="row">
        <div><b>Režim:</b></div>
        <div class="seg" id="mode">
          <button data-mode="survey" aria-pressed="${mode === 'survey'}">Prieskum</button>
          <button data-mode="scored" aria-pressed="${mode === 'scored'}">Vyhodnocovací test</button>
        </div>
      </div>
      <p class="muted small" style="margin:8px 0 0">Prieskum: v prezentácii je graf pre každú otázku.
        Test: odpovede dávajú body výsledkom, každý respondent dostane výsledok s najviac bodmi a v prezentácii je jeden koláč výsledkov.</p>
      <div id="scoredSettings" style="margin-top:14px" ${mode === 'scored' ? '' : 'hidden'}>
        <div class="field"><label for="categories">Možné výsledky (každý na nový riadok, 2–8)</label>
          <textarea id="categories" rows="3" placeholder="Introvert&#10;Extrovert">${esc(categories.join('\n'))}</textarea></div>
        <label style="font-weight:400;display:flex;gap:8px;align-items:center">
          <input type="checkbox" id="showQuestions" style="width:auto" ${form.show_questions ? 'checked' : ''}>
          V prezentácii za koláčom výsledkov zobraziť aj grafy jednotlivých otázok</label>
        <p class="muted small" style="margin:8px 0 0">Body pri otázkach môžeš meniť aj keď už sú odpovede – výsledky sa prepočítajú.
          Pri rovnakom počte bodov sa respondent zaráta do „Nerozhodne“.</p>
      </div>
    </div>
    <h2>Otázky</h2>
    ${hasResponses ? '<p class="card muted">Dotazník už má odpovede, preto otázky nemožno meniť. Ak ich chceš upraviť, najprv vymaž odpovede.</p>' : ''}
    <div id="questions"></div>
    <div class="row" style="margin-bottom:24px">
      <button id="add" ${hasResponses ? 'disabled' : ''}>+ Pridať otázku</button>
      <span class="spacer"></span>
      <span id="saved" class="muted small"></span>
      <button id="save" class="primary">Uložiť</button>
    </div>
    <p class="error" id="err" hidden></p>
    <div class="card"><h2>Zmazať dotazník</h2><p class="muted small">Zmaže dotazník aj všetky odpovede. Nedá sa vrátiť.</p>
      <button id="delete" class="danger">Zmazať dotazník</button></div>`;

  const err = view.querySelector('#err');
  const list = view.querySelector('#questions');

  const currentCategories = () => categories.map((c) => c.trim()).filter(Boolean);

  function scoreTable(q) {
    const cats = currentCategories();
    const opts = effectiveOptions(q);
    if (mode !== 'scored' || !opts.length) return '';
    if (cats.length < 2) return '<p class="muted small">Najprv vyplň aspoň 2 možné výsledky vyššie.</p>';
    return `<label style="margin-top:12px">Body za odpoveď</label>
      <table class="scores"><thead><tr><th>Odpoveď</th>${cats.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${opts
        .map(
          (o, oi) => `<tr><td>${esc(o)}</td>${cats
            .map((_, ci) => `<td><input type="number" step="1" min="-100" max="100" data-score="${oi},${ci}" value="${q.points[o]?.[ci] ?? 0}"></td>`)
            .join('')}</tr>`
        )
        .join('')}</tbody></table>`;
  }
  const refreshScores = () =>
    list.querySelectorAll('.q-edit').forEach((el) => (el.querySelector('.scores-wrap').innerHTML = scoreTable(qs[el.dataset.i])));

  function renderQuestions() {
    list.innerHTML = qs
      .map(
        (q, i) => `<div class="q-edit" data-i="${i}">
          <div class="row" style="margin-bottom:10px">
            <b>${i + 1}.</b>
            <select data-f="type" ${hasResponses ? 'disabled' : ''}>
              ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
            <span class="spacer"></span>
            <button data-a="up" ${hasResponses || i === 0 ? 'disabled' : ''} title="Posunúť vyššie">↑</button>
            <button data-a="down" ${hasResponses || i === qs.length - 1 ? 'disabled' : ''} title="Posunúť nižšie">↓</button>
            <button data-a="remove" class="danger" ${hasResponses ? 'disabled' : ''}>Odstrániť</button>
          </div>
          <div class="field"><input data-f="text" placeholder="Text otázky" value="${esc(q.text)}" ${hasResponses ? 'disabled' : ''}></div>
          ${
            q.type === 'single' || q.type === 'multi'
              ? `<label>Možnosti (každá na nový riadok, 2–12)</label>
                 <textarea data-f="options" rows="4" ${hasResponses ? 'disabled' : ''}>${esc(q.options.join('\n'))}</textarea>`
              : q.type === 'scale'
                ? '<p class="muted small">Respondent vyberie hodnotu 1 až 5.</p>'
                : '<p class="muted small">Krátka textová odpoveď (max. 500 znakov), na plátne sa zobrazí ako zoznam.</p>'
          }
          <div class="scores-wrap">${scoreTable(q)}</div>
        </div>`
      )
      .join('');
  }
  renderQuestions();

  list.addEventListener('input', (e) => {
    const el = e.target.closest('[data-i]');
    const q = qs[Number(el.dataset.i)];
    const f = e.target.dataset.f;
    if (f === 'text') q.text = e.target.value;
    if (f === 'options') {
      q.options = e.target.value.split('\n');
      el.querySelector('.scores-wrap').innerHTML = scoreTable(q);
    }
    if (e.target.dataset.score) {
      const [oi, ci] = e.target.dataset.score.split(',').map(Number);
      const label = effectiveOptions(q)[oi];
      const row = (q.points[label] ??= []);
      row[ci] = Math.max(-100, Math.min(100, parseInt(e.target.value, 10) || 0));
    }
  });
  list.addEventListener('change', (e) => {
    if (e.target.dataset.f !== 'type') return;
    const q = qs[Number(e.target.closest('[data-i]').dataset.i)];
    q.type = e.target.value;
    if ((q.type === 'single' || q.type === 'multi') && q.options.length < 2) q.options = ['', ''];
    renderQuestions();
  });
  list.addEventListener('click', (e) => {
    const a = e.target.dataset.a;
    if (!a) return;
    const i = Number(e.target.closest('[data-i]').dataset.i);
    if (a === 'remove') qs.splice(i, 1);
    if (a === 'up') [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
    if (a === 'down') [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]];
    renderQuestions();
  });
  view.querySelector('#mode').addEventListener('click', (e) => {
    if (!e.target.dataset.mode) return;
    mode = e.target.dataset.mode;
    view.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    view.querySelector('#scoredSettings').hidden = mode !== 'scored';
    refreshScores();
  });
  view.querySelector('#categories').addEventListener('input', (e) => {
    categories = e.target.value.split('\n');
    refreshScores();
  });

  view.querySelector('#add').addEventListener('click', () => {
    qs.push({ type: 'single', text: '', options: ['', ''], points: {} });
    renderQuestions();
    list.lastElementChild.querySelector('[data-f="text"]').focus();
  });

  view.querySelector('#save').addEventListener('click', async () => {
    err.hidden = true;
    try {
      const slug = view.querySelector('#slug').value;
      await api('PUT', `/api/admin/forms/${id}`, {
        title: view.querySelector('#title').value,
        slug,
        mode,
        categories: currentCategories(),
        showQuestions: view.querySelector('#showQuestions').checked,
        questions: qs.map((q) => {
          const options = effectiveOptions(q);
          const cats = currentCategories();
          const scores = mode === 'scored' ? options.map((o) => cats.map((_, ci) => q.points[o]?.[ci] ?? 0)) : [];
          return { type: q.type, text: q.text, options, scores };
        }),
      });
      if (slug !== form.slug) return formView(id);
      view.querySelector('#saved').textContent = 'Uložené ✓';
      setTimeout(() => (view.querySelector('#saved').textContent = ''), 2500);
    } catch (e) {
      showError(err, e);
    }
  });

  view.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = 'Skopírované';
      setTimeout(() => (b.textContent = 'Kopírovať'), 1500);
    })
  );
  view.querySelector('#status').addEventListener('click', async (e) => {
    const status = e.target.dataset.status;
    if (!status) return;
    await api('PUT', `/api/admin/forms/${id}/status`, { status });
    view.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.status === status));
  });
  view.querySelector('#reset').addEventListener('click', async () => {
    if (!confirm('Naozaj vymazať všetky odpovede tohto dotazníka?')) return;
    await api('DELETE', `/api/admin/forms/${id}/responses`);
    formView(id);
  });
  view.querySelector('#delete').addEventListener('click', async () => {
    if (!confirm(`Naozaj zmazať dotazník „${form.title}“ aj s odpoveďami?`)) return;
    await api('DELETE', `/api/admin/forms/${id}`);
    navigate('/admin');
  });
}

// ---------- users ----------
async function usersView() {
  const [{ users }, { user: me }] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/me')]);
  view.innerHTML = `
    <h1>Používatelia</h1>
    <div class="card">
      <table><thead><tr><th>Meno</th><th>E-mail</th><th></th></tr></thead><tbody>
      ${users
        .map(
          (u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
            <td>${u.id === me.id ? '<span class="muted small">ty</span>' : `<button class="danger" data-del="${u.id}" data-name="${esc(u.name)}">Zmazať</button>`}</td></tr>`
        )
        .join('')}
      </tbody></table>
    </div>
    <form id="add" class="card">
      <h2>Pridať používateľa</h2>
      <div class="row" style="align-items:flex-end">
        <div style="flex:1;min-width:160px"><label for="name">Meno</label><input id="name" required></div>
        <div style="flex:1;min-width:160px"><label for="email">E-mail</label><input id="email" type="email" required></div>
        <div style="flex:1;min-width:160px"><label for="pw">Heslo (min. 8 znakov)</label><input id="pw" type="text" minlength="8" required></div>
        <button class="primary">Pridať</button>
      </div>
      <p class="error" id="addErr" hidden></p>
    </form>
    <form id="pwForm" class="card">
      <h2>Zmeniť moje heslo</h2>
      <div class="row" style="align-items:flex-end">
        <div style="flex:1;min-width:200px"><label for="newPw">Nové heslo (min. 8 znakov)</label><input id="newPw" type="password" minlength="8" autocomplete="new-password" required></div>
        <button class="primary">Zmeniť</button>
        <span id="pwOk" class="muted small"></span>
      </div>
      <p class="error" id="pwErr" hidden></p>
    </form>`;

  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`Zmazať používateľa ${b.dataset.name}?`)) return;
      await api('DELETE', `/api/admin/users/${b.dataset.del}`);
      usersView();
    })
  );
  view.querySelector('#add').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/admin/users', {
        name: view.querySelector('#name').value,
        email: view.querySelector('#email').value,
        password: view.querySelector('#pw').value,
      });
      usersView();
    } catch (err) {
      showError(view.querySelector('#addErr'), err);
    }
  });
  view.querySelector('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/admin/me/password', { password: view.querySelector('#newPw').value });
      view.querySelector('#newPw').value = '';
      view.querySelector('#pwOk').textContent = 'Heslo zmenené ✓';
    } catch (err) {
      showError(view.querySelector('#pwErr'), err);
    }
  });
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout');
  location.assign('/admin/login');
});
api('GET', '/api/admin/me').then(({ user }) => (document.getElementById('me').textContent = user.name));
route();
