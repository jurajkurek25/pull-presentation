import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { createApp } from '../src/app.js';

async function setup(options = {}) {
  const db = openDb(':memory:');
  createUser(db, { email: 'admin@example.com', name: 'Admin', password: 'tajneheslo' });
  const server = createApp({ db, publicUrl: 'https://forms.example.com', ...options }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  return { db, server, base, call };
}

// Reads Server-Sent Events; next() resolves with the first current-or-later payload matching `predicate`.
function sseWaiter(url) {
  const controller = new AbortController();
  const payloads = [];
  const waiters = [];
  (async () => {
    const res = await fetch(url, { signal: controller.signal });
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const event = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = event.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        const payload = JSON.parse(data.slice(6));
        payloads.push(payload);
        for (const w of [...waiters]) if (w.predicate(payload)) waiters.splice(waiters.indexOf(w), 1), w.resolve(payload);
      }
    }
  })().catch(() => {});
  return {
    next: (predicate) =>
      new Promise((resolve, reject) => {
        // Only the current state (latest payload) or newer ones count.
        const hit = payloads.slice(-1).find(predicate);
        if (hit) return resolve(hit);
        waiters.push({ predicate, resolve });
        setTimeout(() => reject(new Error('SSE timeout')), 3000);
      }),
    close: () => controller.abort(),
  };
}

