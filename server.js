const express = require('express');
const fs = require('fs');
const path = require('path');
const payment = require('./payment');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'registrations.jsonl');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '9mb' }));
app.use(express.static(path.join(__dirname, 'public')));


// --- Serve images stored as base64 text (single file or numbered chunks) ---
const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg' };
app.get('/img/:name', (req, res) => {
  const name = String(req.params.name).replace(/[^a-z0-9.]/gi, '');
  const ext = name.split('.').pop();
  if (!IMG_TYPES[ext]) return res.status(404).end();
  const dir = path.join(__dirname, 'assets-b64');
  let b64 = null;
  // Prefer chunked files (name.jpg.0.txt, name.jpg.1.txt, ...) when present
  const prefix = name + '.';
  const parts = fs.existsSync(dir)
    ? fs.readdirSync(dir)
        .filter((f) => f.startsWith(prefix) && /\.\d+\.txt$/.test(f))
        .sort((a, b) => parseInt(a.match(/\.(\d+)\.txt$/)[1], 10) - parseInt(b.match(/\.(\d+)\.txt$/)[1], 10))
    : [];
  if (parts.length) {
    b64 = parts.map((p) => fs.readFileSync(path.join(dir, p), 'utf8')).join('');
  } else {
    const single = path.join(dir, name + '.txt');
    if (!fs.existsSync(single)) return res.status(404).end();
    b64 = fs.readFileSync(single, 'utf8');
  }
  const buf = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  res.setHeader('Content-Type', IMG_TYPES[ext]);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(buf);
});


// --- GHL forwarding -------------------------------------------------------
// Configure ONE of these in Railway env vars:
//   A) GHL_WEBHOOK_URL   -> posts the full registration JSON to a GHL inbound webhook
//   B) GHL_API_TOKEN + GHL_LOCATION_ID -> upserts the contact via the GHL API
// Optional: GHL_TAG (default "cha-08-event"), GHL_SOURCE (default "CHA-08 landing page")
// Values still holding the PASTE_... placeholder count as "not configured yet",
// so the site runs normally until the real credentials are filled in.
const real = (v) => {
  const s = String(v || '').trim();
  return (!s || s.startsWith('PASTE_')) ? '' : s;
};
const GHL_WEBHOOK_URL = real(process.env.GHL_WEBHOOK_URL);
const GHL_API_TOKEN = real(process.env.GHL_API_TOKEN);
const GHL_LOCATION_ID = real(process.env.GHL_LOCATION_ID);
const GHL_TAG = process.env.GHL_TAG || 'cha-08-event';
const GHL_SOURCE = process.env.GHL_SOURCE || 'CHA-08 landing page';
const GHL_API_BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const GHL_TAG_PAID = process.env.GHL_TAG_PAID || (GHL_TAG + ' - Paid');

// --- Payment --------------------------------------------------------------
// PAYMENT_REQUIRED=false disables the proof-of-payment step entirely.
// Without a gateway configured, attendees pay by bank transfer and upload a screenshot.
const PAYMENT_REQUIRED = String(process.env.PAYMENT_REQUIRED || 'true').toLowerCase() !== 'false';
const PAYMENT_AMOUNT = process.env.PAYMENT_AMOUNT || 'IDR 50,000';
const PAYMENT_METHOD = process.env.PAYMENT_METHOD || 'bank transfer';
const PROOF_DIR = path.join(DATA_DIR, 'proofs');
fs.mkdirSync(PROOF_DIR, { recursive: true });

const PROOF_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Store a data-URL screenshot on disk; returns the filename or throws.
function saveProof(dataUrl, email) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('invalid image');
  const ext = PROOF_TYPES[m[1].toLowerCase()];
  if (!ext) throw new Error('unsupported image type');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('image too large');
  const safe = email.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
  const file = `${Date.now()}-${safe}.${ext}`;
  fs.writeFileSync(path.join(PROOF_DIR, file), buf);
  return file;
}

// Payment verification status, newest entry wins
function paidSet() {
  const f = path.join(DATA_DIR, 'payments.jsonl');
  const map = new Map();
  if (fs.existsSync(f)) {
    fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).forEach((l) => {
      try { const r = JSON.parse(l); map.set(r.email, r.paid); } catch {}
    });
  }
  return map;
}

