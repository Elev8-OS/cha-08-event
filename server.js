const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'registrations.jsonl');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json());
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
const GHL_WEBHOOK_URL = process.env.GHL_WEBHOOK_URL || '';
const GHL_API_TOKEN = process.env.GHL_API_TOKEN || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const GHL_TAG = process.env.GHL_TAG || 'cha-08-event';
const GHL_SOURCE = process.env.GHL_SOURCE || 'CHA-08 landing page';

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
    const r = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + GHL_API_TOKEN,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName, lastName,
        name: entry.name,
        email: entry.email,
        phone: entry.phone,
        companyName: entry.company || undefined,
        source: GHL_SOURCE,
        tags: [GHL_TAG],
      }),
    });
    if (!r.ok) throw new Error('api HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return 'api';
  }
  return 'disabled';
}

// Append sync outcome so nothing is silently lost
function logSync(email, status, detail) {
  try {
    fs.appendFileSync(path.join(DATA_DIR, 'ghl-sync.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), email, status, detail: detail || '' }) + '\n');
  } catch (e) { console.error('[ghl] log failed', e.message); }
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
  console.log('[rsvp]', entry.email, entry.company);

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
  const tr = rows.map((r) =>
    `<tr><td>${esc(r.ts.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${esc(r.company)}</td><td>${esc(r.role)}</td><td>${esc(r.properties)}</td><td>${esc(r.employees)}</td><td>${esc(r.guests)}</td></tr>`
  ).join('');
  res.send(`<!doctype html><meta charset="utf-8"><title>Registrations (${rows.length})</title>
  <style>body{font-family:system-ui;padding:24px;background:#F7F4EE}h1{font-size:20px}
  table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #ddd;padding:6px 10px;font-size:14px;text-align:left}
  a{display:inline-block;margin-bottom:12px}</style>
  <h1>Registrations: ${rows.length} (${rows.reduce((a, r) => a + (r.guests || 1), 0)} guests)</h1>
  <a href="/admin.csv?key=${encodeURIComponent(req.query.key)}">Download CSV</a>
  <table><tr><th>Time (UTC)</th><th>Name</th><th>Email</th><th>Phone/WA</th><th>Property/Company</th><th>Role</th><th>Properties</th><th>Employees</th><th>Guests</th></tr>${tr}</table>`);
});

app.get('/admin.csv', (req, res) => {
  if (!guard(req, res)) return;
  const rows = readAll();
  const csvEsc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const csv = ['ts,name,email,phone,company,role,properties,employees,guests']
    .concat(rows.map((r) => [r.ts, r.name, r.email, r.phone, r.company, r.role, r.properties, r.employees, r.guests].map(csvEsc).join(',')))
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

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`CHA-08 event page running on :${PORT}`));
