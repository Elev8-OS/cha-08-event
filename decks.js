/**
 * Slide decks: upload from the admin, assigned to a session.
 *
 * Files go onto the Railway volume, not into the repository. Two reasons:
 * a deploy would otherwise wipe them, and nobody should need a GitHub account
 * to publish a PDF the afternoon after an event.
 *
 * A session holds a list of PDFs, not a single one — speakers routinely send
 * slides plus a handout — and optionally a Google Drive link for the things
 * that do not belong in an 8 MB PDF: recordings, spreadsheets, originals.
 *
 * The assignment lives in decks.json next to the files, so slides.js can read
 * it without knowing anything about how it got there.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DECK_DIR = path.join(DATA_DIR, 'decks');
const MAP_FILE = path.join(DATA_DIR, 'decks.json');

// A phone on mobile data has to open these, so there is a ceiling
const MAX_MB = 8;
// Per session. Not a real constraint, just a guard against a stuck loop
// filling the volume.
const MAX_FILES = 8;

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

/**
 * { "<session slug>": { files: [{ file, original, size, ts }], drive: "" } }
 *
 * Entries written before this page handled more than one PDF are the bare
 * { file, original, size, ts } object. They are migrated on read rather than
 * in a one-off script, so an old decks.json on the volume keeps working after
 * a deploy without anyone having to remember to run anything.
 */
function normalise(entry) {
  if (!entry || typeof entry !== 'object') return { files: [], drive: '' };
  const files = Array.isArray(entry.files)
    ? entry.files.filter((f) => f && f.file)
    : entry.file
      ? [{ file: entry.file, original: entry.original || '', size: entry.size || 0, ts: entry.ts || '' }]
      : [];
  return { files, drive: typeof entry.drive === 'string' ? entry.drive : '' };
}

function readMap() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); } catch { return {}; }
  const out = {};
  for (const key of Object.keys(raw || {})) out[key] = normalise(raw[key]);
  return out;
}

function writeMap(m) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 2));
}

function slug(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// The first upload for a session is <slug>.pdf, as it always was; further ones
// get a suffix. Checked against disk as well as the map so a file left behind
// by an interrupted upload is never overwritten.
function freeName(key, taken) {
  const used = new Set(taken);
  for (let n = 0; n <= MAX_FILES + 2; n++) {
    const name = n === 0 ? key + '.pdf' : key + '-' + n + '.pdf';
    if (!used.has(name) && !fs.existsSync(path.join(DECK_DIR, name))) return name;
  }
  return key + '-' + Date.now() + '.pdf';
}

// Anything that is not an https URL is either a typo or an attempt at
// something clever. Google Drive is what this is for, but a Dropbox or
// OneDrive link works the same way, so the check stops at the scheme.
function cleanLink(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^https:\/\/[^\s/]+\.[^\s/]/i.test(s) || s.length > 500) return null;
  return s;
}