function splitName(full) {
  const parts = String(full).trim().split(/\s+/);
  return { firstName: parts.shift() || '', lastName: parts.join(' ') };
}

async function sendToGHL(entry) {
  if (GHL_WEBHOOK_URL) {
    const r = await fetch(GHL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, tag: GHL_TAG, source: GHL_SOURCE, event: 'CHA-08 Smarter Revenue, Better Tech' }),
    });
    if (!r.ok) throw new Error('webhook HTTP ' + r.status);
    return 'webhook';
  }
  if (GHL_API_TOKEN && GHL_LOCATION_ID) {
    const { firstName, lastName } = splitName(entry.name);
    const headers = {
      Authorization: 'Bearer ' + GHL_API_TOKEN,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Step 1: create or update the contact WITHOUT tags.
    // The upsert endpoint replaces the whole tag list, so sending tags here
    // would wipe any tags an existing contact already has.
    const up = await fetch(GHL_API_BASE + '/contacts/upsert', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName, lastName,
        name: entry.name,
        email: entry.email,
        phone: entry.phone,
        companyName: entry.company || undefined,
        source: GHL_SOURCE,
      }),
    });
    if (!up.ok) throw new Error('api upsert HTTP ' + up.status + ' ' + (await up.text()).slice(0, 200));

    const body = await up.json().catch(() => ({}));
    const contactId = body?.contact?.id || body?.id || body?.contact?.contactId;
    if (!contactId) throw new Error('api upsert returned no contact id');

    // Step 2: append our tag - existing tags stay untouched.
    const tg = await fetch(GHL_API_BASE + '/contacts/' + contactId + '/tags', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tags: [GHL_TAG] }),
    });
    if (!tg.ok) throw new Error('api tag HTTP ' + tg.status + ' ' + (await tg.text()).slice(0, 200));

    return 'api';
  }
  return 'disabled';
}

