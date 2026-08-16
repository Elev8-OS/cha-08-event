/**
 * Archive browser.
 *
 * Everything the admin "removes" is moved into archive-* folders rather than
 * deleted. This module makes those folders readable again and lets a single
 * registration be put back into the live list.
 *
 * The reset password guards the whole area. It is exchanged once for a
 * short-lived token so the password itself never sits in a link, a hidden
 * form field, or the browser history.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_TTL_MS = 30 * 60 * 1000;
const tokens = new Map();

function issueToken() {
  const t = crypto.randomBytes(24).toString('hex');
  tokens.set(t, Date.now() + TOKEN_TTL_MS);
  return t;
}

function validToken(t) {
  const exp = tokens.get(String(t || ''));
  if (!exp) return false;
  if (Date.now() > exp) { tokens.delete(t); return false; }
  return true;
}

// Files that hold one JSON object per line, keyed by email
const KEYED = ['registrations.jsonl', 'payments.jsonl', 'pending.jsonl', 'ghl-sync.jsonl', 'checkins.jsonl'];

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

function writeLines(file, lines) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '');
  fs.renameSync(tmp, file);
}

function mount(app, deps) {
  const { DATA_DIR, guard, PROOF_DIR, RESET_PASSWORD, SEAT_PRICE } = deps;

  const folders = () => (fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [])
    .filter((f) => f.startsWith('archive-') && fs.statSync(path.join(DATA_DIR, f)).isDirectory())
    .sort().reverse();

  // Registrations inside one archive folder, plus whether that email is live again
  function entriesIn(folder) {
    const live = new Set(readLines(path.join(DATA_DIR, 'registrations.jsonl'))
      .map((l) => { try { return JSON.parse(l).email; } catch { return ''; } }));
    return readLines(path.join(DATA_DIR, folder, 'registrations.jsonl'))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .map((r) => ({ ...r, alreadyLive: live.has(r.email) }));
  }

  app.get('/admin/archives', (req, res) => {
    if (!guard(req, res)) return;
    res.send(gate(encodeURIComponent(req.query.key), ''));
  });

  app.post('/admin/archives', (req, res) => {
    if (!guard(req, res)) return;
    const k = encodeURIComponent(req.query.key);
    if (!RESET_PASSWORD()) return res.status(500).send(gate(k, 'No reset password is configured.'));

    // Either a fresh password, or a token from an earlier unlock in this session
    let token = String((req.body || {}).token || '');
    if (!validToken(token)) {
      if (String((req.body || {}).password || '') !== RESET_PASSWORD()) {
        console.error('[admin] archive access with wrong password');
        return res.status(403).send(gate(k, 'Wrong password.'));
      }
      token = issueToken();
    }
    res.send(list(k, token, folders().map((f) => ({ name: f, entries: entriesIn(f) })), SEAT_PRICE,
      String((req.body || {}).msg || '')));
  });

  app.post('/admin/archives/restore', (req, res) => {
    if (!guard(req, res)) return;
    const { token, folder, email } = req.body || {};
    if (!validToken(token)) return res.status(403).json({ ok: false, error: 'Session expired \u2014 please unlock again.' });

    const safeFolder = String(folder || '').replace(/[^a-z0-9.\-]/gi, '');
    const dir = path.join(DATA_DIR, safeFolder);
    if (!safeFolder.startsWith('archive-') || !fs.existsSync(dir)) {
      return res.status(400).json({ ok: false, error: 'Archive not found.' });
    }
    const wanted = String(email || '').trim().toLowerCase();
    if (!wanted) return res.status(400).json({ ok: false, error: 'No entry given.' });

    const liveRegs = path.join(DATA_DIR, 'registrations.jsonl');
    const already = readLines(liveRegs).some((l) => {
      try { return String(JSON.parse(l).email).toLowerCase() === wanted; } catch { return false; }
    });

    let restored = 0;
    let proofFile = '';
    KEYED.forEach((f) => {
      const src = path.join(dir, f);
      if (!fs.existsSync(src)) return;
      const keep = []; const move = [];
      readLines(src).forEach((l) => {
        let e = '';
        try { const o = JSON.parse(l); e = String(o.email || '').toLowerCase(); if (e === wanted && o.proofFile) proofFile = o.proofFile; } catch {}
        (e === wanted ? move : keep).push(l);
      });
      if (!move.length) return;
      // The registration itself is skipped when that email is live again,
      // so a restore can never create a duplicate row in the list.
      if (!(f === 'registrations.jsonl' && already)) {
        fs.appendFileSync(path.join(DATA_DIR, f), move.join('\n') + '\n');
        if (f === 'registrations.jsonl') restored = move.length;
      }
      writeLines(src, keep);
    });

    if (proofFile) {
      const src = path.join(dir, 'proofs', proofFile);
      if (fs.existsSync(src)) {
        fs.mkdirSync(PROOF_DIR, { recursive: true });
        fs.renameSync(src, path.join(PROOF_DIR, proofFile));
      }
    }

    console.log('[admin] restored', wanted, 'from', safeFolder, already ? '(registration already live)' : '');
    res.json({
      ok: true,
      restored,
      note: already ? 'That email is already in the live list \u2014 payment and check-in records were merged back.' : '',
    });
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#111111">
<link rel="apple-touch-icon" href="/img/appicon.png">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

function gate(k, error) {
  return `<!doctype html><html lang="en"><head>${HEAD}<title>Archive</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,system-ui,sans-serif;background:#F7F4EE;color:#111;padding:24px;max-width:520px}
  h2{font-size:20px;margin-bottom:6px}p{color:#444;line-height:1.5;font-size:15px}
  input{width:100%;padding:13px 12px;border:1px solid #d8d2c4;border-radius:9px;font:inherit;font-size:16px;background:#fff;margin-top:14px}
  button{margin-top:16px;background:#111;color:#fff;border:0;border-radius:9px;padding:13px 22px;font:inherit;font-weight:700;cursor:pointer}
  a{color:#555;margin-left:14px}.err{color:#a33;font-weight:600;margin-top:12px}</style></head><body>
  <h2>Archive</h2>
  <p>Everything removed from the registration list is kept here and can be restored.</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <form method="POST" action="/admin/archives?key=${k}">
    <input type="password" name="password" placeholder="Reset password" autocomplete="off" autofocus>
    <div><button type="submit">Open archive</button>
    <a href="/admin?key=${k}">Cancel</a></div>
  </form></body></html>`;
}

function list(k, token, groups, seatPrice, msg) {
  const money = (n) => 'IDR ' + Number(n).toLocaleString('en-US');
  const blocks = groups.map((g) => {
    const when = g.name.replace(/^archive-(selected-)?/, '').slice(0, 16).replace('T', ' ').replace(/-/g, (m, i) => (i > 7 ? ':' : '-'));
    const kind = g.name.includes('selected') ? 'Selected entries' : 'Full clear';
    const rows = g.entries.length ? g.entries.map((r) => `
      <div class="row${r.alreadyLive ? ' live' : ''}">
        <div class="who"><b>${esc(r.name)}</b><span>${esc(r.company || r.email)}</span>
          <span class="sm">${esc(r.email)} &middot; ${esc(r.guests || 1)} seat(s) &middot; ${money((r.guests || 1) * seatPrice)}</span></div>
        <button class="restore" data-folder="${esc(g.name)}" data-email="${esc(r.email)}">
          ${r.alreadyLive ? 'Merge back' : 'Restore'}</button>
      </div>`).join('') : '<p class="none">No registrations in this archive.</p>';
    return `<section><h3>${kind} &middot; <span>${esc(when)}</span></h3>
      <div class="fold">${esc(g.name)}</div>${rows}</section>`;
  }).join('');

  return `<!doctype html><html lang="en"><head>${HEAD}<title>Archive</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,system-ui,sans-serif;background:#F7F4EE;color:#111;padding:18px;max-width:900px;
    padding-bottom:calc(30px + env(safe-area-inset-bottom))}
  h1{font-size:20px;margin:6px 0 4px}
  .lead{color:#555;font-size:14px;margin-bottom:18px}
  section{background:#fff;border:1px solid #e5e0d5;border-radius:14px;padding:18px;margin-bottom:14px}
  h3{font-size:15px}h3 span{font-weight:500;color:#666}
  .fold{font-size:11.5px;color:#aaa;margin:2px 0 12px;word-break:break-all}
  .row{display:flex;align-items:center;gap:14px;padding:12px 0;border-top:1px solid #f0ebe0;flex-wrap:wrap}
  .row.live{opacity:.65}
  .who{flex:1;min-width:180px;display:flex;flex-direction:column;gap:1px;overflow-wrap:anywhere}
  .who span{font-size:13.5px;color:#666}
  .who .sm{font-size:12px;color:#999}
  .restore{background:#F6BB12;border:0;border-radius:8px;padding:11px 16px;font:inherit;
    font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap}
  .restore:disabled{opacity:.5;cursor:default}
  .none{color:#888;font-size:14px}
  .msg{background:#F2FBF3;border:1px solid #bfe3c6;border-radius:10px;padding:12px 16px;
    font-size:14px;margin-bottom:14px}
  a{color:#333}
  .empty{background:#fff;border:1px dashed #d8d2c4;border-radius:14px;padding:40px 20px;text-align:center;color:#666}
  </style></head><body>
  <p><a href="/admin?key=${k}">&larr; Back to registrations</a></p>
  <h1>Archive</h1>
  <p class="lead">Restoring puts a registration back into the live list together with its payment status,
    check-in and payment screenshot. Nothing here is ever deleted automatically.</p>
  <div class="msg" id="msg" style="display:${msg ? 'block' : 'none'}">${esc(msg)}</div>
  ${groups.length ? blocks : '<div class="empty">Nothing archived yet.</div>'}

  <script>
  var TOKEN = '${token}';
  document.addEventListener('click', async function (e) {
    var b = e.target.closest('.restore');
    if (!b) return;
    if (!confirm('Restore ' + b.previousElementSibling.querySelector('b').textContent + ' to the live list?')) return;
    b.disabled = true; b.textContent = 'Restoring\\u2026';
    try {
      var r = await fetch('/admin/archives/restore?key=${k}', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, folder: b.dataset.folder, email: b.dataset.email }),
      });
      var d = await r.json();
      if (!d.ok) { alert(d.error || 'Restore failed.'); b.disabled = false; b.textContent = 'Restore'; return; }
      // Re-open the archive with the same token so the list reflects the change
      var f = document.createElement('form');
      f.method = 'POST'; f.action = '/admin/archives?key=${k}';
      [['token', TOKEN], ['msg', d.note || 'Entry restored to the live list.']].forEach(function (p) {
        var i = document.createElement('input');
        i.type = 'hidden'; i.name = p[0]; i.value = p[1]; f.appendChild(i);
      });
      document.body.appendChild(f); f.submit();
    } catch (ex) {
      alert('Network error \\u2014 nothing was changed.');
      b.disabled = false; b.textContent = 'Restore';
    }
  });
  </script>
  </body></html>`;
}

module.exports = { mount };