// A Drive folder URL runs to a hundred characters of folder id. Show enough
// of one to recognise which folder it points at, and no more — the card
// column is narrow and a wrapped URL looks like a broken one.
function shortLink(u) {
  const s = String(u).replace(/^https:\/\//, '').replace(/^www\./, '');
  return s.length > 34 ? s.slice(0, 32) + '…' : s;
}

function unpublish(file) {
  const full = path.join(DECK_DIR, file);
  // Keep the file, just unpublish it: a deleted deck is usually a mistake
  if (fs.existsSync(full)) fs.renameSync(full, full + '.removed-' + Date.now());
}

function mount(app, deps) {
  const sessions = deps.sessions;
  const sessionFor = (key) => sessions().find((s) => slug(s.title) === key);

  // Public: the slides page links straight here
  app.get('/decks/:file', (req, res) => {
    const file = String(req.params.file).replace(/[^a-z0-9._-]/gi, '');
    const full = path.join(DECK_DIR, file);
    if (!file || !fs.existsSync(full)) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(fs.readFileSync(full));
  });

  // The PDF is posted as itself, not as base64 inside JSON. Base64 is a third
  // larger than the file it carries, so an 8 MB deck used to arrive as ~10.7 MB
  // and bounce off the global 9 MB JSON limit with a 413 this page could not
  // turn into a readable error. application/pdf never reaches express.json(),
  // so the ceiling here is the only one that applies.
  app.post('/admin/decks/upload',
    express.raw({ type: 'application/pdf', limit: MAX_MB + 2 + 'mb' }),
    (req, res) => {
    if (!guard(req, res)) return;
    const key = String(req.query.session || '');
    if (!sessionFor(key)) return res.status(400).json({ ok: false, error: 'Unknown session.' });

    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    // Trust the bytes, not the extension the browser reported
    if (!buf || buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({ ok: false, error: 'That does not look like a PDF file.' });
    }
    if (buf.length > MAX_MB * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: `That PDF is ${(buf.length / 1048576).toFixed(1)} MB. Please compress it below ${MAX_MB} MB first.` });
    }

    const map = readMap();
    const entry = map[key] || { files: [], drive: '' };
    const original = String(req.query.name || '').slice(0, 120);

    // Uploading the same filename twice means "I fixed that one", not
    // "publish it again", so it replaces the existing entry in place.
    const at = entry.files.findIndex((f) => f.original && f.original.toLowerCase() === original.toLowerCase());
    if (at < 0 && entry.files.length >= MAX_FILES) {
      return res.status(400).json({ ok: false, error: `That session already has ${MAX_FILES} PDFs. Remove one first.` });
    }

    fs.mkdirSync(DECK_DIR, { recursive: true });
    const file = at >= 0 ? entry.files[at].file : freeName(key, entry.files.map((f) => f.file));
    fs.writeFileSync(path.join(DECK_DIR, file), buf);

    const rec = { file, original, size: buf.length, ts: new Date().toISOString() };
    if (at >= 0) entry.files[at] = rec; else entry.files.push(rec);
    map[key] = entry;
    writeMap(map);
    console.log('[decks]', at >= 0 ? 'replaced' : 'uploaded', key, file, (buf.length / 1048576).toFixed(1) + ' MB');
    res.json({ ok: true, file, size: buf.length, count: entry.files.length });
  });

  app.post('/admin/decks/delete', (req, res) => {
    if (!guard(req, res)) return;
    const b = req.body || {};
    const key = String(b.session || '');
    const target = String(b.file || '');
    const map = readMap();
    const entry = map[key];
    if (entry) {
      // Without a filename this removes every deck for the session, which is
      // what the old single-deck endpoint did.
      const going = target ? entry.files.filter((f) => f.file === target) : entry.files.slice();
      going.forEach((f) => unpublish(f.file));
      entry.files = entry.files.filter((f) => !going.includes(f));
      if (!entry.files.length && !entry.drive) delete map[key]; else map[key] = entry;
      writeMap(map);
      console.log('[decks] unpublished', key, target || '(all)');
    }
    res.json({ ok: true });
  });

  app.post('/admin/decks/link', (req, res) => {
    if (!guard(req, res)) return;
    const b = req.body || {};
    const key = String(b.session || '');
    if (!sessionFor(key)) return res.status(400).json({ ok: false, error: 'Unknown session.' });

    const url = cleanLink(b.url);
    if (url === null) return res.status(400).json({ ok: false, error: 'That does not look like a link. Paste the full address, starting with https://' });

    const map = readMap();
    const entry = map[key] || { files: [], drive: '' };
    entry.drive = url;
    if (!entry.files.length && !entry.drive) delete map[key]; else map[key] = entry;
    writeMap(map);
    console.log('[decks]', url ? 'linked' : 'unlinked', key);
    res.json({ ok: true, drive: url });
  });

  app.get('/admin/decks', (req, res) => {
    if (!guard(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    res.send(page(encodeURIComponent(req.query.key), sessions(), readMap()));
  });
}

function page(k, sessions, map) {
  // A 30 KB file showing as "0.0 MB" tells nobody anything, and neither
  // does a 400-byte one showing as "0 KB"
  const size = (n) => (n < 1024 ? '<1 KB' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  const cards = sessions.map((s) => {
    const key = slug(s.title);
    const cur = map[key] || { files: [], drive: '' };
    const has = cur.files.length > 0 || !!cur.drive;

    // A saved link is part of what the session publishes, so it is listed with
    // the PDFs rather than hidden in the input below. Without this, a session
    // that has a link and no PDF turns green and still reads "No deck yet".
    const rows = cur.files.map((f) => `<li>
          <a href="/decks/${esc(f.file)}" target="_blank">${esc(f.original || f.file)}</a>
          <span class="meta">${size(f.size)}${f.ts ? ' &middot; ' + esc(f.ts.slice(0, 10)) : ''}</span>
          <button type="button" class="rm" data-file="${esc(f.file)}" title="Remove this PDF">&times;</button>
        </li>`);
    if (cur.drive) {
      rows.push(`<li class="drv">
          <a href="${esc(cur.drive)}" target="_blank" rel="noopener noreferrer">${esc(shortLink(cur.drive))}</a>
          <span class="meta">Google Drive &middot; shown on the slides page</span>
        </li>`);
    }
    const files = rows.length
      ? `<ul class="files">${rows.join('')}</ul>`
      : '<p class="none">No deck yet</p>';

    return `<article class="s${has ? ' has' : ''}" data-key="${key}">
      <h3>${esc(s.title)}</h3>
      <div class="sp">${esc(s.speaker)}</div>
      <div class="state">${files}</div>
      <div class="acts">
        <label class="pick">${cur.files.length ? 'Add PDFs' : 'Choose PDFs'}
          <input type="file" accept="application/pdf" multiple hidden></label>
      </div>
      <div class="link">
        <label for="lk-${key}">Google Drive link <span>optional</span></label>
        <div class="row">
          <input id="lk-${key}" class="lk" type="url" inputmode="url" spellcheck="false"
            placeholder="https://drive.google.com/..." value="${esc(cur.drive)}">
          <button type="button" class="save">Save</button>
        </div>
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
  .files{list-style:none;display:flex;flex-direction:column;gap:7px}
  /* The remove button is pinned right so the column of x's lines up however
     long the filenames are. */
  .files li{display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:2px 10px}
  .files a{color:#111;font-weight:600;grid-column:1}
  .files .meta{grid-column:1;font-size:12.5px;color:#999}
  .files .rm{grid-column:2;grid-row:1/span 2;align-self:center;background:#fff;border:1px solid #e3bcbc;
    color:#a33;border-radius:8px;width:30px;height:30px;font:inherit;font-size:17px;line-height:1;
    cursor:pointer;flex:none}
  /* The link is not a file: separated, and in link blue rather than ink. */
  .files .drv{border-top:1px dashed #e5e0d5;padding-top:8px;margin-top:1px}
  .files .drv a{color:#1B5E9C}
  .none{color:#999}
  .acts{display:flex;gap:9px;align-items:center;margin-top:auto;padding-top:14px;flex-wrap:wrap}
  .pick{background:#F6BB12;border-radius:9px;padding:11px 16px;font-size:14px;font-weight:700;
    cursor:pointer;display:inline-block}
  .link{margin-top:14px;padding-top:13px;border-top:1px dashed #e5e0d5}
  .link label{display:block;font-size:12.5px;font-weight:600;color:#666;margin-bottom:6px}
  .link label span{font-weight:400;color:#aaa}
  .link .row{display:flex;gap:7px}
  .link input{flex:1;min-width:0;border:1px solid #ddd6c8;border-radius:9px;padding:9px 11px;
    font:inherit;font-size:13.5px;background:#fff}
  .link .save{background:#fff;border:1px solid #ddd6c8;border-radius:9px;padding:9px 14px;
    font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;flex:none}
  .msg{font-size:13px;margin-top:9px;display:none}
  .msg.on{display:block}
  .msg.err{color:#a33}
  .msg.busy{color:#8A6D2F;font-weight:600}
  .msg.ok{color:#2c7a3d;font-weight:600}
  a{color:#333}
  @media(max-width:600px){body{padding:14px}.grid{grid-template-columns:1fr}}
  </style></head><body>
  <p><a href="/admin?key=${k}">&larr; Back to registrations</a> &middot;
     <a href="/slides" target="_blank">See the public page</a></p>
  <h1>Slide decks</h1>
  <p class="lead">Upload one or more PDFs per session &mdash; slides, a handout, a price list.
    They appear on the public slides page straight away, in the order you upload them;
    that is the page linked from the follow-up email. Keep each PDF under 8 MB: most people
    open them on a phone. Anything too big for that &mdash; a recording, the original file &mdash;
    goes behind the Google Drive link instead.</p>
  <div class="grid">${cards}</div>

  <script>
  var KEY = '${k}';
  var MAX_MB = ${MAX_MB};

  function show(card, text, cls) {
    var m = card.querySelector('.msg');
    m.textContent = text;
    m.className = 'msg on ' + (cls || '');
  }

  // Every endpoint here answers in JSON. A response that is not JSON is the
  // platform failing somewhere above the app, and \"HTTP 502\" beats a
  // SyntaxError about an unexpected '<'.
  async function send(path, init) {
    var r = await fetch(path, init);
    var d = null;
    try { d = await r.json(); } catch (e) { /* handled below */ }
    if (!d) throw new Error('The server answered with HTTP ' + r.status + '. Please try again.');
    if (!d.ok) throw new Error(d.error || 'That did not work.');
    return d;
  }

  function shortLink(u) {
    var s = String(u).replace(/^https:\\/\\//, '').replace(/^www\\./, '');
    return s.length > 34 ? s.slice(0, 32) + '\u2026' : s;
  }

  // Saving a link has to change what the card shows, or the admin is left
  // reading "No deck yet" under a field they just filled in. Done in place
  // rather than with a reload: this page is used on venue wifi.
  function drawLink(card, url) {
    var state = card.querySelector('.state');
    var list = state.querySelector('.files');
    var row = state.querySelector('.drv');

    if (!url) {
      if (row) row.parentNode.removeChild(row);
      list = state.querySelector('.files');
      if (!list || !list.children.length) state.innerHTML = '<p class="none">No deck yet</p>';
      return;
    }
    if (!list) { state.innerHTML = '<ul class="files"></ul>'; list = state.querySelector('.files'); }
    if (!row) {
      row = document.createElement('li');
      row.className = 'drv';
      row.innerHTML = '<a target="_blank" rel="noopener noreferrer"></a>'
        + '<span class="meta">Google Drive \u00b7 shown on the slides page</span>';
      list.appendChild(row);
    }
    var a = row.querySelector('a');
    a.href = url;
    a.textContent = shortLink(url);
  }

  function post(path, body) {
    return send(path + '?key=' + KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // The file goes up as itself. No FileReader, no base64, no 33% of dead
  // weight on a Canggu uplink.
  function upload(key, f) {
    return send('/admin/decks/upload?key=' + KEY
      + '&session=' + encodeURIComponent(key) + '&name=' + encodeURIComponent(f.name),
      { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: f });
  }

  // One request per file rather than one big one: a failure halfway through
  // then costs you the rest of the batch, not the ones already up.
  document.addEventListener('change', async function (e) {
    if (e.target.type !== 'file') return;
    var input = e.target, card = input.closest('.s');
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!files.length) return;

    var bad = files.filter(function (f) { return f.type !== 'application/pdf'; });
    if (bad.length) { show(card, bad[0].name + ' is not a PDF.', 'err'); return; }
    // Checked here, not just on the server: an oversized upload would be
    // refused by the request size limit with an error nobody can read.
    var big = files.filter(function (f) { return f.size > MAX_MB * 1048576; });
    if (big.length) {
      show(card, big[0].name + ' is ' + (big[0].size / 1048576).toFixed(1) + ' MB. Please compress it below '
        + MAX_MB + ' MB \\u2014 most people open these on a phone.', 'err');
      return;
    }

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      show(card, files.length > 1
        ? 'Uploading ' + (i + 1) + ' of ' + files.length + ' \\u2014 ' + f.name + '\\u2026'
        : 'Uploading ' + (f.size / 1048576).toFixed(1) + ' MB\\u2026', 'busy');
      try {
        await upload(card.getAttribute('data-key'), f);
      } catch (ex) {
        show(card, ex.message, 'err');
        return;
      }
    }
    location.reload();
  });

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('.rm');
    if (b) {
      var card = b.closest('.s');
      var name = (b.closest('li').querySelector('a') || {}).textContent || 'this deck';
      if (!confirm('Remove ' + name + ' from the public page? The file is kept on the server.')) return;
      b.disabled = true;
      try {
        await post('/admin/decks/delete', { session: card.getAttribute('data-key'), file: b.getAttribute('data-file') });
        location.reload();
      } catch (ex) { b.disabled = false; show(card, 'Could not remove it.', 'err'); }
      return;
    }

    var s = e.target.closest('.save');
    if (!s) return;
    var card2 = s.closest('.s');
    var url = card2.querySelector('.lk').value.trim();
    s.disabled = true;
    show(card2, 'Saving\\u2026', 'busy');
    try {
      // Draw what the server accepted, not what was typed: it is the value
      // that got stored, and it has been through the https check.
      var d = await post('/admin/decks/link', { session: card2.getAttribute('data-key'), url: url });
      card2.querySelector('.lk').value = d.drive || '';
      drawLink(card2, d.drive || '');
      show(card2, d.drive ? 'Link saved.' : 'Link removed.', 'ok');
      card2.classList.toggle('has', !!d.drive || !!card2.querySelector('.files li:not(.drv)'));
    } catch (ex) { show(card2, ex.message, 'err'); }
    s.disabled = false;
  });
  </script>
  </body></html>`;
}

module.exports = { mount, readMap, slug };
