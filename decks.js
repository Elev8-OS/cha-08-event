/**
 * Slide decks: upload from the admin, assigned to a session.
 *
 * Files go onto the Railway volume, not into the repository. Two reasons:
 * a deploy would otherwise wipe them, and nobody should need a GitHub account
 * to publish a PDF the afternoon after an event.
 *
 * The assignment lives in decks.json next to the files, so slides.js can read
 * it without knowing anything about how it got there.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DECK_DIR = path.join(DATA_DIR, 'decks');
const MAP_FILE = path.join(DATA_DIR, 'decks.json');

// A phone on mobile data has to open these, so there is a ceiling
const MAX_MB = 8;

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

// { "<session slug>": { file, original, size, ts } }
function readMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); } catch { return {}; }
}

function writeMap(m) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 2));
}

function slug(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function mount(app, deps) {
  const sessions = deps.sessions;

  // Public: the slides page links straight here
  app.get('/decks/:file', (req, res) => {
    const file = String(req.params.file).replace(/[^a-z0-9._-]/gi, '');
    const full = path.join(DECK_DIR, file);
    if (!file || !fs.existsSync(full)) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(fs.readFileSync(full));
  });

  app.post('/admin/decks/upload', (req, res) => {
    if (!guard(req, res)) return;
    const b = req.body || {};
    const key = String(b.session || '');
    const session = sessions().find((s) => slug(s.title) === key);
    if (!session) return res.status(400).json({ ok: false, error: 'Unknown session.' });

    const m = /^data:application\/pdf;base64,(.+)$/.exec(String(b.data || ''));
    if (!m) return res.status(400).json({ ok: false, error: 'Please choose a PDF file.' });
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_MB * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: `That PDF is ${(buf.length / 1048576).toFixed(1)} MB. Please compress it below ${MAX_MB} MB first.` });
    }

    fs.mkdirSync(DECK_DIR, { recursive: true });
    // Named after the session, so a re-upload simply replaces it
    const file = key + '.pdf';
    fs.writeFileSync(path.join(DECK_DIR, file), buf);

    const map = readMap();
    map[key] = {
      file,
      original: String(b.filename || '').slice(0, 120),
      size: buf.length,
      ts: new Date().toISOString(),
    };
    writeMap(map);
    console.log('[decks] uploaded', key, (buf.length / 1048576).toFixed(1) + ' MB');
    res.json({ ok: true, file, size: buf.length });
  });

  app.post('/admin/decks/delete', (req, res) => {
    if (!guard(req, res)) return;
    const key = String((req.body || {}).session || '');
    const map = readMap();
    if (map[key]) {
      const full = path.join(DECK_DIR, map[key].file);
      // Keep the file, just unpublish it: a deleted deck is usually a mistake
      if (fs.existsSync(full)) {
        fs.renameSync(full, full + '.removed-' + Date.now());
      }
      delete map[key];
      writeMap(map);
      console.log('[decks] unpublished', key);
    }
    res.json({ ok: true });
  });

  app.get('/admin/decks', (req, res) => {
    if (!guard(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    res.send(page(encodeURIComponent(req.query.key), sessions(), readMap()));
  });
}

function page(k, sessions, map) {
  // A 30 KB file showing as "0.0 MB" tells nobody anything
  const size = (n) => (n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  const cards = sessions.map((s) => {
    const key = slug(s.title);
    const cur = map[key];
    return `<article class="s${cur ? ' has' : ''}" data-key="${key}">
      <h3>${esc(s.title)}</h3>
      <div class="sp">${esc(s.speaker)}</div>
      <div class="state">${cur
        ? `<a href="/decks/${esc(cur.file)}" target="_blank">${esc(cur.original || cur.file)}</a>
           <span class="meta">${size(cur.size)} &middot; uploaded ${esc(cur.ts.slice(0, 10))}</span>`
        : '<span class="none">No deck yet</span>'}</div>
      <div class="acts">
        <label class="pick">${cur ? 'Replace PDF' : 'Choose PDF'}
          <input type="file" accept="application/pdf" hidden></label>
        ${cur ? '<button type="button" class="rm">Remove</button>' : ''}
      </div>
      <div class="msg"></div>
    </article>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Slide decks</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111111">
  <link rel="apple-touch-icon" href="/img/appicon.png">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>*{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,system-ui,sans-serif;background:#F7F4EE;color:#111;padding:18px;max-width:820px;
    padding-bottom:calc(30px + env(safe-area-inset-bottom))}
  h1{font-size:20px;margin:6px 0 4px}
  .lead{color:#666;font-size:14px;margin-bottom:18px}
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
  /* Cards stretch to the tallest in the row; without this the button sits
     wherever the speaker line happens to end. */
  .s{background:#fff;border:1px solid #e5e0d5;border-radius:14px;padding:16px 18px;
    display:flex;flex-direction:column}
  .s.has{background:#F7FCF8;border-color:#cfe8d4}
  .s h3{font-size:16.5px}
  .sp{font-size:13px;color:#8A6D2F;font-weight:600;margin-top:3px}
  .state{margin-top:10px;font-size:14px;overflow-wrap:anywhere}
  .state a{color:#111;font-weight:600}
  .meta{display:block;font-size:12.5px;color:#999;margin-top:3px}
  .none{color:#999}
  .acts{display:flex;gap:9px;align-items:center;margin-top:auto;padding-top:14px;flex-wrap:wrap}
  .pick{background:#F6BB12;border-radius:9px;padding:11px 16px;font-size:14px;font-weight:700;
    cursor:pointer;display:inline-block}
  .rm{background:#fff;border:1px solid #e3bcbc;color:#a33;border-radius:9px;padding:11px 14px;
    font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}
  .msg{font-size:13px;margin-top:9px;display:none}
  .msg.on{display:block}
  .msg.err{color:#a33}
  .msg.busy{color:#8A6D2F;font-weight:600}
  a{color:#333}
  @media(max-width:600px){body{padding:14px}.grid{grid-template-columns:1fr}}
  </style></head><body>
  <p><a href="/admin?key=${k}">&larr; Back to registrations</a> &middot;
     <a href="/slides" target="_blank">See the public page</a></p>
  <h1>Slide decks</h1>
  <p class="lead">Upload a PDF per session. It appears on the public slides page
    straight away &mdash; that is the page linked from the follow-up email.
    Keep decks under 8 MB: most people open them on a phone.</p>
  <div class="grid">${cards}</div>

  <script>
  function show(card, text, cls) {
    var m = card.querySelector('.msg');
    m.textContent = text;
    m.className = 'msg on ' + (cls || '');
  }

  document.addEventListener('change', function (e) {
    if (e.target.type !== 'file') return;
    var input = e.target, card = input.closest('.s');
    var f = input.files && input.files[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { show(card, 'That is not a PDF.', 'err'); return; }
    // Check here, not just on the server: a 20 MB upload would be refused by
    // the request size limit with an error nobody can read.
    if (f.size > 8 * 1048576) {
      show(card, 'That PDF is ' + (f.size / 1048576).toFixed(1) + ' MB. Please compress it below '
        + 8 + ' MB \\u2014 most people open these on a phone.', 'err');
      input.value = '';
      return;
    }
    show(card, 'Uploading ' + (f.size / 1048576).toFixed(1) + ' MB\\u2026', 'busy');

    var r = new FileReader();
    r.onload = async function () {
      try {
        var res = await fetch('/admin/decks/upload?key=${k}', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: card.getAttribute('data-key'), filename: f.name, data: r.result }),
        });
        var d = await res.json();
        if (!d.ok) throw new Error(d.error || 'Upload failed.');
        location.reload();
      } catch (ex) { show(card, ex.message, 'err'); }
    };
    r.onerror = function () { show(card, 'Could not read that file.', 'err'); };
    r.readAsDataURL(f);
  });

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('.rm');
    if (!b) return;
    var card = b.closest('.s');
    if (!confirm('Remove this deck from the public page? The file is kept on the server.')) return;
    b.disabled = true;
    try {
      await fetch('/admin/decks/delete?key=${k}', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: card.getAttribute('data-key') }),
      });
      location.reload();
    } catch (ex) { b.disabled = false; show(card, 'Could not remove it.', 'err'); }
  });
  </script>
  </body></html>`;
}

module.exports = { mount, readMap, slug };