test('celý tok: admin vytvorí dotazník, respondenti odpovedajú, prezentácia sa aktualizuje naživo', async () => {
  const { server, base, call } = await setup();
  try {
    assert.equal((await call('GET', '/api/admin/forms')).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email: 'admin@example.com', password: 'zle' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email: 'Admin@example.com', password: 'tajneheslo' })).status, 200);

    assert.equal((await call('POST', '/api/admin/forms', { title: 'Test', slug: 'admin' })).status, 400);
    const { body: created } = await call('POST', '/api/admin/forms', { title: 'Anketa', slug: 'anketa' });
    assert.equal((await call('POST', '/api/admin/forms', { title: 'X', slug: 'anketa' })).status, 409);

    const saved = await call('PUT', `/api/admin/forms/${created.id}`, {
      title: 'Anketa',
      slug: 'anketa',
      questions: [
        { type: 'single', text: 'Obľúbená farba?', options: ['Červená', 'Modrá', ' '] },
        { type: 'multi', text: 'Jazyky?', options: ['JS', 'Python', 'Go'] },
        { type: 'scale', text: 'Spokojnosť?' },
        { type: 'text', text: 'Komentár?' },
      ],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const pres = (await call('GET', '/api/p/anketa')).body;
    assert.equal(pres.fillUrl, 'https://forms.example.com/anketa/vyplnit');
    assert.match(pres.qrSvg, /^<svg/);
    const [single, multi, scale, text] = pres.questions;
    assert.deepEqual(single.options, ['Červená', 'Modrá']);
    assert.deepEqual(scale.options, ['1', '2', '3', '4', '5']);

    const A = 'a'.repeat(32), B = 'b'.repeat(32);
    const answer = (token, questionId, value) => call('PUT', '/api/f/anketa/answers', { token, questionId, value });

    // Draft form does not accept answers.
    assert.equal((await answer(A, single.id, 0)).status, 409);
    await call('PUT', `/api/admin/forms/${created.id}/status`, { status: 'open' });

    const sse = sseWaiter(`${base}/api/p/anketa/stream`);
    await sse.next((p) => p.form.status === 'open');

    // A answers, then changes their mind: the chart moves while it's pending.
    assert.equal((await answer(A, single.id, 0)).status, 200);
    let p = await sse.next((p) => p.stats.questions[0].pending[0] === 1);
    assert.deepEqual(p.stats.counts, { submitted: 0, inProgress: 1 });
    await answer(A, single.id, 1);
    p = await sse.next((p) => p.stats.questions[0].pending[1] === 1);
    assert.deepEqual(p.stats.questions[0].pending, [0, 1]);

    await answer(A, multi.id, [2, 0, 2]);
    await answer(A, scale.id, 4);
    await answer(A, text.id, '  Super prednáška  ');
    assert.equal((await answer(A, single.id, 5)).status, 400);
    assert.equal((await answer(A, multi.id, 'x')).status, 400);

    // B starts filling in.
    await answer(B, single.id, 0);

    // A submits: their answers become final, B stays pending.
    assert.equal((await call('POST', '/api/f/anketa/submit', { token: A })).status, 200);
    p = await sse.next((p) => p.stats.counts.submitted === 1);
    assert.deepEqual(p.stats.counts, { submitted: 1, inProgress: 1 });
    assert.deepEqual(p.stats.questions[0], { id: single.id, final: [0, 1], pending: [1, 0], answered: 2 });
    assert.deepEqual(p.stats.questions[1].final, [1, 0, 1]);
    assert.deepEqual(p.stats.questions[2].final, [0, 0, 0, 0, 1]);
    assert.deepEqual(p.stats.questions[3].items, [{ text: 'Super prednáška', final: true }]);

    // Submitted answers are locked.
    assert.equal((await answer(A, single.id, 0)).status, 409);
    const me = (await call('GET', `/api/f/anketa?token=${A}`)).body.state;
    assert.equal(me.submitted, true);
    assert.equal(me.answers[single.id], 1);

    // B clears their only answer: no longer counted as in progress -> everyone is done.
    await answer(B, single.id, null);
    p = await sse.next((p) => p.stats.counts.inProgress === 0);
    assert.deepEqual(p.stats.counts, { submitted: 1, inProgress: 0 });

    // Questions are locked once responses exist; title can still change.
    const locked = await call('PUT', `/api/admin/forms/${created.id}`, { title: 'Anketa 2', slug: 'anketa', questions: [] });
    assert.equal(locked.status, 409);
    const sameQuestions = pres.questions.map(({ type, text, options }) => ({ type, text, options }));
    assert.equal((await call('PUT', `/api/admin/forms/${created.id}`, { title: 'Anketa 2', slug: 'anketa', questions: sameQuestions })).status, 200);

    await call('DELETE', `/api/admin/forms/${created.id}/responses`);
    p = await sse.next((p) => p.stats.counts.submitted === 0 && p.form.title === 'Anketa 2');
    sse.close();

    assert.equal((await fetch(`${base}/neexistuje`)).status, 404);
    assert.equal((await fetch(`${base}/anketa`)).status, 200);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('vyhodnocovací test: každý respondent dostane výsledok, plátno ukáže rozdelenie', async () => {
  const { server, base, call } = await setup();
  try {
    await call('POST', '/api/auth/login', { email: 'admin@example.com', password: 'tajneheslo' });
    const { body: created } = await call('POST', '/api/admin/forms', { title: 'Intro/Extro', slug: 'typ' });
    const questions = [
      // option 0 -> introvert, option 1 -> extrovert
      { type: 'single', text: 'Večierok?', options: ['Doma s knihou', 'Na párty'], scores: [[2, 0], [0, 2]] },
      { type: 'scale', text: 'Rád rozprávam s cudzími', scores: [[2, 0], [1, 0], [0, 0], [0, 1], [0, 2]] },
      { type: 'text', text: 'Poznámka' },
    ];
    const put = (body) => call('PUT', `/api/admin/forms/${created.id}`, { title: 'Intro/Extro', slug: 'typ', ...body });

    assert.equal((await put({ mode: 'scored', categories: ['Introvert'], questions })).status, 400);
    assert.equal((await put({ mode: 'scored', categories: ['Introvert', 'Extrovert'], questions: [{ ...questions[0], scores: [[1, 0]] }] })).status, 400);
    const saved = await put({ mode: 'scored', categories: ['Introvert', 'Extrovert'], showQuestions: true, resultTitle: ' Kto sme? ', questions });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    await call('PUT', `/api/admin/forms/${created.id}/status`, { status: 'open' });

    const pres = (await call('GET', '/api/p/typ')).body;
    assert.deepEqual(pres.form.categories, ['Introvert', 'Extrovert']);
    assert.equal(pres.form.showQuestions, true);
    assert.equal(pres.form.resultTitle, 'Kto sme?');
    assert.equal(pres.questions[0].scores, undefined, 'body sa nesmú posielať verejne');
    const [party, talk, note] = pres.questions;

    const answer = (token, questionId, value) => call('PUT', '/api/f/typ/answers', { token, questionId, value });
    const submit = (token) => call('POST', '/api/f/typ/submit', { token });
    const [A, B, C, D] = ['a', 'b', 'c', 'd'].map((x) => x.repeat(32));

    await answer(A, party.id, 0); await answer(A, talk.id, 1); await submit(A); // 3:0 introvert
    await answer(B, party.id, 1); await answer(B, talk.id, 4); await submit(B); // 0:4 extrovert
    await answer(C, party.id, 0); await answer(C, talk.id, 4);                   // 2:2 tie, pending
    await answer(D, note.id, 'len text');                                         // nothing scored -> not counted

    let stats = (await call('GET', '/api/p/typ')).body.stats;
    assert.deepEqual(stats.result, { final: [1, 1, 0], pending: [0, 0, 1] });

    // C changes their mind: the result moves while pending, then becomes final.
    await answer(C, talk.id, 0); // 4:0
    await submit(C);
    stats = (await call('GET', '/api/p/typ')).body.stats;
    assert.deepEqual(stats.result, { final: [2, 1, 0], pending: [0, 0, 0] });

    assert.deepEqual((await call('GET', `/api/f/typ?token=${A}`)).body.state.result, ['Introvert']);
    assert.deepEqual((await call('GET', `/api/f/typ?token=${B}`)).body.state.result, ['Extrovert']);

    // Scores can be changed even after responses exist; results are recomputed.
    const flipped = questions.map((q) => ({ ...q, scores: q.scores?.map(([i, e]) => [e, i]) }));
    assert.equal((await put({ mode: 'scored', categories: ['Introvert', 'Extrovert'], questions: flipped })).status, 200);
    stats = (await call('GET', '/api/p/typ')).body.stats;
    assert.deepEqual(stats.result.final, [1, 2, 0]);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('Wi-Fi QR kód sa posiela iba keď je nastavený hotspot', async () => {
  for (const wifiSsid of [undefined, 'jurajkurek.com']) {
    const { server, call } = await setup({ wifiSsid });
    try {
      await call('POST', '/api/auth/login', { email: 'admin@example.com', password: 'tajneheslo' });
      await call('POST', '/api/admin/forms', { title: 'X', slug: 'x' });
      const { wifi } = (await call('GET', '/api/p/x')).body;
      if (!wifiSsid) assert.equal(wifi, null);
      else {
        assert.equal(wifi.ssid, 'jurajkurek.com');
        assert.match(wifi.qrSvg, /^<svg/);
      }
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }
});

test('test konzistencie: dve kolá, kolo 1 je skryté, plátno ukáže histogram zhôd', async () => {
  const { server, base, call } = await setup();
  try {
    await call('POST', '/api/auth/login', { email: 'admin@example.com', password: 'tajneheslo' });
    const { body: created } = await call('POST', '/api/admin/forms', { title: 'Farby písmen', slug: 'farby' });
    assert.equal((await call('PUT', `/api/admin/forms/${created.id}`, { title: 'Farby písmen', slug: 'farby', mode: 'consistency', questions: [] })).status, 200);
    await call('PUT', `/api/admin/forms/${created.id}/status`, { status: 'open' });
    assert.match(await (await fetch(`${base}/farby`)).text(), /colors-present\.js/);
    assert.match(await (await fetch(`${base}/farby/vyplnit`)).text(), /colors-fill\.js/);

    const { letters, colors } = (await call('GET', '/api/k/farby')).body;
    assert.equal(letters.length, 9);
    assert.equal(colors.length, 8);
    const pick = (token, round, letter, color) => call('PUT', '/api/k/farby/pick', { token, round, letter, color });
    const fillRound = async (token, round, colorOf) => {
      let res;
      for (const [i, l] of letters.entries()) res = await pick(token, round, l, colorOf(i));
      return res;
    };
    const [A, B, C] = ['a', 'b', 'c'].map((x) => x.repeat(32));

    assert.equal((await pick(A, 1, 'X', 0)).status, 400);
    assert.equal((await pick(A, 1, 'A', 8)).status, 400);
    assert.equal((await pick(A, 2, 'A', 0)).status, 409, 'kolo 2 ešte nebeží');

    // Round 1: A and B finish, C only starts.
    const done1 = await fillRound(A, 1, (i) => i % 8);
    assert.deepEqual(done1.body.state.done, [true, false]);
    assert.deepEqual(done1.body.state.picks[1], {}, 'farby z kola 1 sa nesmú vrátiť');
    assert.equal((await pick(A, 1, 'A', 3)).status, 409, 'hotové kolo sa nedá meniť');
    await fillRound(B, 1, () => 0);
    await pick(C, 1, 'A', 0);
    let stats = (await call('GET', '/api/p/farby')).body.stats;
    assert.deepEqual(stats.rounds, [{ done: 2, inProgress: 1 }, { done: 0, inProgress: 0 }]);

    // Changing the round requires a logged-in presenter.
    assert.equal((await fetch(`${base}/api/p/farby/phase`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"phase":"round2"}' })).status, 401);
    await call('PUT', '/api/p/farby/phase', { phase: 'break' });
    assert.equal((await pick(C, 1, 'B', 0)).status, 200, 'počas prestávky sa kolo 1 dá dokončiť');
    await call('PUT', '/api/p/farby/phase', { phase: 'round2' });
    assert.equal((await pick(C, 1, 'D', 0)).status, 409, 'v kole 2 je kolo 1 zavreté');
    assert.equal((await pick(C, 2, 'A', 0)).status, 409, 'bez dokončeného kola 1 sa kolo 2 nedá');

    // Round 2: A keeps the colour of the first 4 letters and shifts the rest, B repeats all 9.
    const doneA = await fillRound(A, 2, (i) => (i < 4 ? i : (i + 1) % 8));
    assert.equal(doneA.body.state.matches, 4);
    assert.deepEqual(Object.keys(doneA.body.state.picks[1]), letters, 'po kole 2 sa ukážu obe kolá');
    await fillRound(B, 2, () => 0);
    stats = (await call('GET', '/api/p/farby')).body.stats;
    assert.deepEqual(stats.histogram, [0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    assert.deepEqual(stats.counts, { submitted: 2, inProgress: 1 });
    assert.equal((await call('GET', `/api/k/farby?token=${B}`)).body.state.matches, 9);

    // Clearing responses starts the test over from round 1.
    await call('DELETE', `/api/admin/forms/${created.id}/responses`);
    const pres = (await call('GET', '/api/p/farby')).body;
    assert.equal(pres.form.phase, 'round1');
    assert.deepEqual(pres.stats.histogram, Array(10).fill(0));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
