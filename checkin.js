/**
 * Reception check-in for the event desk.
 *
 * A tablet-first page listing every registration. The host taps a guest to
 * mark them as arrived, which is stored locally and pushed to GHL as a tag.
 * Deliberately self-contained: the rest of the app only calls mount().
 */

const fs = require('fs');
const path = require('path');

function mount(app, deps) {
  const { DATA_DIR, guard, readAll, paidSet, addGhlTag, ATTENDED_TAG, ghlReady } = deps;
  const FILE = () => path.join(DATA_DIR, 'checkins.jsonl');

  // Latest entry per email wins, so an accidental check-in can be undone
  function arrivedSet() {
    const map = new Map();
    if (fs.existsSync(FILE())) {
      fs.readFileSync(FILE(), 'utf8').trim().split('\n').filter(Boolean).forEach((l) => {
        try { const r = JSON.parse(l); map.set(r.email, r); } catch {}
      });
    }
    return map;
  }

  app.get('/checkin/list', (req, res) => {
    if (!guard(req, res)) return;
    const paid = paidSet();
    const arrived = arrivedSet();
    const guests = readAll().map((r) => {
      const a = arrived.get(r.email);
      return {
        name: r.name,
        email: r.email,
        company: r.company || '',
        seats: r.guests || 1,
        paid: paid.get(r.email) === true,
        arrived: Boolean(a && a.arrived),
        at: a && a.arrived ? a.ts.slice(11, 16) : '',
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      guests,
      seatsTotal: guests.reduce((s, g) => s + g.seats, 0),
      seatsArrived: guests.filter((g) => g.arrived).reduce((s, g) => s + g.seats, 0),
    });
  });

  app.post('/checkin/mark', async (req, res) => {
    if (!guard(req, res)) return;
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const arrived = (req.body || {}).arrived !== false;
    if (!email) return res.status(400).json({ ok: false });

    const entry = readAll().find((r) => r.email === email);
    if (!entry) return res.status(404).json({ ok: false, error: 'not registered' });

    fs.appendFileSync(FILE(), JSON.stringify({ ts: new Date().toISOString(), email, arrived }) + '\n');
    console.log('[checkin]', arrived ? 'arrived' : 'undone', email);

    // Tagging must never block the desk: answer first, sync after
    res.json({ ok: true });
    if (arrived && ghlReady()) {
      try { await addGhlTag(entry, ATTENDED_TAG); } catch (e) { console.error('[checkin] tag failed', e.message); }
    }
  });

  app.get('/checkin', (req, res) => {
    if (!guard(req, res)) return;
    const k = encodeURIComponent(req.query.key);
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(page(k));
  });
}

function page(k) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Check-in &middot; Smarter Revenue, Better Tech</title>
<meta name="theme-color" content="#111111">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="CHA-08 Check-in">
<link rel="apple-touch-icon" href="/img/appicon.png">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--cream:#F7F4EE;--ink:#111;--gold:#F6BB12;--grey:#666;--green:#137333}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:Inter,system-ui,sans-serif;background:var(--cream);color:var(--ink);padding-bottom:env(safe-area-inset-bottom);
  -webkit-user-select:none;user-select:none}
header{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #e5e0d5;
  padding:14px 22px;display:flex;align-items:center;gap:22px;flex-wrap:wrap}
