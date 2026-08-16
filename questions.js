/**
 * Questions from the room.
 *
 * A QR goes on the screen during the coffee break; people type the question
 * they did not want to ask in front of eighty others. The moderator sees them
 * sorted by how many people wanted the same thing asked.
 *
 * Two decisions worth stating:
 *
 * - Upvotes, not just a list. With forty questions the moderator needs to know
 *   which three matter, and the room is a better judge of that than we are.
 * - Names optional. The whole point is that shy questions arrive; requiring a
 *   name would filter out exactly the ones worth asking.
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
footer{text-align:center;font-size:13px;color:var(--grey);margin-top:34px}
</style></head><body>
<div class="wrap">
  <h1>ASK ANYTHING</h1>
  <p class="lead">We collect questions over the break and take them from the front
    afterwards. No name needed.</p>

  <form id="f">
    <label for="text">Your question</label>
    <textarea id="text" placeholder="What would you actually like to know?"></textarea>
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
  var voted = {};
  try { voted = JSON.parse(localStorage.getItem('cha08_voted') || '{}'); } catch (e) {}

  function esc(s){ return String(s||'').replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }); }

  async function load() {
    try {
      var r = await fetch('/api/questions/list', { cache: 'no-store' });
      var d = await r.json();
      var list = document.getElementById('list');
      document.getElementById('listhead').style.display = d.questions.length ? 'block' : 'none';
      list.innerHTML = d.questions.map(function (q) {
        var on = voted[q.id] ? ' on' : '';
        return '<div class="q"><p>' + esc(q.text)
          + '<span class="who">' + (q.session ? esc(q.session) : 'General')
          + (q.name ? ' \\u00b7 ' + esc(q.name) : '') + '</span></p>'
          + '<button class="up' + on + '" data-id="' + q.id + '">' + q.votes
          + '<span>' + (voted[q.id] ? 'backed' : 'back it') + '</span></button></div>';
      }).join('');
    } catch (e) { /* leave what is there */ }
  }

  document.getElementById('list').addEventListener('click', async function (e) {
    var b = e.target.closest('.up');
    if (!b) return;
    var id = b.getAttribute('data-id');
    if (voted[id]) return;                       // one voice per device
    voted[id] = 1;
    try { localStorage.setItem('cha08_voted', JSON.stringify(voted)); } catch (err) {}
    b.classList.add('on');
    b.firstChild.nodeValue = String(parseInt(b.textContent, 10) + 1);
    try {
      await fetch('/api/questions/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id }),
      });
    } catch (err) {}
    load();
  });

  document.getElementById('send').addEventListener('click', async function () {
    var err = document.getElementById('err');
    var text = document.getElementById('text').value.trim();
    err.style.display = 'none';
    if (text.length < 5) { err.textContent = 'Please write your question first.'; err.style.display = 'block'; return; }
    this.disabled = true; this.textContent = 'Sending\\u2026';
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

  const card = (q) => `<div class="q${q.done ? ' done' : ''}" data-id="${q.id}">
      <div class="v">${q.votes}<span>backing</span></div>
      <div class="t"><p>${esc(q.text)}</p>
        <span class="meta">${esc(q.session || 'General')}${q.name ? ' &middot; ' + esc(q.name) : ' &middot; anonymous'}
          &middot; ${esc(q.ts.slice(11, 16))}</span></div>
      <button class="mark">${q.done ? 'Undo' : 'Asked'}</button>
    </div>`;

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
  h2{font-size:15px;margin:24px 0 10px;color:#666}
  .q{background:#fff;border:1px solid #e5e0d5;border-radius:14px;padding:14px 16px;margin-bottom:10px;
    display:flex;gap:14px;align-items:flex-start}
  .q.done{opacity:.5}
  .v{flex-shrink:0;background:#111;color:#fff;border-radius:10px;padding:8px 12px;text-align:center;
    font-weight:700;font-size:18px;line-height:1.1;min-width:56px}
  .v span{display:block;font-size:9.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#bbb}
  .t{flex:1;min-width:0}
  .t p{font-size:16px;line-height:1.45;overflow-wrap:anywhere}
  .meta{display:block;font-size:12.5px;color:#999;margin-top:6px}
  .mark{flex-shrink:0;background:#fff;border:1px solid #ddd;border-radius:9px;padding:9px 13px;
    font:inherit;font-weight:600;font-size:13.5px;cursor:pointer}
  .empty{background:#fff;border:1px dashed #d8d2c4;border-radius:14px;padding:36px;text-align:center;color:#666}
  a{color:#333}
  @media(max-width:600px){body{padding:14px}.t p{font-size:15px}}
  </style></head><body>
  <p><a href="/admin?key=${k}">&larr; Back to registrations</a> &middot;
     <a href="/screen/ask" target="_blank">Put the QR on screen</a></p>
  <h1>Questions from the room</h1>
  <p class="lead">Sorted by how many people backed each one. Tap <b>Asked</b> once
    it has been answered, and it drops out of the audience's list too.</p>
  ${open.length ? open.map(card).join('') : '<div class="empty">No questions yet.</div>'}
  ${done.length ? `<h2>Answered (${done.length})</h2>${done.map(card).join('')}` : ''}

  <script>
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