// Add a single tag to a contact (used when payment is verified)
async function addGhlTag(entry, tag) {
  const headers = {
    Authorization: 'Bearer ' + GHL_API_TOKEN,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const up = await fetch(GHL_API_BASE + '/contacts/upsert', {
    method: 'POST', headers,
    body: JSON.stringify({ locationId: GHL_LOCATION_ID, email: entry.email, phone: entry.phone, name: entry.name }),
  });
  if (!up.ok) throw new Error('upsert HTTP ' + up.status);
  const body = await up.json().catch(() => ({}));
  const id = body?.contact?.id || body?.id;
  if (!id) throw new Error('no contact id');
  const tg = await fetch(GHL_API_BASE + '/contacts/' + id + '/tags', {
    method: 'POST', headers, body: JSON.stringify({ tags: [tag] }),
  });
  if (!tg.ok) throw new Error('tag HTTP ' + tg.status);
}

// Append sync outcome so nothing is silently lost
function logSync(email, status, detail) {
  try {
    fs.appendFileSync(path.join(DATA_DIR, 'ghl-sync.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), email, status, detail: detail || '' }) + '\n');
  } catch (e) { console.error('[ghl] log failed', e.message); }
}

// --- Payment gateway (dynamic QRIS) --------------------------------------
// When the gateway is configured, each registration gets its own QRIS with the
// exact amount, and Midtrans confirms payment by webhook - no screenshots.
const SEAT_PRICE = parseInt(process.env.SEAT_PRICE || '50000', 10);

function orderIdFor(email) {
  return 'CHA08-' + Date.now() + '-' + Buffer.from(email).toString('hex').slice(0, 8);
}

// registrations waiting for payment, keyed by orderId
const PENDING_FILE = () => path.join(DATA_DIR, 'pending.jsonl');
function savePending(entry) {
  fs.appendFileSync(PENDING_FILE(), JSON.stringify(entry) + '\n');
}
function findPending(orderId) {
  if (!fs.existsSync(PENDING_FILE())) return null;
  const lines = fs.readFileSync(PENDING_FILE(), 'utf8').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const r = JSON.parse(lines[i]); if (r.orderId === orderId) return r; } catch {}
  }
  return null;
}

// A paid registration becomes a real registration: stored, tagged, marked paid.
function confirmPaid(entry) {
  const already = readAll().some((r) => r.email === entry.email);
  if (!already) {
    fs.appendFileSync(DB_FILE, JSON.stringify(entry) + '\n');
  }
  fs.appendFileSync(path.join(DATA_DIR, 'payments.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), email: entry.email, paid: true, orderId: entry.orderId || '' }) + '\n');
  console.log('[payment] confirmed', entry.email, entry.orderId || '');

  sendToGHL(entry)
    .then(async (mode) => {
      if (mode === 'disabled') return;
      logSync(entry.email, 'sent', mode);
      if (GHL_API_TOKEN && GHL_LOCATION_ID) {
        try { await addGhlTag(entry, GHL_TAG_PAID); } catch (e) { console.error('[ghl] paid tag failed', e.message); }
      }
    })
    .catch((e) => { console.error('[ghl] FAILED', entry.email, e.message); logSync(entry.email, 'failed', e.message); });
}

// --- RSVP endpoint ---
app.post('/api/rsvp', (req, res) => {
  const { name, email, phone, company, role, guests, properties, employees, website } = req.body || {};

  // Honeypot: real users never fill "website"
  if (website) return res.json({ ok: true });

  if (!name || !name.trim() || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please provide your name and a valid email.' });
  }
  if (!phone || String(phone).trim().length < 6) {
    return res.status(400).json({ ok: false, error: 'Please provide your WhatsApp number.' });
  }

  // Gateway path: create a dynamic QRIS and hold the registration until Midtrans confirms
  if (payment.isEnabled()) {
    const seats = Math.min(Math.max(parseInt(guests, 10) || 1, 1), 10);
    const pending = {
      ts: new Date().toISOString(),
      name: String(name).trim().slice(0, 120),
      email: String(email).trim().toLowerCase().slice(0, 160),
      phone: String(phone || '').trim().slice(0, 40),
      company: String(company || '').trim().slice(0, 160),
      role: String(role || '').trim().slice(0, 60),
      guests: seats,
      properties: String(properties || '').slice(0, 20),
      employees: String(employees || '').slice(0, 20),
      orderId: orderIdFor(String(email).trim().toLowerCase()),
      ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
    };
    return payment.createCharge({
      orderId: pending.orderId,
      amount: seats * SEAT_PRICE,
      customer: { name: pending.name, email: pending.email, phone: pending.phone, seats },
    }).then((charge) => {
      savePending(pending);
      console.log('[payment] charge created', pending.orderId, pending.email, seats * SEAT_PRICE);
      res.json({
        ok: true, mode: 'qris', orderId: pending.orderId,
        amount: seats * SEAT_PRICE, qrImageUrl: charge.qrImageUrl, expiresAt: charge.expiresAt,
      });
    }).catch((e) => {
      console.error('[payment] charge failed', e.message);
      res.status(502).json({ ok: false, error: 'We could not start the payment. Please try again or contact us on WhatsApp.' });
    });
  }

  // Fallback path: bank transfer plus a screenshot of the payment
  let proofFile = '';
  if (PAYMENT_REQUIRED) {
    if (!req.body.proof) {
      return res.status(400).json({ ok: false, error: 'Please upload your payment screenshot to complete the registration.' });
    }
    try {
      proofFile = saveProof(req.body.proof, String(email).trim().toLowerCase());
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'We could not read that image (' + e.message + '). Please upload a PNG or JPG screenshot.' });
    }
  }

  const entry = {
    ts: new Date().toISOString(),
    name: String(name).trim().slice(0, 120),
    email: String(email).trim().toLowerCase().slice(0, 160),
    phone: String(phone || '').trim().slice(0, 40),
    company: String(company || '').trim().slice(0, 160),
    role: String(role || '').trim().slice(0, 60),
    guests: Math.min(Math.max(parseInt(guests, 10) || 1, 1), 10),
    properties: String(properties || '').slice(0, 20),
    employees: String(employees || '').slice(0, 20),
    proofFile,
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
  };

  // Basic duplicate guard: same email registered before
  let duplicate = false;
  if (fs.existsSync(DB_FILE)) {
    const lines = fs.readFileSync(DB_FILE, 'utf8').trim().split('\n').filter(Boolean);
    duplicate = lines.some((l) => {
      try { return JSON.parse(l).email === entry.email; } catch { return false; }
    });
  }
  if (duplicate) {
    return res.json({ ok: true, message: 'You are already registered — see you on the 28th!' });
  }

  fs.appendFileSync(DB_FILE, JSON.stringify(entry) + '\n');
  console.log('[rsvp]', entry.email, entry.company, entry.proofFile ? '(proof attached)' : '');

  // Forward to GHL in the background: the visitor never waits on it
  sendToGHL(entry)
    .then((mode) => { if (mode !== 'disabled') { console.log('[ghl] sent via', mode, entry.email); logSync(entry.email, 'sent', mode); } })
    .catch((e) => { console.error('[ghl] FAILED', entry.email, e.message); logSync(entry.email, 'failed', e.message); });

  return res.json({ ok: true });
});

// --- Admin: view + CSV export (protected by ADMIN_KEY env var) ---
function readAll() {
  if (!fs.existsSync(DB_FILE)) return [];
  return fs.readFileSync(DB_FILE, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function guard(req, res) {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    res.status(403).send('Forbidden');
    return false;
  }
  return true;
}

app.get('/admin', (req, res) => {
  if (!guard(req, res)) return;
  const rows = readAll();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const paid = paidSet();
  const k = encodeURIComponent(req.query.key);
  const tr = rows.map((r) => {
    const isPaid = paid.get(r.email) === true;
    const proof = r.proofFile
      ? `<a href="/admin/proof?key=${k}&file=${encodeURIComponent(r.proofFile)}" target="_blank">view</a>`
      : (r.orderId ? '<span style="color:#999">auto</span>' : '<span style="color:#999">none</span>');
    const action = isPaid
      ? '<span style="color:#137333;font-weight:600">PAID</span>'
      : `<a href="/admin/verify?key=${k}&email=${encodeURIComponent(r.email)}">mark paid</a>`;
    return `<tr${isPaid ? ' style="background:#f2fbf3"' : ''}><td>${esc(r.ts.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${esc(r.company)}</td><td>${esc(r.role)}</td><td>${esc(r.properties)}</td><td>${esc(r.employees)}</td><td>${esc(r.guests)}</td><td>${proof}</td><td>${action}</td></tr>`;
  }).join('');
  res.send(`<!doctype html><meta charset="utf-8"><title>Registrations (${rows.length})</title>
  <style>body{font-family:system-ui;padding:24px;background:#F7F4EE}h1{font-size:20px}
  table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #ddd;padding:6px 10px;font-size:14px;text-align:left}
  a{display:inline-block;margin-bottom:12px}</style>
  <h1>Registrations: ${rows.length} (${rows.reduce((a, r) => a + (r.guests || 1), 0)} guests) &middot; paid: ${rows.filter((r) => paid.get(r.email) === true).length}</h1>
  <a href="/admin.csv?key=${encodeURIComponent(req.query.key)}">Download CSV</a>
  <table><tr><th>Time (UTC)</th><th>Name</th><th>Email</th><th>Phone/WA</th><th>Property/Company</th><th>Role</th><th>Properties</th><th>Employees</th><th>Guests</th><th>Proof</th><th>Payment</th></tr>${tr}</table>`);
});

app.get('/admin.csv', (req, res) => {
  if (!guard(req, res)) return;
  const rows = readAll();
  const csvEsc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const paid = paidSet();
  const csv = ['ts,name,email,phone,company,role,properties,employees,guests,paid,proof_file,order_id']
    .concat(rows.map((r) => [r.ts, r.name, r.email, r.phone, r.company, r.role, r.properties, r.employees, r.guests,
      paid.get(r.email) === true ? 'yes' : 'no', r.proofFile || '', r.orderId || ''].map(csvEsc).join(',')))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="registrations.csv"');
  res.send(csv);
});


// Retry any registrations that failed to reach GHL
app.get('/admin/resync', async (req, res) => {
  if (!guard(req, res)) return;
  const syncFile = path.join(DATA_DIR, 'ghl-sync.jsonl');
  const status = new Map();
  if (fs.existsSync(syncFile)) {
    fs.readFileSync(syncFile, 'utf8').trim().split('\n').filter(Boolean).forEach((l) => {
      try { const r = JSON.parse(l); status.set(r.email, r.status); } catch {}
    });
  }
  const pending = readAll().filter((r) => status.get(r.email) !== 'sent');
  let sent = 0; const errors = [];
  for (const entry of pending) {
    try { const mode = await sendToGHL(entry); if (mode !== 'disabled') { logSync(entry.email, 'sent', mode); sent++; } }
    catch (e) { logSync(entry.email, 'failed', e.message); errors.push(entry.email + ': ' + e.message); }
  }
  res.json({ pending: pending.length, sent, errors });
});

// Midtrans calls this when a payment settles. Public endpoint - every payload
// is signature-checked inside payment.readNotification.
app.post('/api/payment/webhook', (req, res) => {
  let note;
  try {
    note = payment.readNotification(req.body);
  } catch (e) {
    console.error('[payment] rejected notification:', e.message);
    return res.status(403).json({ ok: false });
  }
  console.log('[payment] webhook', note.orderId, note.raw, '->', note.status);
  if (note.status === 'paid') {
    const pending = findPending(note.orderId);
    if (pending) confirmPaid(pending);
    else console.error('[payment] no pending registration for', note.orderId);
  }
  res.json({ ok: true });
});

// The browser polls this while the QR is on screen
app.get('/api/payment/status', async (req, res) => {
  const orderId = String(req.query.order || '');
  if (!orderId) return res.status(400).json({ ok: false });
  const pending = findPending(orderId);
  const email = pending ? pending.email : '';
  if (email && paidSet().get(email) === true) return res.json({ ok: true, status: 'paid' });

  // Webhook may be delayed or blocked: ask Midtrans directly
  try {
    const st = await payment.checkStatus(orderId);
    if (st.status === 'paid' && pending) confirmPaid(pending);
    return res.json({ ok: true, status: st.status });
  } catch (e) {
    return res.json({ ok: true, status: 'pending' });
  }
});

// Serve a payment screenshot (admin only - these contain personal data)
app.get('/admin/proof', (req, res) => {
  if (!guard(req, res)) return;
  const file = String(req.query.file || '').replace(/[^a-z0-9._-]/gi, '');
  const full = path.join(PROOF_DIR, file);
  if (!file || !fs.existsSync(full)) return res.status(404).send('Not found');
  const ext = file.split('.').pop().toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(fs.readFileSync(full));
});

// Mark a registration as paid; also tags the contact in GHL
app.get('/admin/verify', async (req, res) => {
  if (!guard(req, res)) return;
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).send('email required');
  fs.appendFileSync(path.join(DATA_DIR, 'payments.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), email, paid: true }) + '\n');

  const entry = readAll().find((r) => r.email === email);
  if (entry && GHL_API_TOKEN && GHL_LOCATION_ID) {
    try { await addGhlTag(entry, GHL_TAG_PAID); } catch (e) { console.error('[ghl] paid tag failed', e.message); }
  }
  res.redirect('/admin?key=' + encodeURIComponent(req.query.key));
});

app.get('/health', (_req, res) => res.json({
  ok: true,
  ghl: GHL_WEBHOOK_URL ? 'webhook' : (GHL_API_TOKEN && GHL_LOCATION_ID ? 'api' : 'not configured'),
  tag: GHL_TAG,
  payment: payment.isEnabled() ? payment.mode() + ' (automatic QRIS)' : (PAYMENT_REQUIRED ? PAYMENT_AMOUNT + ' via ' + PAYMENT_METHOD + ' (proof required)' : 'disabled'),
  seatPrice: SEAT_PRICE,
}));

app.listen(PORT, () => {
  const mode = GHL_WEBHOOK_URL ? 'webhook' : (GHL_API_TOKEN && GHL_LOCATION_ID ? 'api' : 'NOT CONFIGURED (still placeholders)');
  console.log(`CHA-08 event page running on :${PORT}`);
  console.log(`[ghl] mode: ${mode} | tag: "${GHL_TAG}"`);
  console.log(`[payment] ${payment.isEnabled()
    ? payment.mode() + ' - automatic QRIS, IDR ' + SEAT_PRICE + ' per seat'
    : (PAYMENT_REQUIRED ? PAYMENT_AMOUNT + ' via ' + PAYMENT_METHOD + ', screenshot required' : 'disabled')}`);
});