header img{height:34px} header img.c{height:50px}
.title{font-family:'Archivo Black',sans-serif;font-size:17px;line-height:1.2}
.title span{display:block;font-family:Inter,sans-serif;font-weight:500;font-size:12.5px;color:var(--grey)}
.back{margin-left:auto;color:var(--grey);text-decoration:none;font-size:14px;font-weight:600;
  padding:8px 12px;border:1px solid #e0dace;border-radius:8px;background:#fff}
.count{text-align:right;margin-left:18px}
.count .n{font-family:'Archivo Black',sans-serif;font-size:26px;line-height:1}
.count .l{font-size:11.5px;color:var(--grey);letter-spacing:1px;text-transform:uppercase}
.search{padding:16px 22px 8px}
.search input{width:100%;padding:16px 18px;border:2px solid #e0dace;border-radius:14px;
  font:inherit;font-size:18px;background:#fff}
.search input:focus{outline:none;border-color:var(--gold)}
.list{padding:8px 22px 40px;display:grid;gap:10px;
  grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
.g{background:#fff;border:1px solid #e5e0d5;border-radius:14px;padding:16px 18px;
  display:flex;align-items:center;gap:14px;cursor:pointer;transition:transform .06s}
.g:active{transform:scale(.985)}
.g.in{background:#F2FBF3;border-color:#bfe3c6}
.g .info{flex:1;min-width:0}
.g .nm{font-weight:700;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g .meta{font-size:13.5px;color:var(--grey);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g .seats{font-size:12px;font-weight:700;background:#F2EEE5;border-radius:20px;padding:3px 10px;display:inline-block;margin-top:5px}
.g .unpaid{background:#FDF0E6;color:#8a5a1f}
.mark{width:52px;height:52px;border-radius:50%;border:2px solid #ddd;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;font-size:24px;color:#bbb;background:#fff}
.g.in .mark{background:var(--green);border-color:var(--green);color:#fff}
.empty{padding:40px 22px;text-align:center;color:var(--grey)}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(120%);
  background:#111;color:#fff;padding:14px 22px;border-radius:12px;font-weight:600;
  transition:transform .25s;z-index:20;display:flex;align-items:center;gap:16px}
.toast.show{transform:translateX(-50%) translateY(0)}
.toast button{background:none;border:0;color:var(--gold);font:inherit;font-weight:700;cursor:pointer}
@media(max-width:640px){.list{grid-template-columns:1fr;padding:8px 14px 40px}
  .search{padding:12px 14px 6px}header{padding:12px 14px;gap:12px}header img{height:24px}header img.c{height:34px}
  .title{font-size:15px;width:100%;order:5}.back{order:3}.count{order:4;margin-left:0}}
</style></head><body>

<header>
  <img src="/img/elev8.jpg" alt="Elev8 Suite">
  <img class="c" src="/img/cha.jpg?v=2" alt="Canggu Hospitality Association">
  <img src="/img/mekari.jpg?v=2" alt="Mekari">
  <div class="title">CHECK-IN<span>Smarter Revenue, Better Tech &middot; 28 August</span></div>
  <a class="back" href="/admin?key=${k}">&larr; Admin</a>
  <div class="count"><div class="n" id="count">0 / 0</div><div class="l">guests arrived</div></div>
</header>

<div class="search"><input id="q" placeholder="Search name or property\u2026" autocomplete="off"></div>
<div class="list" id="list"></div>
<div class="empty" id="empty" style="display:none">No matching guest.</div>
<div class="toast" id="toast"><span id="toast-text"></span><button id="undo">Undo</button></div>

<script>
var KEY = '${k}';
var guests = [], lastUndo = null, toastTimer = null;

function esc(s){ return String(s||'').replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }); }

function render() {
  var q = document.getElementById('q').value.trim().toLowerCase();
  var shown = guests.filter(function (g) {
    return !q || g.name.toLowerCase().indexOf(q) > -1 || (g.company || '').toLowerCase().indexOf(q) > -1;
  });
  document.getElementById('list').innerHTML = shown.map(function (g) {
    return '<div class="g' + (g.arrived ? ' in' : '') + '" data-email="' + esc(g.email) + '">'
      + '<div class="info"><div class="nm">' + esc(g.name) + '</div>'
      + '<div class="meta">' + esc(g.company || g.email) + '</div>'
      + '<span class="seats' + (g.paid ? '' : ' unpaid') + '">' + g.seats + ' seat' + (g.seats > 1 ? 's' : '')
      + (g.paid ? '' : ' \\u00b7 unpaid') + (g.arrived ? ' \\u00b7 ' + g.at : '') + '</span></div>'
      + '<div class="mark">' + (g.arrived ? '\\u2713' : '') + '</div></div>';
  }).join('');
  document.getElementById('empty').style.display = shown.length ? 'none' : 'block';
}

function refreshCount(d) {
  document.getElementById('count').textContent = d.seatsArrived + ' / ' + d.seatsTotal;
}

async function load() {
  try {
    var r = await fetch('/checkin/list?key=' + KEY, { cache: 'no-store' });
    var d = await r.json();
    guests = d.guests; refreshCount(d); render();
  } catch (e) { /* keep showing what we have */ }
}

function toast(msg, undoFn) {
  document.getElementById('toast-text').textContent = msg;
  var t = document.getElementById('toast');
  document.getElementById('undo').style.display = undoFn ? 'block' : 'none';
  lastUndo = undoFn;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 4000);
}

async function mark(email, arrived) {
  var g = guests.filter(function (x) { return x.email === email; })[0];
  if (!g) return;
  g.arrived = arrived;                       // optimistic: the desk must feel instant
  if (arrived) g.at = new Date().toTimeString().slice(0, 5);
  render();
  try {
    await fetch('/checkin/mark?key=' + KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, arrived: arrived }),
    });
  } catch (e) { toast('Offline \\u2014 will not sync until connection returns', null); }
  load();
}

document.getElementById('list').addEventListener('click', function (e) {
  var card = e.target.closest('.g');
  if (!card) return;
  var email = card.getAttribute('data-email');
  var g = guests.filter(function (x) { return x.email === email; })[0];
  if (!g) return;
  if (g.arrived) {
    mark(email, false);
    toast(g.name + ' \\u2014 check-in removed', null);
  } else {
    mark(email, true);
    toast(g.name + ' \\u2014 welcome!', function () { mark(email, false); });
  }
});

document.getElementById('undo').addEventListener('click', function () {
  if (lastUndo) lastUndo();
  document.getElementById('toast').classList.remove('show');
});

document.getElementById('q').addEventListener('input', render);
load();
setInterval(load, 20000);   // pick up registrations made while the desk is open
</script>
</body></html>`;
}

module.exports = { mount };
