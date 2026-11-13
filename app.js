/* The Daily Brief: phone app. Plain JS, no build step. */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const TZ = 'America/New_York';
  const LOOKBACK_DAYS = 7;

  // Section order. Each agent writes one file: data/days/<YYYY-MM-DD>/<id>.json
  const SECTIONS = [
    { id: 'brief', title: 'Today' },
    { id: 'schedule', title: 'Schedule' },
    { id: 'school', title: 'School' },
    { id: 'career', title: 'Career' },
    { id: 'work', title: 'Work' },
    { id: 'inbox', title: 'Inbox' },
    { id: 'fitness', title: 'Fitness' },
    { id: 'goals', title: 'Goals' },
    { id: 'money', title: 'Money' },
    { id: 'news', title: 'News' },
    { id: 'coming_up', title: 'Coming up' },
  ];

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const LOOK_COLORS = { clean: '#1f5fe0', glass: '#1f5fe0', midnight: '#0a1430', sky: '#cfe0ff', newspaper: '#f4f0e6' };
  function applyLook(look) {
    if (!LOOK_COLORS[look]) look = 'clean';
    document.documentElement.dataset.look = look;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', LOOK_COLORS[look]);
    return look;
  }
  applyLook(new URLSearchParams(location.search).get('look') || store.get('look') || 'clean');

  const state = {
    date: todayET(),
    demo: store.get('demo') === '1',
    key: null,
    cryptoCfg: null,
  };

  // ---------- dates ----------
  function todayET() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return p; // en-CA gives YYYY-MM-DD
  }
  function shiftDate(iso, days) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(fromIso, toIso) {
    return Math.round((new Date(toIso + 'T12:00:00Z') - new Date(fromIso + 'T12:00:00Z')) / 86400000);
  }
  function prettyDate(iso, opts) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }, opts || {}));
  }
  function shortDate(iso) {
    return prettyDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function relDays(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? 'in ' + n + ' days' : Math.abs(n) + ' days ago';
  }
  function timeAgo(isoTs) {
    const t = Date.parse(isoTs);
    if (isNaN(t)) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const h = Math.round(mins / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  // ---------- DOM helpers ----------
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    (children || []).forEach((c) => { if (c != null && c !== false) n.append(c); });
    return n;
  }
  function safeUrl(u) {
    try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; } catch (e) { return null; }
  }
  function str(v) { return v == null ? '' : String(v); }

  // ---------- data loading ----------
  function sectionUrl(date, id) {
    return state.demo ? 'demo/' + id + '.json' : 'data/days/' + date + '/' + id + '.json';
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    try { return await res.json(); } catch (e) { return null; }
  }

  async function cryptoCfg() {
    if (!state.cryptoCfg) state.cryptoCfg = await fetchJSON('data/crypto.json');
    if (!state.cryptoCfg || !state.cryptoCfg.salt) throw new Error('data/crypto.json is missing');
    return state.cryptoCfg;
  }

  function askPassphrase(errMsg) {
    return new Promise((resolve) => {
      const dlg = $('unlockDialog');
      $('unlockErr').textContent = errMsg || '';
      $('passInput').value = '';
      dlg.returnValue = '';
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'ok' ? $('passInput').value : null);
      });
      dlg.showModal();
      setTimeout(() => $('passInput').focus(), 50);
    });
  }

  // Decrypts an envelope, asking for the passphrase at most once per load if needed.
  async function decodeSection(raw) {
    if (!BriefCrypto.isEnvelope(raw)) return raw;
    if (state.declined) return { locked: true };
    const cfg = await cryptoCfg();
    let err = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      let candidate = null;
      if (!state.key) {
        candidate = (attempt === 0 && store.get('pass')) || await askPassphrase(err);
        if (!candidate) { state.declined = true; return { locked: true }; }
        state.key = await BriefCrypto.deriveKey(candidate, cfg.salt, cfg.iterations || 210000);
      }
      try {
        const out = await BriefCrypto.decryptJSON(state.key, raw);
        if (candidate) store.set('pass', candidate);
        return out;
      } catch (e) {
        state.key = null;
        store.del('pass');
        err = 'That passphrase did not unlock it. Try again.';
      }
    }
    state.declined = true;
    return { locked: true };
  }

  async function loadDay(date) {
    const raws = await Promise.all(SECTIONS.map((s) => fetchJSON(sectionUrl(date, s.id)).catch(() => null)));
    const out = {};
    for (let i = 0; i < SECTIONS.length; i++) {
      if (!raws[i]) continue;
      out[SECTIONS[i].id] = await decodeSection(raws[i]);
    }
    return out;
  }

  // ---------- rendering ----------
  function doneKey(sectionId, idx, item) {
    return 'done:' + state.shownDate + ':' + sectionId + ':' + (item.id || idx);
  }

  function renderItem(sectionId, item, idx) {
    const checkable = item.checkable !== false && sectionId !== 'news' && sectionId !== 'coming_up' && sectionId !== 'schedule';
    const k = doneKey(sectionId, idx, item);
    const done = store.get(k) === '1';
    const url = item.url && safeUrl(item.url);

    const meta = [];
    if (item.due) {
      const n = daysBetween(todayET(), item.due);
      meta.push(el('span', { class: 'pill ' + (n < 0 ? 'late' : n <= 1 ? 'soon' : ''), text: 'Due ' + shortDate(item.due) + ' (' + relDays(n) + ')' }));
    }
    if (item.date && !item.due) {
      const n = daysBetween(todayET(), item.date);
      meta.push(el('span', { class: 'pill' + (n <= 3 && n >= 0 ? ' soon' : ''), text: shortDate(item.date) + ' · ' + relDays(n) }));
    }
    if (item.tag) meta.push(el('span', { class: 'pill tag', text: item.tag }));
    if (item.from) meta.push(el('span', { class: 'from', text: item.from }));

    const titleNode = url
      ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: str(item.title) })
      : el('span', { text: str(item.title) });

    const body = el('div', { class: 'item-body' }, [
      el('div', { class: 'item-title' }, [titleNode]),
      item.detail ? el('div', { class: 'item-detail', text: str(item.detail) }) : null,
      meta.length ? el('div', { class: 'item-meta' }, meta) : null,
    ]);

    const li = el('li', { class: 'item' + (item.priority === 'high' ? ' high' : '') + (done ? ' done' : '') });
    if (checkable) {
      const cb = el('input', { type: 'checkbox', 'aria-label': 'Mark done: ' + str(item.title) });
      cb.checked = done;
      cb.addEventListener('change', () => {
        if (cb.checked) store.set(k, '1'); else store.del(k);
        li.classList.toggle('done', cb.checked);
      });
      li.append(el('label', { class: 'cb' }, [cb]));
    }
    li.append(body);
    return li;
  }

  function renderSchedule(items) {
    const ol = el('ol', { class: 'timeline' });
    items.forEach((it) => {
      const kind = it.kind || 'fixed'; // fixed | suggested | open
      ol.append(el('li', { class: 'slot ' + kind }, [
        el('div', { class: 'slot-time', text: str(it.time) + (it.end ? '–' + it.end : '') }),
        el('div', { class: 'slot-body' }, [
          el('div', { class: 'slot-title', text: str(it.title) }),
          it.detail ? el('div', { class: 'item-detail', text: str(it.detail) }) : null,
        ]),
      ]));
    });
    return ol;
  }

  function renderStats(stats) {
    const grid = el('div', { class: 'stats' });
    stats.forEach((s) => {
      const ch = str(s.change);
      const dir = ch.startsWith('-') || ch.startsWith('−') ? 'down' : ch ? 'up' : '';
      grid.append(el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: str(s.label) }),
        el('div', { class: 'stat-value', text: str(s.value) }),
        ch ? el('div', { class: 'stat-change ' + dir, text: ch }) : null,
      ]));
    });
    return grid;
  }

  function renderProgress(list) {
    const wrap = el('div', { class: 'progress-list' });
    list.forEach((p) => {
      const cur = Number(p.current) || 0;
      const tgt = Number(p.target) || 0;
      const pct = tgt > 0 ? Math.max(0, Math.min(100, (cur / tgt) * 100)) : 0;
      const unit = p.unit || '';
      const fmt = (n) => unit === '$' ? '$' + n.toLocaleString('en-US') : n.toLocaleString('en-US') + (unit ? ' ' + unit : '');
      const bar = el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, [
        el('span', { style: 'width:' + pct.toFixed(1) + '%' }),
      ]);
      wrap.append(el('div', { class: 'progress' }, [
        el('div', { class: 'progress-head' }, [
          el('span', { text: str(p.label) }),
          el('span', { class: 'num', text: fmt(cur) + ' / ' + fmt(tgt) }),
        ]),
        bar,
        p.note ? el('div', { class: 'item-detail', text: str(p.note) }) : null,
      ]));
    });
    return wrap;
  }

  function renderSection(def, data) {
    const sec = el('section', { class: 'card', id: 'sec-' + def.id });
    const title = data.title || def.title;
    const head = el('div', { class: 'card-head' }, [
      el('h2', { text: title }),
      data.updated ? el('span', { class: 'updated', text: timeAgo(data.updated) }) : null,
    ]);
    sec.append(head);

    if (data.locked) {
      sec.append(el('p', { class: 'note', text: 'Locked. Tap Refresh to enter your passphrase.' }));
      return sec;
    }
    if (data.note) sec.append(el('p', { class: 'note', text: str(data.note) }));
    if (data.summary) sec.append(el('p', { class: 'summary', text: str(data.summary) }));
    if (Array.isArray(data.stats) && data.stats.length) sec.append(renderStats(data.stats));
    if (Array.isArray(data.progress) && data.progress.length) sec.append(renderProgress(data.progress));

    if (Array.isArray(data.groups)) {
      data.groups.forEach((g, gi) => {
        sec.append(el('h3', { text: str(g.title) }));
        if (g.summary) sec.append(el('p', { class: 'summary small', text: str(g.summary) }));
        const ul = el('ul', { class: 'items' });
        (g.items || []).forEach((it, i) => ul.append(renderItem(def.id + '-' + gi, it, i)));
        if (!(g.items || []).length && g.empty) ul.append(el('li', { class: 'item muted', text: str(g.empty) }));
        sec.append(ul);
      });
    }

    if (Array.isArray(data.items) && data.items.length) {
      if (def.id === 'schedule') sec.append(renderSchedule(data.items));
      else {
        const ul = el('ul', { class: 'items' });
        data.items.forEach((it, i) => ul.append(renderItem(def.id, it, i)));
        sec.append(ul);
      }
    }
    if (data.footer) sec.append(el('p', { class: 'small muted', text: str(data.footer) }));
    return sec;
  }

  function renderMasthead(brief) {
    const sec = el('section', { class: 'masthead', id: 'sec-brief' });
    if (brief.locked) {
      sec.append(el('p', { class: 'note', text: 'Locked. Tap Refresh to enter your passphrase.' }));
      return sec;
    }
    if (brief.edition) sec.append(el('div', { class: 'kicker', text: 'Edition ' + brief.edition }));
    if (brief.headline) sec.append(el('h1', { class: 'headline', text: str(brief.headline) }));
    if (brief.quote && brief.quote.text) {
      sec.append(el('blockquote', { class: 'quote' }, [
        el('p', { text: '“' + str(brief.quote.text) + '”' }),
        el('cite', { text: '— ' + str(brief.quote.author) }),
      ]));
    }
    if (Array.isArray(brief.top3) && brief.top3.length) {
      sec.append(el('h3', { text: 'Top 3 today' }));
      const ol = el('ol', { class: 'items top3' });
      brief.top3.forEach((it, i) => ol.append(renderItem('top3', typeof it === 'string' ? { title: it } : it, i)));
      sec.append(ol);
    }
    if (brief.note) sec.append(el('p', { class: 'note', text: str(brief.note) }));
    return sec;
  }

  function renderChips(present) {
    const nav = $('chips');
    nav.textContent = '';
    SECTIONS.forEach((s) => {
      if (!present[s.id]) return;
      nav.append(el('button', {
        class: 'chip', type: 'button', text: s.title,
        onclick: () => { const t = $('sec-' + s.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      }));
    });
  }

  function renderDay(date, data, banner) {
    const main = $('main');
    main.textContent = '';
    state.shownDate = date;
    $('dateLabel').textContent = prettyDate(date) + (state.demo ? ' · demo' : '');
    if (banner) main.append(el('div', { class: 'banner', text: banner }));

    const ids = Object.keys(data);
    if (!ids.length) {
      main.append(el('div', { class: 'empty' }, [
        el('p', { text: 'No brief for ' + prettyDate(date) + ' yet.' }),
        el('p', { class: 'small', text: 'Your agents post here each morning around 9:00 AM Eastern.' }),
      ]));
      renderChips({});
      return;
    }
    if (data.brief) main.append(renderMasthead(data.brief));
    SECTIONS.forEach((s) => {
      if (s.id === 'brief' || !data[s.id]) return;
      main.append(renderSection(s, data[s.id]));
    });
    renderChips(data);
  }

  // ---------- flow ----------
  async function show(date, allowFallback) {
    setStatus('Updating…');
    try {
      let data = await loadDay(date);
      let shown = date;
      let banner = null;
      if (!Object.keys(data).length && allowFallback) {
        for (let i = 1; i <= LOOKBACK_DAYS; i++) {
          const d = shiftDate(date, -i);
          const prev = await loadDay(d);
          if (Object.keys(prev).length) {
            data = prev; shown = d;
            banner = "Today's brief isn't in yet. Showing " + prettyDate(d) + '.';
            break;
          }
        }
      }
      state.date = shown;
      renderDay(shown, data, banner);
      setStatus(navigator.onLine === false ? 'Offline, showing saved copy' : 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    } catch (e) {
      setStatus('Could not load: ' + e.message);
    }
  }

  function setStatus(t) { $('status').textContent = t; }

  function wire() {
    $('prevDay').addEventListener('click', () => show(shiftDate(state.date, -1), false));
    $('nextDay').addEventListener('click', () => {
      const next = shiftDate(state.date, 1);
      if (next > todayET()) return;
      show(next, false);
    });
    $('refreshBtn').addEventListener('click', () => { state.declined = false; show(state.date, state.date === todayET()); });
    $('settingsBtn').addEventListener('click', () => {
      $('demoToggle').checked = state.demo;
      $('lookSelect').value = document.documentElement.dataset.look || 'clean';
      $('versionLabel').textContent = APP_VERSION;
      $('settingsDialog').showModal();
    });
    $('lookSelect').addEventListener('change', (e) => { store.set('look', applyLook(e.target.value)); });
    $('demoToggle').addEventListener('change', (e) => {
      state.demo = e.target.checked;
      store.set('demo', state.demo ? '1' : '0');
    });
    $('forgetBtn').addEventListener('click', () => {
      store.del('pass'); state.key = null;
    });
    $('settingsDialog').addEventListener('close', () => { state.declined = false; show(todayET(), true); });

    // Swipe left/right to change day.
    let x0 = null, y0 = null;
    document.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) (dx > 0 ? $('prevDay') : $('nextDay')).click();
    }, { passive: true });

    // Reload when the app comes back to the foreground on a new day.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') show(todayET(), true);
    });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  wire();
  show(state.date, true);
})();
