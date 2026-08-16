/**
 * Post-event feedback: a public three-question form and an admin summary.
 *
 * Kept deliberately short. Every extra question costs responses, and three
 * answers from forty people beat ten answers from four.
 */

const fs = require('fs');
const path = require('path');

const TOPICS = [
  'Revenue management',
  'Finance & reporting',
  'Guest reporting & APOA',
  'Data protection law',
  'Direct booking playbook',
  'AI in daily operations',
];

function mount(app, deps) {
  const { DATA_DIR, guard } = deps;
  const FILE = () => path.join(DATA_DIR, 'feedback.jsonl');

  function readAll() {
    if (!fs.existsSync(FILE())) return [];
    return fs.readFileSync(FILE(), 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  app.get('/feedback', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(form());
  });

  app.post('/api/feedback', (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot
    const rating = parseInt(b.rating, 10);
    if (!(rating >= 1 && rating <= 5)) {
      return res.status(400).json({ ok: false, error: 'Please give a rating.' });
    }
    const entry = {
      ts: new Date().toISOString(),
      rating,
      topic: TOPICS.includes(String(b.topic)) ? String(b.topic) : '',
      next: String(b.next || '').slice(0, 1000),
      name: String(b.name || '').trim().slice(0, 120),
      email: String(b.email || '').trim().toLowerCase().slice(0, 160),
    };
    fs.appendFileSync(FILE(), JSON.stringify(entry) + '\n');
    console.log('[feedback]', entry.rating, entry.topic, entry.email || '(anonymous)');
    res.json({ ok: true });
  });

  app.get('/admin/feedback', (req, res) => {
    if (!guard(req, res)) return;
    const k = encodeURIComponent(req.query.key);
    const rows = readAll();
    const avg = rows.length ? (rows.reduce((a, r) => a + r.rating, 0) / rows.length).toFixed(1) : '\u2014';

    const byTopic = new Map();
    rows.forEach((r) => { if (r.topic) byTopic.set(r.topic, (byTopic.get(r.topic) || 0) + 1); });
    const maxTopic = Math.max(1, ...byTopic.values());

    const byRating = [5, 4, 3, 2, 1].map((n) => ({ n, c: rows.filter((r) => r.rating === n).length }));
    const maxRating = Math.max(1, ...byRating.map((x) => x.c));

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const comments = rows.filter((r) => r.next).reverse().map((r) => `
      <div class="c"><p>${esc(r.next)}</p>
      <span>${esc(r.name || 'Anonymous')}${r.email ? ' &middot; ' + esc(r.email) : ''}
        &middot; rated ${r.rating}/5</span></div>`).join('');

    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Feedback</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#111111">
    <link rel="apple-touch-icon" href="/img/appicon.png">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,system-ui,sans-serif;background:#F7F4EE;color:#111;padding:18px;max-width:820px;
      padding-bottom:calc(30px + env(safe-area-inset-bottom))}
    h1{font-size:20px;margin:6px 0 14px}h2{font-size:15px;margin:26px 0 8px}
    .cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}
    .card{background:#fff;border:1px solid #e5e0d5;border-radius:10px;padding:14px 16px}
    .card .n{font-size:26px;font-weight:700}
    .card .l{font-size:11.5px;color:#666;text-transform:uppercase;letter-spacing:1px}
    .bars{background:#fff;border:1px solid #e5e0d5;border-radius:12px;padding:16px 18px}
    .b{display:flex;align-items:center;gap:12px;margin-bottom:9px;font-size:14px}
    .b span:first-child{width:150px;flex-shrink:0}
    .b .track{flex:1;background:#F2EEE5;border-radius:4px;height:16px;overflow:hidden}
    .b .fill{background:#F6BB12;height:100%}
    .b .num{width:28px;text-align:right;font-weight:600}
    .c{background:#fff;border:1px solid #e5e0d5;border-radius:12px;padding:14px 16px;margin-bottom:10px}
    .c p{font-size:15px;line-height:1.5}
    .c span{font-size:12.5px;color:#888;display:block;margin-top:7px}
    .empty{background:#fff;border:1px dashed #d8d2c4;border-radius:12px;padding:34px;text-align:center;color:#666}
    a{color:#333}</style></head><body>
    <p><a href="/admin?key=${k}">&larr; Back to registrations</a></p>
    <h1>Feedback</h1>
    <div class="cards">
      <div class="card"><div class="n">${rows.length}</div><div class="l">Responses</div></div>
      <div class="card"><div class="n">${avg}</div><div class="l">Average rating</div></div>
      <div class="card"><div class="n">${rows.filter((r) => r.next).length}</div><div class="l">With comments</div></div>
    </div>

    <h2>Ratings</h2>
    <div class="bars">${byRating.map((x) => `
      <div class="b"><span>${x.n} \u2605</span>
        <span class="track"><span class="fill" style="width:${Math.round((x.c / maxRating) * 100)}%"></span></span>
        <span class="num">${x.c}</span></div>`).join('')}</div>

    <h2>Most valuable topic</h2>
    <div class="bars">${TOPICS.map((t) => {
      const c = byTopic.get(t) || 0;
      return `<div class="b"><span>${t}</span>
        <span class="track"><span class="fill" style="width:${Math.round((c / maxTopic) * 100)}%"></span></span>
        <span class="num">${c}</span></div>`;
    }).join('')}</div>

    <h2>What to cover next time</h2>
    ${comments || '<div class="empty">No written comments yet.</div>'}
    </body></html>`);
  });
}

function form() {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your feedback &middot; Smarter Revenue, Better Tech</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#F7F4EE">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--cream:#F7F4EE;--ink:#111;--gold:#C9A24B;--grey:#555}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:var(--cream);color:var(--ink);line-height:1.5}
.wrap{max-width:620px;margin:0 auto;padding:36px 22px 70px}
.logos{display:flex;align-items:center;justify-content:center;gap:0}
.logos .cell{flex:1;display:flex;justify-content:center}
.logos img{max-height:46px;max-width:100%;height:auto}
.logos img.c{max-height:70px}
h1{font-family:'Archivo Black',sans-serif;text-align:center;font-size:clamp(24px,5vw,34px);line-height:1.15;margin-top:24px}
.lead{text-align:center;color:var(--grey);margin-top:10px;font-size:15px}
form{background:#fff;border:1px solid #e5e0d5;border-radius:16px;padding:26px;margin-top:26px}
label{display:block;font-weight:600;font-size:14.5px;margin-bottom:9px}
.q{margin-bottom:26px}
.stars{display:flex;gap:8px}
.stars button{flex:1;background:#FCFBF8;border:1px solid #d8d2c4;border-radius:10px;padding:14px 0;
  font:inherit;font-size:20px;cursor:pointer;line-height:1}
.stars button.on{background:var(--gold);border-color:var(--gold)}
.opts{display:grid;gap:8px}
.opts button{background:#FCFBF8;border:1px solid #d8d2c4;border-radius:10px;padding:13px 15px;
  font:inherit;font-size:14.5px;text-align:left;cursor:pointer}
.opts button.on{background:var(--ink);color:var(--cream);border-color:var(--ink)}
textarea{width:100%;padding:12px;border:1px solid #d8d2c4;border-radius:10px;font:inherit;
  font-size:15px;background:#FCFBF8;min-height:96px;resize:vertical}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:520px){.grid2{grid-template-columns:1fr}}
input{width:100%;padding:11px 12px;border:1px solid #d8d2c4;border-radius:9px;font:inherit;font-size:15px;background:#FCFBF8}
.hp{position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden}
.send{margin-top:6px;width:100%;background:var(--ink);color:var(--cream);border:0;border-radius:10px;
  padding:15px;font:inherit;font-weight:700;font-size:16px;cursor:pointer}
.send:disabled{opacity:.6;cursor:wait}
.err{display:none;color:#a33;font-size:14px;margin-top:10px;text-align:center}
.ok{display:none;text-align:center;background:#fff;border:2px solid var(--gold);border-radius:16px;padding:38px 28px;margin-top:26px}
.ok h3{font-family:'Archivo Black',sans-serif;font-size:22px}
.ok p{margin-top:10px}
.small{font-size:13px;color:var(--grey);margin-top:14px;text-align:center}
footer{text-align:center;font-size:13px;color:var(--grey);margin-top:40px}
</style></head><body>
<div class="wrap">
  <div class="logos">
    <div class="cell"><img src="/img/elev8.jpg" alt="Elev8 Suite"></div>
    <div class="cell"><img class="c" src="/img/cha.jpg?v=2" alt="Canggu Hospitality Association"></div>
    <div class="cell"><img src="/img/mekari.jpg?v=2" alt="Mekari"></div>
  </div>

  <h1>HOW DID WE DO?</h1>
  <p class="lead">Three questions, under a minute. It shapes the next one.</p>

  <form id="f">
    <div class="q">
      <label>How useful was the afternoon for your operation?</label>
      <div class="stars" id="stars">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}">\u2605</button>`).join('')}
      </div>
    </div>

    <div class="q">
      <label>Which session was most valuable to you?</label>
      <div class="opts" id="topics">
        ${TOPICS.map((t) => `<button type="button" data-v="${t}">${t}</button>`).join('')}
      </div>
    </div>

    <div class="q">
      <label>What should we cover next time?</label>
      <textarea id="next" placeholder="A topic, a speaker, a format \u2014 anything."></textarea>
    </div>

    <div class="grid2">
      <input id="name" placeholder="Your name (optional)" autocomplete="name">
      <input id="email" type="email" placeholder="Email (optional)" autocomplete="email">
    </div>
    <div class="hp"><input id="website" tabindex="-1" autocomplete="off"></div>

    <p class="small">Leave your name if you would like a reply. Otherwise it stays anonymous.</p>
    <button type="button" class="send" id="send">Send feedback</button>
    <div class="err" id="err"></div>
  </form>

  <div class="ok" id="ok">
    <h3>THANK YOU.</h3>
    <p>That genuinely helps. If you asked for a reply, you will hear from us this week.</p>
  </div>

  <footer>An Elev8 Suite event with the Canggu Hospitality Association and Mekari</footer>
</div>

<script>
(function () {
  var rating = 0, topic = '';
  function wire(id, set) {
    document.getElementById(id).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      [].forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
      if (id === 'stars') {
        // Light up every star up to the one tapped, the way people expect
        var v = parseInt(b.dataset.v, 10);
        [].forEach.call(this.querySelectorAll('button'), function (x) {
          if (parseInt(x.dataset.v, 10) <= v) x.classList.add('on');
        });
      } else { b.classList.add('on'); }
      set(b.dataset.v);
    });
  }
  wire('stars', function (v) { rating = parseInt(v, 10); });
  wire('topics', function (v) { topic = v; });

  document.getElementById('send').addEventListener('click', async function () {
    var err = document.getElementById('err');
    err.style.display = 'none';
    if (!rating) { err.textContent = 'Please tap a rating first.'; err.style.display = 'block'; return; }
    this.disabled = true; this.textContent = 'Sending\\u2026';
    try {
      var r = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: rating, topic: topic,
          next: document.getElementById('next').value,
          name: document.getElementById('name').value,
          email: document.getElementById('email').value,
          website: document.getElementById('website').value,
        }),
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Something went wrong.');
      document.getElementById('f').style.display = 'none';
      document.getElementById('ok').style.display = 'block';
    } catch (ex) {
      err.textContent = ex.message || 'Something went wrong \\u2014 please try again.';
      err.style.display = 'block';
      this.disabled = false; this.textContent = 'Send feedback';
    }
  });
})();
</script>
</body></html>`;
}

module.exports = { mount, TOPICS };
