/* =====================================================================
   app.js – logika stránky Autoškola (čisté JS, bez frameworkov)
   Sekcie: 1 pomôcky · 2 dáta a stav · 3 výber otázok · 4 úvodná obrazovka
           5 test · 6 výsledky · 7 štatistiky · 8 prehľad otázok · 9 router a udalosti
   ===================================================================== */
(function () {
    'use strict';

    /* ---------- 1. POMÔCKY ---------- */
    const P = 'autoskola.v1.';                         // predpona kľúčov v localStorage
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const load = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const save = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { toast('Údaje sa nepodarilo uložiť (plné úložisko?).'); } };
    const del = k => { try { localStorage.removeItem(P + k); } catch (e) { } };
    const ico = n => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`;
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
    const plural = (n, a, b, c) => n === 1 ? a : (n >= 2 && n <= 4 ? b : c);   // 1 otázka, 2 otázky, 5 otázok
    const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();   // hľadanie bez diakritiky
    const fmtTime = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
    const fmtDate = t => { const d = new Date(t); return d.toLocaleDateString('sk-SK') + ' ' + d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }); };
    const modeName = m => m === 'exam' ? 'Skúška' : 'Precvičovanie';

    function toast(m) {
        const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; $('#toasts').append(t);
        setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
    }
    // Dialóg (natívny <dialog>); vráti hodnotu data-v stlačeného tlačidla alebo null (Esc)
    function modal(cls, inner) {
        return new Promise(res => {
            const d = document.createElement('dialog'); d.className = 'dlg ' + cls; d.innerHTML = `<div class="dlg-box">${inner}</div>`;
            d.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) d.close(b.dataset.v); });
            d.addEventListener('close', () => { d.remove(); res(d.returnValue || null); });
            document.body.append(d); d.showModal();
        });
    }
    const ask = (title, body, acts) => modal('', `<h2>${esc(title)}</h2><p class="dlg-body">${esc(body)}</p><div class="dlg-actions">${acts.map(a => `<button type="button" class="btn ${a.c}" data-v="${a.v}">${esc(a.l)}</button>`).join('')}</div>`);
    function confetti() {
        const c = document.createElement('div'), cols = ['#FFB400', '#0F7A3B', '#BE2A2A', '#3B82F6', '#EEF1F6'];
        c.className = 'confetti'; c.setAttribute('aria-hidden', 'true');
        c.innerHTML = Array.from({ length: 40 }, () => `<i style="left:${Math.random() * 100}%;background:${cols[Math.random() * cols.length | 0]};--d:${1.8 + Math.random() * 1.6}s;--delay:${Math.random() * .5}s;--x:${(Math.random() - .5) * 160}px;--r:${Math.random() * 720}deg"></i>`).join('');
        document.body.append(c); setTimeout(() => c.remove(), 4500);
    }

    /* ---------- 2. DÁTA A STAV ---------- */
    // Otázky: premenná OTAZKY z data.js (alebo súbor nahraný priamo v stránke)
    const Q = Array.isArray(window.OTAZKY) ? window.OTAZKY : load('data', []);
    // Otázky, ku ktorým zatiaľ chýba obrázok. Stačí dať súbor images/<ID>.png a zobrazí sa (pozri README).
    const MISSING = new Set(['A-146', 'B-101', 'B-115', 'B-116', 'B-126']);
    const byId = {}; Q.forEach(q => { byId[q.id] = q; });
    const GROUPS = [...new Set(Q.map(q => q.skupina))].sort();

    const DEF = { groups: GROUPS.slice(), count: 20, each: false, order: 'random', shuffleOpts: false, source: 'all', mode: 'practice', timer: false, minutes: 30, pass: 90 };
    let S = Object.assign({}, DEF, load('settings', {}));          // posledné nastavenia testu
    S.groups = S.groups.filter(g => GROUPS.includes(g));
    let prog = load('progress', {});                               // { id: { ok, bad, last } }  last: 1 správne / 0 zle
    let stars = new Set(load('stars', []));
    let hist = load('history', []);
    let T = load('session', null);                                 // rozpracovaný test
    let R = load('last', null);                                    // posledné výsledky
    if (T && !T.ids.every(id => byId[id])) T = null;
    const B = { q: '', g: 'all' };                                 // filter v prehľade otázok
    let dir = 'next', tid = null;

    const persist = () => { if (T) save('session', T); };

    /* ---------- 3. VÝBER OTÁZOK ---------- */
    // Otázky podľa vybraných skupín a zdroja
    function pool() {
        return Q.filter(q => S.groups.includes(q.skupina) && ({
            all: true, new: !prog[q.id], wrong: !!prog[q.id] && prog[q.id].last === 0, star: stars.has(q.id)
        })[S.source]);
    }
    const take = (arr, n, rnd) => (rnd ? shuffle(arr) : arr).slice(0, n);
    // „Z každej skupiny“ alebo spolu; S.count môže byť číslo alebo 'all'
    function pick(rnd) {
        const p = pool(), n = S.count === 'all' ? Infinity : S.count;
        return S.each ? S.groups.flatMap(g => take(p.filter(q => q.skupina === g), n, rnd)) : take(p, n, rnd);
    }

    /* ---------- 4. ÚVODNÁ OBRAZOVKA ---------- */
    const seg = (name, v, label, on, extra = '') => `<label class="seg"><input type="radio" name="${name}" value="${v}"${on ? ' checked' : ''}><span>${label}${extra}</span></label>`;
    const sw = (id, on, title, sub = '') => `<label class="switch-row"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span class="switch"></span><span class="switch-text">${title}${sub ? `<small>${sub}</small>` : ''}</span></label>`;
    const modeCard = (v, t, d) => `<label class="mode-card"><input type="radio" name="mode" value="${v}"${S.mode === v ? ' checked' : ''}><span class="mode-body"><b>${t}</b><span>${d}</span></span></label>`;

    function viewHome() {
        const quick = [10, 20, 30, 40, 'all'];
        const nNew = Q.filter(q => !prog[q.id]).length, nWrong = Q.filter(q => prog[q.id] && prog[q.id].last === 0).length;
        const src = [['all', 'Všetky', Q.length], ['new', 'Ešte neodpovedané', nNew], ['wrong', 'Naposledy zle', nWrong], ['star', 'S hviezdičkou', stars.size]];
        const resume = T ? `<section class="card resume"><div class="resume-row"><div><h2>Rozpracovaný test</h2><p class="muted">Otázka ${T.i + 1} z ${T.ids.length} · ${modeName(T.mode)}</p></div><div class="resume-actions"><button type="button" class="btn btn-primary" data-act="resume">${ico('play')}Pokračovať</button><button type="button" class="btn btn-ghost" data-act="discard">Zahodiť</button></div></div></section>` : '';
        return `<section class="view view-enter">
  <header class="page-head"><h1>Priprav sa na test</h1><p class="lead">Vyber skupiny, počet otázok a režim. Postup sa ti ukladá v tomto prehliadači.</p></header>
  ${resume}
  <div class="home-grid">
    <div class="home-col">
      <section class="card"><div class="card-head"><div style="display:flex;align-items:center;gap:8px"><h2>Skupiny</h2><div class="group-tools"><button type="button" class="btn btn-ghost btn-sm" data-act="gall">Všetky</button><button type="button" class="btn btn-ghost btn-sm" data-act="gnone">Žiadne</button></div></div></div>
        <div class="gcards">${GROUPS.map(g => `<label class="gcard"><input type="checkbox" name="g" value="${g}"${S.groups.includes(g) ? ' checked' : ''}><span class="gcard-body"><span class="gcard-letter">${g}</span><span class="gcard-text"><b>Skupina ${g}</b><small>${Q.filter(q => q.skupina === g).length} otázok</small></span><span class="gcard-check">${ico('check')}</span></span></label>`).join('')}</div></section>
      <section class="card"><div class="card-head"><h2>Počet otázok</h2></div>
        <div class="count-row"><div class="seg-row" role="radiogroup" aria-label="Počet otázok">${quick.map(v => seg('count', v, v === 'all' ? 'Všetky' : v, S.count === v)).join('')}</div>
          <label class="field">Vlastný počet<input type="number" class="num-input" id="c-custom" min="1" max="999" inputmode="numeric" value="${quick.includes(S.count) ? '' : S.count}"></label></div>
        ${sw('c-each', S.each, 'Z každej vybranej skupiny', 'napr. 30 otázok z každej skupiny')}</section>
      <section class="card"><div class="card-head"><h2>Zdroj a poradie</h2></div>
        <fieldset class="seg-group"><legend>Zdroj otázok</legend><div class="seg-row">${src.map(s => seg('source', s[0], s[1], S.source === s[0], ` <small>${s[2]}</small>`)).join('')}</div></fieldset>
        <fieldset class="seg-group"><legend>Poradie otázok</legend><div class="seg-row">${seg('order', 'random', 'Náhodné', S.order === 'random')}${seg('order', 'number', 'Podľa čísla', S.order === 'number')}</div></fieldset>
        ${sw('o-shuf', S.shuffleOpts, 'Náhodné poradie odpovedí', 'možnosti A–D sa premiešajú')}</section>
    </div>
    <div class="home-col sticky">
      <section class="card"><div class="card-head"><h2>Režim</h2></div>
        <div class="mode-cards">${modeCard('practice', 'Precvičovanie', 'Po potvrdení hneď vidíš správnu odpoveď.')}${modeCard('exam', 'Skúška', 'Vyhodnotenie až na konci testu.')}</div>
        <div class="exam-extras"${S.mode === 'exam' ? '' : ' hidden'}>
          ${sw('x-timer', S.timer, 'Časovač', 'test sa po vypršaní času vyhodnotí')}
          <div class="field-inline"><label for="x-min">Čas (minút)</label><input type="number" class="num-input" id="x-min" min="1" max="300" value="${S.minutes}"></div>
          <div class="field-inline"><label for="x-pass">Hranica úspešnosti (%)</label><input type="number" class="num-input" id="x-pass" min="1" max="100" value="${S.pass}"></div></div></section>
      <section class="display is-dock" aria-live="polite">
        <div class="display-top"><div class="display-main" id="d-n">0</div><div class="display-unit" id="d-u"></div></div>
        <div class="display-groups" id="d-g"></div><div class="display-note" id="d-note"></div>
        <button type="button" class="btn btn-primary btn-lg btn-block" id="d-start" data-act="start">${ico('play')}Spustiť test</button></section>
    </div>
  </div></section>`;
    }

    // Prepočíta „displej“ s počtom otázok podľa aktuálneho nastavenia
    function updateDisplay() {
        const picks = pick(false), n = picks.length, cnt = {};
        picks.forEach(q => { cnt[q.skupina] = (cnt[q.skupina] || 0) + 1; });
        $('#d-n').textContent = n;
        $('#d-u').innerHTML = plural(n, 'otázka', 'otázky', 'otázok') + '<br>v teste';
        $('#d-g').innerHTML = S.groups.map(g => `<span class="led-chip">${g}<small>${cnt[g] || 0}</small></span>`).join('');
        const note = $('#d-note');
        note.className = 'display-note' + (n ? '' : ' warn');
        note.textContent = !S.groups.length ? 'Vyber aspoň jednu skupinu.' : !n ? 'Pre tento výber nie sú žiadne otázky.'
            : (S.count !== 'all' && !S.each && n < S.count) ? `K dispozícii je len ${n} otázok.`
                : (S.mode === 'exam' && S.timer ? `Čas na test: ${S.minutes} min` : '');
        $('#d-start').disabled = !n;
    }

    function viewNoData() {
        return `<section class="view view-enter"><div class="card empty"><h2>Chýbajú otázky</h2><p>Súbor <code>data.js</code> sa nenačítal alebo je prázdny (pozri README, krok „Vytvorenie data.js“). Môžeš si tu aj rovno nahrať <code>otazky.json</code>, uloží sa len v tomto prehliadači.</p><label class="btn btn-primary">${ico('upload')}Nahrať otazky.json<input type="file" id="nd-imp" accept=".json,application/json" hidden></label></div></section>`;
    }

    /* ---------- 5. TEST ---------- */
    const cur = () => byId[T.ids[T.i]];
    const opts = q => T.ord[q.id] ? T.ord[q.id].map(id => q.moznosti.find(o => o.id === id)) : q.moznosti;
    const isOk = (q, sel) => sel.length === q.spravne.length && q.spravne.every(k => sel.includes(k));
    // Zodpovedaná: v precvičovaní po potvrdení, v skúške ak je niečo vybraté
    const isAns = id => { const a = T.ans[id]; return !!a && (T.mode === 'practice' ? !!a.done : a.sel.length > 0); };
    const answered = () => T.ids.filter(isAns).length;

    function start(ids, o) {
        T = { ids, i: 0, ans: {}, ord: {}, mode: o.mode, timer: o.mode === 'exam' && !!o.timer, limit: o.minutes * 60, pass: o.pass, el: 0 };
        if (o.shuffleOpts) ids.forEach(id => { T.ord[id] = shuffle(byId[id].moznosti.map(x => x.id)); });
        dir = 'next'; persist(); go('#/test');
    }
    function record(q, ok) {
        const p = prog[q.id] || (prog[q.id] = { ok: 0, bad: 0, last: 1 });
        ok ? p.ok++ : p.bad++; p.last = ok ? 1 : 0; save('progress', prog);
    }
    const imgSrc = q => q.obrazok || (MISSING.has(q.id) ? 'images/' + q.id + '.png' : null);
    const NOIMG = `<div class="img-missing">${ico('image')}<span>K tejto otázke zatiaľ chýba obrázok.</span></div>`;
    const figure = q => { const s = imgSrc(q); return s ? `<figure class="qfigure"><button type="button" data-act="zoom" data-src="${esc(s)}" aria-label="Zväčšiť obrázok"><img src="${esc(s)}" alt="Obrázok k otázke" data-fb="1"><span class="zoom-tag">${ico('zoom')}Zväčšiť</span></button></figure>` : ''; };

    function viewTest() {
        const q = cur(), n = T.ids.length, multi = q.spravne.length > 1;
        return `<section class="view test">
  <div class="test-display">
    <div class="td-row">
      <button type="button" class="btn btn-ghost" data-act="quit">${ico('stop')}Ukončiť</button>
      <div class="td-count" aria-label="Otázka ${T.i + 1} z ${n}"><b>${T.i + 1}</b><span>/ ${n}</span></div>
      <button type="button" class="btn-icon star" data-act="star" data-id="${q.id}" aria-pressed="${stars.has(q.id)}" aria-label="Označiť hviezdičkou">${ico('star')}</button>
    </div>
    <div class="td-stats"><div id="t-stats"></div><span class="timer" id="t-timer">${ico('clock')}<span class="led"></span></span></div>
    <div class="roadbar" id="t-bar" role="progressbar" aria-label="Postup testu" aria-valuemin="0" aria-valuemax="${n}"><div class="roadbar-fill"></div></div>
  </div>
  <article class="qcard enter-${dir}">
    <div class="qmeta"><span class="pill pill-accent">Skupina ${q.skupina}</span><span class="pill">${q.id}</span>${multi ? '<span class="pill">Viac správnych</span>' : ''}</div>
    <h2 class="qtext" tabindex="-1">${esc(q.otazka)}</h2>
    <p class="qhint">${multi ? 'Označ všetky správne odpovede.' : 'Vyber jednu odpoveď.'}</p>
    ${figure(q)}
    <div class="options${multi ? ' multi' : ''}" role="group" aria-label="Možnosti odpovede">${opts(q).map((o, k) => `<button type="button" class="opt" data-act="opt" data-k="${o.id}" aria-pressed="false"><span class="opt-key">${'ABCDEFGH'[k]}</span><span class="opt-text">${esc(o.text)}</span><span class="opt-mark">${ico('check')}</span></button>`).join('')}</div>
    <div class="feedback" id="fb" aria-live="polite"></div>
  </article>
  <div class="actionbar">
    <button type="button" class="btn btn-secondary" id="t-back" data-act="back" aria-label="Späť">${ico('back')}</button>
    <button type="button" class="btn btn-secondary" data-act="skip">${ico('skip')}<span>Preskočiť</span></button>
    <button type="button" class="btn btn-primary btn-lg" id="t-main" data-act="main"></button>
  </div>
  <p class="kbd-hint"><kbd>A</kbd>–<kbd>D</kbd> alebo <kbd>1</kbd>–<kbd>4</kbd> výber · <kbd>Enter</kbd> potvrdiť / ďalej</p></section>`;
    }

    // Prekreslí stav možností, tlačidiel a horného panelu podľa T
    function paint() {
        const q = cur(), a = T.ans[q.id] || { sel: [] }, rev = T.mode === 'practice' && !!a.done, last = T.i === T.ids.length - 1, multi = q.spravne.length > 1;
        $$('.opt').forEach(b => {
            const k = b.dataset.k, s = a.sel.includes(k), c = q.spravne.includes(k);
            b.className = 'opt' + (rev ? (c ? (s || !multi ? ' is-correct' : ' is-missed') : (s ? ' is-wrong' : ' is-dim')) : (s ? ' is-selected' : ''));   // „prehliadnutá“ len pri viacerých správnych
            b.setAttribute('aria-pressed', s); rev ? b.setAttribute('aria-disabled', 'true') : b.removeAttribute('aria-disabled');
            const old = $('.opt-tag', b); if (old) old.remove();
            const tag = rev ? (c ? (s ? 'Správne' : (multi ? 'Prehliadnutá správna odpoveď' : 'Správna odpoveď')) : (s ? 'Tvoja chybná odpoveď' : '')) : '';
            if (tag) $('.opt-text', b).insertAdjacentHTML('beforeend', `<span class="opt-tag">${tag}</span>`);
            $('.opt-mark use', b).setAttribute('href', rev && s && !c ? '#i-x' : '#i-check');
        });
        const fb = $('#fb');
        if (rev) { const ok = !!a.ok; fb.className = 'feedback ' + (ok ? 'ok' : 'bad'); fb.innerHTML = ok ? ico('check') + 'Správne!' : ico('x') + 'Nesprávne. Správna odpoveď je zvýraznená.'; }
        else { fb.className = 'feedback'; fb.innerHTML = ''; }
        const main = $('#t-main');
        main.disabled = T.mode === 'practice' ? (!a.done && !a.sel.length) : !a.sel.length;
        main.innerHTML = (T.mode === 'practice' ? (a.done ? (last ? 'Dokončiť' : 'Ďalej') : 'Potvrdiť') : (last ? 'Potvrdiť a dokončiť' : 'Potvrdiť')) + ico(T.mode === 'practice' && !a.done ? 'check' : 'next');
        $('#t-back').disabled = T.i === 0;
        let g = 0, bd = 0; T.ids.forEach(id => { const x = T.ans[id]; if (x && x.done && T.mode === 'practice') (x.ok ? g++ : bd++); });
        $('#t-stats').innerHTML = T.mode === 'practice'
            ? `<div class="td-score"><span class="good"><span class="led">${g}</span> správne</span><span class="bad"><span class="led">${bd}</span> zle</span></div>`
            : `<div class="td-score"><span>Zodpovedané <span class="led">${answered()}</span></span></div>`;
        const done = answered();
        $('#t-bar').setAttribute('aria-valuenow', done); $('#t-bar .roadbar-fill').style.width = (done / T.ids.length * 100) + '%';
    }

    function next() {
        if (T.i < T.ids.length - 1) { T.i++; dir = 'next'; persist(); draw(); } else finishAsk();
    }
    async function finishAsk() {
        const un = T.ids.length - answered();
        if (un) {
            const r = await ask('Dokončiť test?', `Nezodpovedané otázky: ${un}. Počítajú sa ako nesprávne.`, [{ l: 'Dokončiť', v: 'y', c: 'btn-primary' }, { l: 'Späť k testu', v: 'n', c: 'btn-secondary' }]);
            if (r !== 'y') return;
        }
        finish();
    }
    function finish() {
        stopTimer();
        const g = {}, w = []; let c = 0;
        T.ids.forEach(id => {
            const q = byId[id], a = T.ans[id], sel = a ? a.sel : [], ans = isAns(id), ok = ans && isOk(q, sel);
            if (T.mode === 'exam' && ans) record(q, ok);          // v skúške sa štatistika zapisuje až na konci
            const x = g[q.skupina] || (g[q.skupina] = { t: 0, c: 0 }); x.t++;
            if (ok) { c++; x.c++; } else w.push({ id, sel: ans ? sel : [] });
        });
        const n = T.ids.length, pct = Math.round(c / n * 100);
        R = { id: Date.now(), mode: T.mode, n, c, pct, pass: T.pass, ok: pct >= T.pass, time: T.el, g, w };
        hist.unshift(R); hist = hist.slice(0, 100);
        T = null; del('session'); save('last', R); save('history', hist);
        go('#/results');
        if (R.ok) confetti();
    }

    function startTimer() {
        stopTimer(); tickUI();
        tid = setInterval(() => {
            if (!T) return stopTimer();
            T.el++; if (T.el % 5 === 0) persist(); tickUI();
            if (T.timer && T.el >= T.limit) { stopTimer(); toast('Čas vypršal, test sa vyhodnotil.'); finish(); }
        }, 1000);
    }
    const stopTimer = () => { clearInterval(tid); tid = null; };
    function tickUI() {
        const t = $('#t-timer'); if (!t || !T) return;
        const left = T.timer ? T.limit - T.el : null;
        $('.led', t).textContent = fmtTime(left === null ? T.el : left);
        t.classList.toggle('low', left !== null && left <= 60);
    }

    // Akcie tlačidiel (data-act="...")
    const A = {
        opt(b) {
            const q = cur(), a = T.ans[q.id] || (T.ans[q.id] = { sel: [] });
            if (T.mode === 'practice' && a.done) return;
            const k = b.dataset.k;
            a.sel = q.spravne.length > 1 ? (a.sel.includes(k) ? a.sel.filter(x => x !== k) : [...a.sel, k]) : [k];
            persist(); paint();
        },
        main() {
            const q = cur(), a = T.ans[q.id] || { sel: [] };
            if (T.mode === 'practice' && a.done) return next();
            if (!a.sel.length) return;
            if (T.mode === 'practice') { a.done = true; a.ok = isOk(q, a.sel); T.ans[q.id] = a; record(q, a.ok); persist(); paint(); }
            else next();
        },
        skip() { next(); },
        back() { if (T.i > 0) { T.i--; dir = 'prev'; persist(); draw(); } },
        async quit() {
            const r = await ask('Ukončiť test?', 'Test môžeš uložiť a dokončiť neskôr, alebo ho hneď vyhodnotiť.', [{ l: 'Uložiť a odísť', v: 's', c: 'btn-primary' }, { l: 'Vyhodnotiť teraz', v: 'f', c: 'btn-secondary' }, { l: 'Pokračovať v teste', v: 'c', c: 'btn-ghost' }]);
            if (r === 's') { persist(); go('#/'); } else if (r === 'f') finish();
        },
        star(b) {
            const id = b.dataset.id; stars.has(id) ? stars.delete(id) : stars.add(id); save('stars', [...stars]);
            $$(`[data-act=star][data-id="${id}"]`).forEach(x => x.setAttribute('aria-pressed', stars.has(id)));
        },
        zoom(b) { modal('dlg-img', `<img src="${esc(b.dataset.src)}" alt="Obrázok k otázke"><div class="dlg-actions"><button type="button" class="btn btn-secondary" data-v="x">Zavrieť</button></div>`); },
        async start() {
            const picks = pick(S.order === 'random'); if (!picks.length) return;
            if (T && await ask('Prepísať rozpracovaný test?', 'Máš rozpracovaný test. Nový test ho nahradí.', [{ l: 'Spustiť nový', v: 'y', c: 'btn-primary' }, { l: 'Zrušiť', v: 'n', c: 'btn-secondary' }]) !== 'y') return;
            const set = new Set(picks.map(q => q.id));
            start(S.order === 'random' ? shuffle([...set]) : Q.filter(q => set.has(q.id)).map(q => q.id), S);
        },
        resume() { dir = 'next'; go('#/test'); },
        discard() { T = null; del('session'); draw(); },
        gall() { setGroups(GROUPS); },
        gnone() { setGroups([]); },
        retry() { start(R.w.map(x => x.id), { mode: 'practice', minutes: S.minutes, pass: R.pass, shuffleOpts: S.shuffleOpts }); },
        new() { go('#/'); },
        exp() {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify({ v: 1, progress: prog, stars: [...stars], history: hist, settings: S }, null, 1)], { type: 'application/json' }));
            a.download = 'autoskola-progres-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },
        imp() { $('#s-imp').click(); },
        async reset() {
            if (await ask('Zmazať všetok progres?', 'Zmaže sa história, štatistiky, hviezdičky aj rozpracovaný test. Toto sa nedá vrátiť späť.', [{ l: 'Zmazať všetko', v: 'y', c: 'btn-danger' }, { l: 'Zrušiť', v: 'n', c: 'btn-secondary' }]) !== 'y') return;
            ['progress', 'stars', 'history', 'session', 'last', 'settings'].forEach(del);
            prog = {}; stars = new Set(); hist = []; T = null; R = null; S = Object.assign({}, DEF);
            toast('Progres bol zmazaný.'); draw();
        }
    };
    function setGroups(gs) { S.groups = gs.slice(); $$('[name=g]').forEach(c => { c.checked = gs.includes(c.value); }); save('settings', S); updateDisplay(); }

    /* ---------- 6. VÝSLEDKY ---------- */
    const barRow = (label, t, c, pass) => {
        const pct = t ? Math.round(c / t * 100) : 0;
        return `<div class="bar-row"><span class="gl">${label}</span><div class="bar-track"><div class="bar-fill ${pct >= pass ? 'good' : pct >= pass - 20 ? 'mid' : 'low'}" data-w="${pct}"></div></div><span class="bar-val">${t ? pct + ' %' : '–'} <small>(${c} / ${t})</small></span></div>`;
    };
    const optText = (q, id) => { const o = q.moznosti.find(x => x.id === id); return o ? `${id.toUpperCase()}) ${esc(o.text)}` : ''; };

    function viewResults() {
        const r = R;
        return `<section class="view view-enter">
  <div class="card res-hero">
    <div class="ring${r.ok ? '' : ' fail'}" role="img" aria-label="Úspešnosť ${r.pct} %"><svg viewBox="0 0 120 120"><circle class="ring-track" cx="60" cy="60" r="54"/><circle class="ring-fill" cx="60" cy="60" r="54" data-pct="${r.pct}"/></svg><div class="ring-val"><b>${r.pct} %</b><span>${r.c} / ${r.n}</span></div></div>
    <div style="display:grid;gap:14px">
      <div class="res-verdict ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'Prešiel si!' : 'Neprešiel si'}</div>
      <div class="res-meta"><span class="pill">${modeName(r.mode)}</span><span class="pill">${ico('clock')}${fmtTime(r.time)}</span><span class="pill">Hranica ${r.pass} %</span></div>
      <div class="res-actions"><button type="button" class="btn btn-primary" data-act="retry"${r.w.length ? '' : ' disabled'}>${ico('repeat')}Opakovať chybné (${r.w.length})</button><button type="button" class="btn btn-secondary" data-act="new">Nový test</button></div>
    </div>
  </div>
  <section class="card"><div class="card-head"><h2>Úspešnosť podľa skupín</h2></div><div class="bars">${Object.keys(r.g).sort().map(k => barRow(k, r.g[k].t, r.g[k].c, r.pass)).join('')}</div></section>
  <section><h2 style="margin-bottom:12px">Chyby (${r.w.length})</h2>
  ${r.w.length ? `<ul class="mistakes">${r.w.map(x => {
            const q = byId[x.id]; return `<li class="mistake"><div class="mistake-head"><h3>${esc(q.otazka)}</h3><span class="pill">${q.id}</span></div>
    <div class="answer-line mine">${ico('x')}<div><b>Tvoja odpoveď</b>${x.sel.length ? x.sel.map(k => optText(q, k)).join('<br>') : 'Bez odpovede'}</div></div>
    <div class="answer-line right">${ico('check')}<div><b>Správna odpoveď</b>${q.spravne.map(k => optText(q, k)).join('<br>')}</div></div></li>`;
        }).join('')}</ul>` : '<div class="card empty">Žiadne chyby, super!</div>'}</section></section>`;
    }

    /* ---------- 7. ŠTATISTIKY ---------- */
    function viewStats() {
        const ids = Object.keys(prog).filter(id => byId[id]), avg = hist.length ? Math.round(hist.reduce((s, h) => s + h.pct, 0) / hist.length) : 0;
        const rows = GROUPS.map(g => { let ok = 0, bad = 0; Q.forEach(q => { if (q.skupina === g && prog[q.id]) { ok += prog[q.id].ok; bad += prog[q.id].bad; } }); return barRow(g, ok + bad, ok, S.pass); }).join('');
        const missed = ids.filter(id => prog[id].bad > 0).sort((a, b) => prog[b].bad - prog[a].bad).slice(0, 8);
        const tile = (n, t) => `<div class="tile"><b>${n}</b><span>${t}</span></div>`;
        return `<section class="view view-enter">
  <header class="page-head"><h1>Štatistiky</h1></header>
  <div class="tiles">${tile(hist.length, 'testov')}${tile(hist.length ? avg + ' %' : '–', 'priemerná úspešnosť')}${tile(ids.length, 'otázok vyskúšaných')}${tile(stars.size, 's hviezdičkou')}</div>
  <section class="card"><div class="card-head"><h2>Úspešnosť podľa skupín</h2><p>Zo všetkých tvojich odpovedí.</p></div><div class="bars">${rows}</div></section>
  <section class="card"><div class="card-head"><h2>Najčastejšie chyby</h2></div>${missed.length ? `<ul class="most-missed">${missed.map(id => `<li><span class="id">${id}</span><span>${esc(byId[id].otazka)}</span><span class="pill pill-bad">${prog[id].bad}× zle</span></li>`).join('')}</ul>` : '<p class="muted">Zatiaľ žiadne chyby.</p>'}</section>
  <section class="card"><div class="card-head"><h2>História testov</h2></div>${hist.length ? `<ul class="hist">${hist.slice(0, 15).map(h => `<li><span class="when">${fmtDate(h.id)}</span><span class="score">${h.pct} %<small>${h.c} / ${h.n}</small></span><span class="sub">${modeName(h.mode)} · ${fmtTime(h.time)} · ${h.ok ? 'prešiel' : 'neprešiel'}</span></li>`).join('')}</ul>` : '<p class="muted">Zatiaľ si neurobil žiadny test.</p>'}</section>
  <section class="card"><div class="card-head"><h2>Záloha progresu</h2><p>Export a import progresu do súboru JSON.</p></div>
    <div class="tools"><button type="button" class="btn btn-secondary" data-act="exp">${ico('download')}Exportovať</button><button type="button" class="btn btn-secondary" data-act="imp">${ico('upload')}Importovať</button><button type="button" class="btn btn-danger" data-act="reset">${ico('trash')}Zmazať progres</button></div>
    <input type="file" id="s-imp" accept=".json,application/json" hidden></section></section>`;
    }

    /* ---------- 8. PREHĽAD OTÁZOK ---------- */
    function viewBrowse() {
        return `<section class="view view-enter">
  <header class="page-head"><h1>Otázky</h1><p class="lead">Všetky otázky so správnymi odpoveďami.</p></header>
  <div class="filters"><label class="search">${ico('search')}<input type="search" class="text-input" id="b-q" placeholder="Hľadať v otázkach a odpovediach…" aria-label="Hľadať" value="${esc(B.q)}"></label>
    <div class="chips" role="radiogroup" aria-label="Filter skupiny">${[['all', 'Všetky'], ...GROUPS.map(g => [g, g]), ['star', 'Hviezdičky']].map(x => seg('bg', x[0], x[1], B.g === x[0])).join('')}</div></div>
  <p class="muted" id="b-n"></p><ol class="qlist" id="b-list"></ol></section>`;
    }
    const itemHtml = x => {
        const p = prog[x.id];
        return `<li class="qitem"><div class="qitem-head"><span class="pill pill-accent">${x.id}</span>${x.spravne.length > 1 ? '<span class="pill">Viac správnych</span>' : ''}<span class="grow"></span>${p ? `<span class="qitem-stats"><span class="pill pill-ok">${p.ok}×</span><span class="pill pill-bad">${p.bad}×</span></span>` : ''}<button type="button" class="btn-icon star" data-act="star" data-id="${x.id}" aria-pressed="${stars.has(x.id)}" aria-label="Označiť hviezdičkou">${ico('star')}</button></div>
  <h3>${esc(x.otazka)}</h3><ol>${x.moznosti.map(o => `<li${x.spravne.includes(o.id) ? ' class="is-correct"' : ''}><span class="k">${o.id.toUpperCase()}</span><span>${esc(o.text)}</span></li>`).join('')}</ol></li>`;
    };
    function fillBrowse() {
        const q = norm(B.q.trim());
        const list = Q.filter(x => (B.g === 'all' || (B.g === 'star' ? stars.has(x.id) : x.skupina === B.g)) &&
            (!q || (x._n || (x._n = norm(x.otazka + ' ' + x.moznosti.map(o => o.text).join(' ')))).includes(q)));
        $('#b-n').textContent = `Zobrazených ${list.length} z ${Q.length}`;
        $('#b-list').innerHTML = list.map(itemHtml).join('') || '<li class="empty">Nič sa nenašlo.</li>';
    }

    /* ---------- 9. ROUTER A UDALOSTI ---------- */
    const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/')[0];
    function go(h) { location.hash === h ? draw() : (location.hash = h); }

    function draw() {
        let r = route();
        if (!Q.length) r = 'nodata';
        if ((r === 'test' && !T) || (r === 'results' && !R)) return go('#/');
        stopTimer();
        document.body.classList.toggle('in-test', r === 'test');
        const views = { '': viewHome, browse: viewBrowse, stats: viewStats, test: viewTest, results: viewResults, nodata: viewNoData };
        $('#app').innerHTML = (views[r] || viewHome)();
        const navId = r === 'browse' ? 'browse' : r === 'stats' ? 'stats' : 'home';
        $$('[data-nav]').forEach(a => a.dataset.nav === navId ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
        if (r === '' || !views[r]) updateDisplay();
        if (r === 'browse') fillBrowse();
        if (r === 'test') { paint(); startTimer(); $('.qtext').focus({ preventScroll: true }); }
        if (r === 'results' || r === 'stats') requestAnimationFrame(() => requestAnimationFrame(() => {
            $$('.bar-fill[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
            const rf = $('.ring-fill'); if (rf) rf.style.strokeDashoffset = 339.3 * (1 - rf.dataset.pct / 100);
        }));
        window.scrollTo(0, 0);
    }

    // Formuláre: ukladanie nastavení a filtrov
    function onForm(e) {
        const t = e.target, n = t.name, id = t.id;
        if (n === 'g') S.groups = $$('[name=g]:checked').map(c => c.value);
        else if (n === 'count') { S.count = t.value === 'all' ? 'all' : +t.value; $('#c-custom').value = ''; }
        else if (id === 'c-custom') { const v = parseInt(t.value, 10); if (!(v > 0)) return; S.count = Math.min(v, 999); $$('[name=count]').forEach(x => { x.checked = false; }); }
        else if (id === 'c-each') S.each = t.checked;
        else if (n === 'source' || n === 'order') S[n] = t.value;
        else if (id === 'o-shuf') S.shuffleOpts = t.checked;
        else if (n === 'mode') { S.mode = t.value; $('.exam-extras').hidden = S.mode !== 'exam'; }
        else if (id === 'x-timer') S.timer = t.checked;
        else if (id === 'x-min') { const v = parseInt(t.value, 10); if (v > 0) S.minutes = Math.min(v, 300); }
        else if (id === 'x-pass') { const v = parseInt(t.value, 10); if (v > 0) S.pass = Math.min(v, 100); }
        else if (id === 'b-q') { B.q = t.value; return fillBrowse(); }
        else if (n === 'bg') { B.g = t.value; return fillBrowse(); }
        else return;
        save('settings', S); updateDisplay();
    }
    const app = $('#app');
    app.addEventListener('input', onForm);
    app.addEventListener('change', onForm);
    app.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && A[b.dataset.act]) A[b.dataset.act](b, e); });
    // Ak sa obrázok nenačíta, ukáže sa náhradný text
    app.addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.dataset.fb) e.target.closest('figure').outerHTML = NOIMG; }, true);

    // Import súborov (progres alebo otazky.json)
    app.addEventListener('change', async e => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        try {
            const d = JSON.parse(await f.text());
            if (e.target.id === 'nd-imp') {
                if (!Array.isArray(d) || !d.every(q => q.id && q.skupina && Array.isArray(q.moznosti) && Array.isArray(q.spravne))) throw 0;
                save('data', d); location.reload();
            } else if (e.target.id === 's-imp') {
                if (!d || typeof d.progress !== 'object') throw 0;
                if (await ask('Importovať progres?', 'Súčasný progres sa nahradí údajmi zo súboru.', [{ l: 'Importovať', v: 'y', c: 'btn-primary' }, { l: 'Zrušiť', v: 'n', c: 'btn-secondary' }]) !== 'y') return;
                prog = d.progress; stars = new Set(d.stars || []); hist = d.history || []; if (d.settings) S = Object.assign({}, DEF, d.settings);
                save('progress', prog); save('stars', [...stars]); save('history', hist); save('settings', S);
                toast('Progres bol importovaný.'); draw();
            }
        } catch (err) { toast('Súbor sa nepodarilo načítať, skontroluj ho.'); }
        e.target.value = '';
    });

    // Klávesové skratky v teste
    document.addEventListener('keydown', e => {
        if (route() !== 'test' || !T || $('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        const k = e.key.toLowerCase(), i = k.length === 1 ? ('abcd'.indexOf(k) >= 0 ? 'abcd'.indexOf(k) : '1234'.indexOf(k)) : -1;
        if (i >= 0) { const b = $$('.opt')[i]; if (b) { e.preventDefault(); b.click(); } }
        else if (e.key === 'Enter') {
            if (e.target.closest('button') && !e.target.classList.contains('opt') && e.target.id !== 't-main') return;
            e.preventDefault(); A.main();
        }
    });

    $('#theme-toggle').addEventListener('click', () => {
        const el = document.documentElement, cur = el.getAttribute('data-theme');
        const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
        el.setAttribute('data-theme', dark ? 'light' : 'dark'); save('theme', dark ? 'light' : 'dark');
    });
    window.addEventListener('hashchange', draw);
    window.addEventListener('pagehide', persist);
    draw();
})();