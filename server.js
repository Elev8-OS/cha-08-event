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


// --- Serve images stored as base64 text (keeps repo text-only) ---
const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg' };
app.get('/img/:name', (req, res) => {
  const name = String(req.params.name).replace(/[^a-z0-9.]/gi, '');
  const file = path.join(__dirname, 'assets-b64', name + '.txt');
  const ext = name.split('.').pop();
  if (!IMG_TYPES[ext] || !fs.existsSync(file)) return res.status(404).end();
  const buf = Buffer.from(fs.readFileSync(file, 'utf8'), 'base64');
  res.setHeader('Content-Type', IMG_TYPES[ext]);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buf);
});

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

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`CHA-08 event page running on :${PORT}`));
