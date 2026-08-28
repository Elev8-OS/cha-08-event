/**
 * Questions from the room.
 *
 * A QR goes on the screen during the coffee break; people type the question
 * they did not want to ask in front of eighty others. The moderator sees them
 * sorted by how many people wanted the same thing asked.
 *
 * Three decisions worth stating:
 *
 * - Upvotes, not just a list. With forty questions the moderator needs to know
 *   which three matter, and the room is a better judge of that than we are.
 * - Names optional. The whole point is that shy questions arrive; requiring a
 *   name would filter out exactly the ones worth asking.
 * - Duplicates are caught while typing. Nobody reads eighty questions to check
 *   whether theirs is already there, so the page checks for them.
 *
 * Self-contained on purpose: it reads its own configuration from the
 * environment so it can be added without touching server.js during the run-up
 * to a live event.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const FILE = () => path.join(DATA_DIR, 'questions.jsonl');

const SESSIONS = [
  'Revenue management',
  'Finance & reporting',
  'Guest reporting & APOA',
  'Data protection law',
  'Direct booking playbook',
  'AI in daily operations',
  'Something else',
];

function guard(req, res) {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    res.status(403).send('Forbidden');
    return false;
  }
  return true;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Every line is an event: a question, a vote, or a moderator marking one done.
// Replaying them gives the current state, and nothing is ever lost.
function readState() {
  const questions = new Map();
  if (!fs.existsSync(FILE())) return questions;
  fs.readFileSync(FILE(), 'utf8').trim().split('\n').filter(Boolean).forEach((l) => {
    let r;
    try { r = JSON.parse(l); } catch { return; }
    if (r.type === 'q') {
      questions.set(r.id, { id: r.id, ts: r.ts, text: r.text, name: r.name, session: r.session, votes: 0, done: false });
    } else if (r.type === 'v' && questions.has(r.id)) {
      questions.get(r.id).votes += 1;
    } else if (r.type === 'd' && questions.has(r.id)) {
      questions.get(r.id).done = r.done !== false;
    }
  });
  return questions;
}

function sorted(state) {
  return [...state.values()].sort((a, b) => (b.votes - a.votes) || a.ts.localeCompare(b.ts));
}

function mount(app) {
  app.get('/ask', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(askPage());
  });

  app.post('/api/questions', (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });          // honeypot
    const text = String(b.text || '').trim().slice(0, 600);
    if (text.length < 5) return res.status(400).json({ ok: false, error: 'Please write your question first.' });

    const entry = {
      type: 'q',
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      text,
      name: String(b.name || '').trim().slice(0, 80),
      session: SESSIONS.includes(String(b.session)) ? String(b.session) : '',
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(FILE(), JSON.stringify(entry) + '\n');
    console.log('[ask]', entry.session || 'general', '|', entry.text.slice(0, 60));
    res.json({ ok: true, id: entry.id });
  });

  app.post('/api/questions/vote', (req, res) => {
    const id = String((req.body || {}).id || '');
    if (!id || !readState().has(id)) return res.status(400).json({ ok: false });
    fs.appendFileSync(FILE(), JSON.stringify({ type: 'v', id, ts: new Date().toISOString() }) + '\n');
    res.json({ ok: true });
  });

  // Public list, so people can back a question instead of asking it twice
  app.get('/api/questions/list', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      questions: sorted(readState()).filter((q) => !q.done)
        .map((q) => ({ id: q.id, text: q.text, name: q.name, session: q.session, votes: q.votes })),
    });
  });

  app.post('/admin/questions/done', (req, res) => {
    if (!guard(req, res)) return;
    const b = req.body || {};
    fs.appendFileSync(FILE(),
      JSON.stringify({ type: 'd', id: String(b.id || ''), done: b.done !== false, ts: new Date().toISOString() }) + '\n');
    res.json({ ok: true });
  });

  app.get('/admin/questions', (req, res) => {
    if (!guard(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    res.send(adminPage(encodeURIComponent(req.query.key), sorted(readState())));
  });
}

function askPage() {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ask a question &middot; Smarter Revenue, Better Tech</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#F7F4EE">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--cream:#F7F4EE;--ink:#111;--gold:#F6BB12;--grey:#555}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:var(--cream);color:var(--ink);line-height:1.5}
.wrap{max-width:620px;margin:0 auto;padding:30px 20px 60px}
h1{font-family:'Archivo Black',sans-serif;text-align:center;font-size:clamp(24px,6vw,32px);line-height:1.15}
.lead{text-align:center;color:var(--grey);margin-top:10px;font-size:15px}
form{background:#fff;border:1px solid #e5e0d5;border-radius:16px;padding:22px;margin-top:22px}
label{display:block;font-weight:600;font-size:14px;margin-bottom:8px}
textarea{width:100%;padding:13px;border:1px solid #d8d2c4;border-radius:10px;font:inherit;
  font-size:16px;background:#FCFBF8;min-height:120px;resize:vertical}
select,input{width:100%;padding:12px;border:1px solid #d8d2c4;border-radius:10px;font:inherit;
  font-size:16px;background:#FCFBF8;margin-top:12px}
.hp{position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden}
button.send{margin-top:16px;width:100%;background:var(--ink);color:var(--cream);border:0;border-radius:10px;
  padding:15px;font:inherit;font-weight:700;font-size:16px;cursor:pointer}
button.send:disabled{opacity:.6;cursor:wait}
.err{display:none;color:#a33;font-size:14px;margin-top:10px;text-align:center}
.small{font-size:13px;color:var(--grey);margin-top:12px;text-align:center}
.ok{display:none;background:#F2FBF3;border:1px solid #bfe3c6;border-radius:14px;padding:18px;
  margin-top:18px;text-align:center;font-weight:600}
h2{font-size:15px;margin:28px 0 10px;color:var(--grey)}
.q{background:#fff;border:1px solid #e5e0d5;border-radius:12px;padding:14px 16px;margin-bottom:9px;
  display:flex;gap:12px;align-items:flex-start}
.q p{flex:1;font-size:15px;line-height:1.45}
.q .who{display:block;font-size:12.5px;color:#999;margin-top:5px}
.up{flex-shrink:0;background:#FCFBF8;border:1px solid #d8d2c4;border-radius:10px;padding:7px 11px;
  font:inherit;font-weight:700;font-size:14px;cursor:pointer;text-align:center;line-height:1.2}
.up.on{background:var(--gold);border-color:var(--gold)}
.up span{display:block;font-size:11px;font-weight:600;color:#777}
.up.on span{color:#6b5200}
.similar{display:none;background:#FCF6E6;border:1px solid #E8DCB8;border-left:4px solid var(--gold);
  border-radius:12px;padding:15px 16px;margin-top:14px}
.similar b{font-size:14.5px}
.similar .hint{font-size:13px;color:var(--grey);margin-top:3px}
.sq{background:#fff;border:1px solid #e8dcb8;border-radius:10px;padding:11px 13px;margin-top:10px;
  display:flex;gap:10px;align-items:flex-start}
.sq p{flex:1;font-size:14.5px;line-height:1.4}
.dismiss{width:100%;margin-top:12px;background:none;border:0;color:var(--grey);font:inherit;
  font-size:13px;font-weight:600;text-decoration:underline;cursor:pointer;padding:6px}
footer{text-align:center;font-size:13px;color:var(--grey);margin-top:34px}
</style></head><body>
<div class="wrap">
  <h1>ASK ANYTHING</h1>
  <p class="lead">We collect questions over the break and take them from the front
    afterwards. No name needed.</p>

  <form id="f">
    <label for="text">Your question</label>
    <textarea id="text" placeholder="What would you actually like to know?"></textarea>

    <div class="similar" id="similar">
      <b>Someone may have asked this already</b>
      <p class="hint">Backing a question gets it answered sooner than asking it twice.</p>
      <div id="similar-list"></div>
      <button type="button" class="dismiss" id="dismiss">No, mine is different &mdash; let me send it</button>
    </div>

    <select id="session">
      <option value="">Which session? (optional)</option>
      ${SESSIONS.map((s) => `<option>${esc(s)}</option>`).join('')}
    </select>
    <input id="name" placeholder="Your name (optional)" autocomplete="name">
    <div class="hp"><input id="website" tabindex="-1" autocomplete="off"></div>
    <button type="button" class="send" id="send">Send question</button>
    <div class="err" id="err"></div>
    <p class="small">Anonymous unless you add your name.</p>
  </form>

  <div class="ok" id="ok">Thank you &mdash; your question is in.</div>

  <h2 id="listhead" style="display:none">Already asked &mdash; tap to back one</h2>
  <div id="list"></div>

  <footer>Smarter Revenue, Better Tech &middot; 28 August 2026</footer>
</div>

<script>
(function () {
  var voted = {}, all = [], dismissed = false;
  try { voted = JSON.parse(localStorage.getItem('cha08_voted') || '{}'); } catch (e) {}

  function esc(s){ return String(s||'').replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }); }

  // Nobody reads eighty questions to check whether theirs is already there.
  // So we do it for them: overlap of meaningful words, ignoring the filler
  // that every question contains anyway.
  var STOP = ('a an the is are was were do does did how what when where why who which '
    + 'to of in on for with and or if it its this that we you your our my i can could '
    + 'should would will shall have has had be been being at as by from about not no '
    + 'yes there their them they he she his her me us so than then too very just only');
  var STOPSET = {};
  STOP.split(' ').forEach(function (w) { STOPSET[w] = 1; });

  function words(s) {
    // No backslash escapes here on purpose: this code is embedded in a
    // template literal, and something like a backslash-s loses its backslash
    // on the way to the browser - which once made this split on the letter s.
    // Anything that is not a letter or digit is a separator instead.
    var out = [];
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').forEach(function (w) {
      if (w.length > 2 && !STOPSET[w]) {
        // Crude stemming, but enough: "reporting" and "report" are the
        // same question, and a real stemmer is not worth 30 KB on a phone.
        out.push(w.replace(/(ings|ing|ies|ed|es|s)$/, ''));
      }
    });
    return out;
  }

  function similarity(a, b) {
    var A = words(a), B = words(b);
    if (!A.length || !B.length) return 0;
    var setB = {}, hits = 0, seen = {};
    B.forEach(function (w) { setB[w] = 1; });
    A.forEach(function (w) { if (setB[w] && !seen[w]) { seen[w] = 1; hits++; } });
    // Someone typing one or two words is searching, not writing a question:
    // if those words appear, that is a hit regardless of how long the stored
    // question happens to be. Dice would punish exactly that case.
    if (A.length <= 2 && hits === A.length) return 1;
    // Otherwise Dice: forgiving about one question being longer than the other
    return (2 * hits) / (A.length + B.length);
  }

  function suggest() {
    var text = document.getElementById('text').value;
    var box = document.getElementById('similar');
    // One distinctive word is enough - somebody typing just "APOA" should see
    // the APOA question. The score threshold below still filters the noise.
    if (dismissed || words(text).length < 1) { box.style.display = 'none'; return; }
    var hits = all.map(function (q) { return { q: q, s: similarity(text, q.text) }; })
      .filter(function (x) { return x.s >= 0.28; })
      .sort(function (x, y) { return y.s - x.s; })
      .slice(0, 3);
    if (!hits.length) { box.style.display = 'none'; return; }
    document.getElementById('similar-list').innerHTML = hits.map(function (x) {
      var on = voted[x.q.id] ? ' on' : '';
      return '<div class="sq"><p>' + esc(x.q.text) + '</p>'
        + '<button type="button" class="up' + on + '" data-id="' + x.q.id + '">' + x.q.votes
        + '<span>' + (voted[x.q.id] ? 'backed' : 'back it') + '</span></button></div>';
    }).join('');
    box.style.display = 'block';
  }

  async function load() {
    try {
      var r = await fetch('/api/questions/list', { cache: 'no-store' });
      var d = await r.json();
      all = d.questions;
      var list = document.getElementById('list');
      document.getElementById('listhead').style.display = d.questions.length ? 'block' : 'none';
      list.innerHTML = d.questions.map(function (q) {
        var on = voted[q.id] ? ' on' : '';
        return '<div class="q"><p>' + esc(q.text)
          + '<span class="who">' + (q.session ? esc(q.session) : 'General')
          + (q.name ? ' &middot; ' + esc(q.name) : '') + '</span></p>'
          + '<button type="button" class="up' + on + '" data-id="' + q.id + '">' + q.votes
          + '<span>' + (voted[q.id] ? 'backed' : 'back it') + '</span></button></div>';
      }).join('');
      suggest();
    } catch (e) { /* leave what is there */ }
  }

  async function back(b) {
    var id = b.getAttribute('data-id');
    if (voted[id]) return;                       // one voice per device
    voted[id] = 1;
    try { localStorage.setItem('cha08_voted', JSON.stringify(voted)); } catch (err) {}
    b.classList.add('on');
    b.firstChild.nodeValue = String(parseInt(b.textContent, 10) + 1);
    b.querySelector('span').textContent = 'backed';
    try {
      await fetch('/api/questions/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id }),
      });
    } catch (err) {}
    load();
  }

  document.getElementById('list').addEventListener('click', function (e) {
    var b = e.target.closest('.up');
    if (b) back(b);
  });

  // Backing from inside the panel counts the same as backing from the list
  document.getElementById('similar-list').addEventListener('click', function (e) {
    var b = e.target.closest('.up');
    if (b) back(b);
  });

  var typingTimer = null;
  document.getElementById('text').addEventListener('input', function () {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(suggest, 350);      // wait for a pause, not every keystroke
  });

  document.getElementById('dismiss').addEventListener('click', function () {
    dismissed = true;
    document.getElementById('similar').style.display = 'none';
    document.getElementById('text').focus();
  });

  document.getElementById('send').addEventListener('click', async function () {
    var err = document.getElementById('err');
    var text = document.getElementById('text').value.trim();
    err.style.display = 'none';
    if (text.length < 5) { err.textContent = 'Please write your question first.'; err.style.display = 'block'; return; }
    this.disabled = true; this.textContent = 'Sending&hellip;';
    try {
      var r = await fetch('/api/questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          session: document.getElementById('session').value,
          name: document.getElementById('name').value,
          website: document.getElementById('website').value,
        }),
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Could not send.');
      document.getElementById('text').value = '';
      document.getElementById('similar').style.display = 'none';
      dismissed = false;
      document.getElementById('ok').style.display = 'block';
      setTimeout(function () { document.getElementById('ok').style.display = 'none'; }, 4000);
      load();
    } catch (ex) {
      err.textContent = ex.message; err.style.display = 'block';
    }
    this.disabled = false; this.textContent = 'Send question';
  });

  load();
  setInterval(load, 15000);
})();
</script>
</body></html>`;
}

function adminPage(k, questions) {
  const open = questions.filter((q) => !q.done);
  const done = questions.filter((q) => q.done);

  // Tiles rather than rows: a moderator reads this on a phone while standing
  // at the front, and the question itself has to be the biggest thing on it.
  const card = (q, top) => `<article class="q${q.done ? ' done' : ''}${top ? ' top' : ''}" data-id="${q.id}">
      <header><span class="v">${q.votes}<small>backing</small></span>
        <span class="meta">${esc(q.session || 'General')}</span></header>
      <p class="txt">${esc(q.text)}</p>
      <p class="orig" hidden></p>
      <footer><span class="who">${q.name ? esc(q.name) : 'anonymous'} &middot; ${esc(q.ts.slice(11, 16))}</span>
        <button class="mark">${q.done ? 'Undo' : 'Answered'}</button></footer>
    </article>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Questions (${open.length})</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111111">
  <link rel="apple-touch-icon" href="/img/appicon.png">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>*{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,system-ui,sans-serif;background:#F7F4EE;color:#111;padding:18px;max-width:820px;
    padding-bottom:calc(30px + env(safe-area-inset-bottom))}
  h1{font-size:20px;margin:6px 0 4px}
  .lead{color:#666;font-size:14px;margin-bottom:16px}
  h2{font-size:15px;margin:26px 0 10px;color:#666}
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
  .q{background:#fff;border:1px solid #e5e0d5;border-radius:14px;padding:15px 17px;
    display:flex;flex-direction:column}
  .q.done{opacity:.5}
  .q header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .v{background:#111;color:#fff;border-radius:9px;padding:6px 11px;text-align:center;
    font-weight:700;font-size:17px;line-height:1.05;flex-shrink:0}
  .v small{display:block;font-size:9px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#bbb}
  .q.top .v{background:#F6BB12;color:#111}
  .q.top .v small{color:#7a5b00}
  .meta{font-size:12.5px;font-weight:600;color:#8A6D2F;overflow-wrap:anywhere}
  .q p{font-size:16.5px;line-height:1.4;overflow-wrap:anywhere;flex:1}
  .q footer{display:flex;align-items:center;gap:10px;margin-top:14px;padding-top:11px;
    border-top:1px solid #eee7db}
  .who{font-size:12.5px;color:#999;flex:1;overflow-wrap:anywhere}
  .mark{flex-shrink:0;background:#fff;border:1px solid #ddd;border-radius:9px;padding:9px 14px;
    font:inherit;font-weight:600;font-size:13.5px;cursor:pointer}
  .empty{background:#fff;border:1px dashed #d8d2c4;border-radius:14px;padding:36px;text-align:center;color:#666}
  .tbar{display:flex;align-items:center;gap:10px;margin:0 0 14px;flex-wrap:wrap}
  .tbar button{background:#111;color:#F7F4EE;border:0;border-radius:9px;padding:9px 14px;
    font:inherit;font-weight:600;font-size:13.5px;cursor:pointer}
  .tbar button.off{background:#fff;color:#111;border:1px solid #ddd6c8}
  .tbar span{font-size:12.5px;color:#999}
  /* The original stays under the translation: names, villa names and the odd
     Indonesian term are worth seeing even when you cannot read the sentence. */
  .orig{font-size:13px;color:#8f8878;font-style:italic;margin-top:7px;line-height:1.35;
    padding-top:7px;border-top:1px dashed #eee7db}
  .q p.pending{opacity:.55}
  a{color:#333}
  @media(max-width:600px){body{padding:14px}
    .grid{grid-template-columns:1fr;gap:10px}
    .q p{font-size:16px}
    .mark{padding:11px 16px;font-size:14px}}
  </style></head><body>
  <p><a href="/admin?key=${k}">&larr; Back to registrations</a> &middot;
     <a href="/screen/ask" target="_blank">Put the QR on screen</a></p>
  <h1>Questions from the room</h1>
  <p class="lead">Sorted by how many people backed each one. Tap <b>Answered</b> when you
    have dealt with it, and it drops out of the audience's list too.</p>
  <div class="tbar">
    <button id="tg" type="button"></button>
    <span id="tnote"></span>
  </div>
  ${open.length
    ? `<div class="grid">${open.map((q, i) => card(q, i === 0 && q.votes > 0)).join('')}</div>`
    : '<div class="empty">No questions yet.</div>'}
  ${done.length ? `<h2>Answered (${done.length})</h2><div class="grid">${done.map((q) => card(q)).join('')}</div>` : ''}

  <script>
  /**
   * Questions come in Indonesian; whoever runs the Q&A may not read it.
   * Translation happens here in the browser, not on the server: no API key
   * in the repo, nothing to pay for, and if it ever fails the original text
   * is what was on the card all along.
   *
   * The page reloads itself every 30 seconds, so translations are cached by
   * question id in localStorage — otherwise the same six questions would be
   * sent off again twice a minute.
   */
  var TKEY = 'cha08-translate', CKEY = 'cha08-tcache';
  var cache = {};
  try { cache = JSON.parse(localStorage.getItem(CKEY) || '{}'); } catch (e) { cache = {}; }
  function saveCache() { try { localStorage.setItem(CKEY, JSON.stringify(cache)); } catch (e) {} }
  function wanted() { try { return localStorage.getItem(TKEY) !== '0'; } catch (e) { return true; } }

  async function viaGoogle(text) {
    var u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q='
      + encodeURIComponent(text);
    var r = await fetch(u);
    if (!r.ok) throw new Error('http ' + r.status);
    var d = await r.json();
    return { t: (d[0] || []).map(function (x) { return x[0]; }).join(''), src: d[2] || '' };
  }
  // Documented free service, used only when the first one is unreachable.
  async function viaMyMemory(text) {
    var r = await fetch('https://api.mymemory.translated.net/get?langpair=id|en&q=' + encodeURIComponent(text));
    if (!r.ok) throw new Error('http ' + r.status);
    var d = await r.json();
    var t = d && d.responseData && d.responseData.translatedText;
    if (!t) throw new Error('empty');
    return { t: t, src: 'id' };
  }
  async function translate(text) {
    try { return await viaGoogle(text); } catch (e) { return await viaMyMemory(text); }
  }

  function paint(card, rec) {
    var p = card.querySelector('.txt'), o = card.querySelector('.orig');
    if (!p || !o) return;
    var original = card.getAttribute('data-orig');
    if (!rec || !rec.t || rec.src === 'en' || rec.t.trim() === original.trim()) {
      p.textContent = original; o.hidden = true; return;   // already English
    }
    p.textContent = rec.t;
    o.textContent = original;
    o.hidden = false;
  }

  function reset(card) {
    var p = card.querySelector('.txt'), o = card.querySelector('.orig');
    p.textContent = card.getAttribute('data-orig');
    p.classList.remove('pending');
    o.hidden = true;
  }

  async function run() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.q'));
    cards.forEach(function (c) {
      if (!c.hasAttribute('data-orig')) c.setAttribute('data-orig', c.querySelector('.txt').textContent);
    });
    var tg = document.getElementById('tg'), note = document.getElementById('tnote');
    var on = wanted();
    tg.textContent = on ? 'Showing English' : 'Translate to English';
    tg.className = on ? '' : 'off';
    note.textContent = on ? 'Original underneath each question.' : '';
    if (!on) { cards.forEach(reset); return; }

    var failed = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], id = c.getAttribute('data-id'), orig = c.getAttribute('data-orig');
      if (cache[id] && cache[id].o === orig) { paint(c, cache[id]); continue; }
      c.querySelector('.txt').classList.add('pending');
      try {
        var rec = await translate(orig);
        rec.o = orig;
        cache[id] = rec; saveCache();
        paint(c, rec);
      } catch (e) { failed++; }
      c.querySelector('.txt').classList.remove('pending');
    }
    if (failed) note.textContent = failed + ' could not be translated — original text shown.';
  }

  document.getElementById('tg').addEventListener('click', function () {
    try { localStorage.setItem(TKEY, wanted() ? '0' : '1'); } catch (e) {}
    run();
  });
  run();

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('.mark');
    if (!b) return;
    var card = b.closest('.q');
    var done = !card.classList.contains('done');
    b.disabled = true;
    try {
      await fetch('/admin/questions/done?key=${k}', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: card.getAttribute('data-id'), done: done }),
      });
      location.reload();
    } catch (err) { b.disabled = false; }
  });
  setInterval(function () { location.reload(); }, 30000);
  </script>
  </body></html>`;
}

module.exports = { mount, SESSIONS };
