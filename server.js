const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const payment = require('./payment');
const checkin = require('./checkin');
const archive = require('./archive');
const slides = require('./slides');
const badges = require('./badges');
const feedback = require('./feedback');
const screen = require('./screen');
const version = require('./version');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'registrations.jsonl');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '9mb' }));
app.use(express.urlencoded({ extended: false }));

// --- Lightweight, privacy-preserving page analytics ---------------------
// One line per view. Visitors are identified by a hash of IP + user agent
// mixed with the date and a server-side salt, so no IP is ever stored and a
// hash cannot be traced back or linked across days.
const VIEWS_FILE = () => path.join(DATA_DIR, 'views.jsonl');
// Salt kept on disk so restarts don't reset visitor counts.
const SALT_FILE = path.join(DATA_DIR, '.salt');
let SALT;
try {
  SALT = fs.existsSync(SALT_FILE) ? fs.readFileSync(SALT_FILE, 'utf8').trim() : '';
  if (!SALT) { SALT = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(SALT_FILE, SALT); }
} catch { SALT = crypto.randomBytes(16).toString('hex'); }

function visitorHash(req, day) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return crypto.createHash('sha256')
    .update(day + SALT + ip + (req.headers['user-agent'] || ''))
    .digest('hex').slice(0, 16);
}

function refHost(req) {
  const r = req.headers.referer || req.headers.referrer || '';
  if (!r) return 'direct';
  try {
    const h = new URL(r).hostname.replace(/^www\./, '');
    return h.endsWith('elev8-suite.com') ? 'direct' : h;
  } catch { return 'other'; }
}

// Bots inflate the numbers and tell us nothing about real interest
const BOT = /bot|crawler|spider|crawling|preview|facebookexternalhit|slurp|bingpreview|headless|monitor|uptime/i;

app.get('/', (req, res, next) => {
  try {
    if (!BOT.test(req.headers['user-agent'] || '')) {
      const day = new Date().toISOString().slice(0, 10);
      fs.appendFileSync(VIEWS_FILE(), JSON.stringify({
        d: day,
        t: new Date().toISOString().slice(11, 16),
        v: visitorHash(req, day),
        r: refHost(req),
        m: /mobile|android|iphone|ipad/i.test(req.headers['user-agent'] || '') ? 'mobile' : 'desktop',
      }) + '\n');
    }
  } catch (e) { /* never let analytics break the page */ }
  next();
});

// Never let a browser hold on to a stale page: content changes right up to the event
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));


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
const GHL_TAG_ATTENDED = process.env.GHL_TAG_ATTENDED || (GHL_TAG + ' - Attended');
const GHL_TAG_WAITLIST = process.env.GHL_TAG_WAITLIST || (GHL_TAG + ' - Waitlist');
const GHL_TAG_WALKIN = process.env.GHL_TAG_WALKIN || (GHL_TAG + ' - Walk-in');
const GHL_TAG_COMP = process.env.GHL_TAG_COMP || (GHL_TAG + ' - Complimentary');
// Custom field ids in GHL. Values must match the picklists configured there.
const GHL_CF_PROPERTIES = process.env.GHL_CF_PROPERTIES || 'igDIndbcECJUpM96Kk7V'; // Number of Properties
const GHL_CF_PMS = process.env.GHL_CF_PMS || '3Z3qAyZ0luOBmHeQh2AD';               // Current PMS / Software
const GHL_CF_PAIN = process.env.GHL_CF_PAIN || 'K2mUif9zM7glvUu64oI9';             // Primary Pain Point
// GHL user id the registration is assigned to, so replies land with the right person
const GHL_ASSIGNED_USER = real(process.env.GHL_ASSIGNED_USER);

// Second factor for clearing data. Without it, the reset is unavailable.
const RESET_PASSWORD = real(process.env.RESET_PASSWORD);

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

// Invited guests - our own team, partners, speakers. They register like anyone
// else so they appear in the head count and receive the whole email flow, but
// they owe nothing: no amount due, and no misleading "unpaid" at the door.
function compSet() {
  const f = path.join(DATA_DIR, 'payments.jsonl');
  const map = new Map();
  if (fs.existsSync(f)) {
    fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).forEach((l) => {
      try { const r = JSON.parse(l); if ('comp' in r) map.set(r.email, r.comp); } catch {}
    });
  }
  return new Set([...map.entries()].filter(([, v]) => v).map(([e]) => e));
}

// Only send fields that actually carry a value - GHL rejects empty picklist values
function ghlCustomFields(entry) {
  const out = [];
  if (entry.properties) out.push({ id: GHL_CF_PROPERTIES, key: 'number_of_properties', fieldValue: entry.properties });
  if (entry.pms) out.push({ id: GHL_CF_PMS, key: 'current_pms__software', fieldValue: entry.pms });
  if (entry.pain) out.push({ id: GHL_CF_PAIN, key: 'primary_pain_point', fieldValue: entry.pain });
  return out;
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
        assignedTo: GHL_ASSIGNED_USER || undefined,
        customFields: ghlCustomFields(entry),
      }),
    });

    // If GHL rejects a picklist value (e.g. a PMS option not yet added there),
    // retry without custom fields rather than losing the registration entirely.
    let response = up;
    if (!up.ok) {
      const detail = (await up.text()).slice(0, 200);
      console.error('[ghl] upsert with custom fields failed, retrying plain:', detail);
      response = await fetch(GHL_API_BASE + '/contacts/upsert', {
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
          assignedTo: GHL_ASSIGNED_USER || undefined,
        }),
      });
      if (!response.ok) throw new Error('api upsert HTTP ' + response.status + ' ' + detail);
    }

    const body = await response.json().catch(() => ({}));
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

// Add a single tag to a contact (used when payment is verified, or at check-in)
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
// Hard capacity of the venue. Once it is reached, further sign-ups go to a
// waitlist instead of being turned away - the interest is worth capturing.
const SEAT_CAP = parseInt(process.env.SEAT_CAP || '70', 10);
const WAITLIST_FILE = () => path.join(DATA_DIR, 'waitlist.jsonl');

function seatsBooked() {
  return readAll().reduce((a, r) => a + (parseInt(r.guests, 10) || 1), 0);
}
function seatsLeft() {
  return Math.max(0, SEAT_CAP - seatsBooked());
}

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

// The landing page asks for this on load, so visitors see honest availability
app.get('/api/seats', (_req, res) => {
  const left = seatsLeft();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ cap: SEAT_CAP, left, full: left <= 0 });
});

// --- RSVP endpoint ---
app.post('/api/rsvp', (req, res) => {
  const { name, email, phone, company, role, guests, properties, employees, pms, pain, website } = req.body || {};

  // Honeypot: real users never fill "website"
  if (website) return res.json({ ok: true });

  if (!name || !name.trim() || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please provide your name and a valid email.' });
  }
  if (!phone || String(phone).trim().length < 6) {
    return res.status(400).json({ ok: false, error: 'Please provide your WhatsApp number.' });
  }

  const wantSeats = Math.min(Math.max(parseInt(guests, 10) || 1, 1), 10);

  // No room left: record the interest rather than losing it. Nothing is charged.
  if (wantSeats > seatsLeft()) {
    const wl = {
      ts: new Date().toISOString(),
      name: String(name).trim().slice(0, 120),
      email: String(email).trim().toLowerCase().slice(0, 160),
      phone: String(phone || '').trim().slice(0, 40),
      company: String(company || '').trim().slice(0, 160),
      role: String(role || '').trim().slice(0, 60),
      guests: wantSeats,
      properties: String(properties || '').slice(0, 20),
      employees: String(employees || '').slice(0, 20),
      pms: String(pms || '').slice(0, 40),
      pain: String(pain || '').slice(0, 60),
    };
    const dupe = fs.existsSync(WAITLIST_FILE())
      && fs.readFileSync(WAITLIST_FILE(), 'utf8').includes('"' + wl.email + '"');
    if (!dupe) {
      fs.appendFileSync(WAITLIST_FILE(), JSON.stringify(wl) + '\n');
      sendToGHL(wl)
        .then(async (mode) => {
          if (mode === 'disabled') return;
          if (GHL_API_TOKEN && GHL_LOCATION_ID) {
            try { await addGhlTag(wl, GHL_TAG_WAITLIST); } catch (e) { console.error('[ghl] waitlist tag failed', e.message); }
          }
        })
        .catch((e) => console.error('[ghl] waitlist sync failed', e.message));
    }
    console.log('[waitlist]', wl.email, wl.guests, 'seat(s) |', seatsLeft(), 'left of', SEAT_CAP);
    return res.json({ ok: true, mode: 'waitlist' });
  }

  // Gateway path: create a dynamic QRIS and hold the registration until Midtrans confirms
  if (payment.isEnabled()) {
    const seats = wantSeats;
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
      pms: String(pms || '').slice(0, 40),
      pain: String(pain || '').slice(0, 60),
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
    guests: wantSeats,
    properties: String(properties || '').slice(0, 20),
    employees: String(employees || '').slice(0, 20),
    pms: String(pms || '').slice(0, 40),
    pain: String(pain || '').slice(0, 60),
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
    return res.json({ ok: true, message: 'You are already registered \u2014 see you on the 28th!' });
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

// Card layout rather than a wide table: this is opened on a phone as often as
// on a laptop, and a 14-column table is unusable on a 390px screen.
app.get('/admin', (req, res) => {
  if (!guard(req, res)) return;
  const rows = readAll();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const paid = paidSet();
  const k = encodeURIComponent(req.query.key);
  const money = (n) => 'IDR ' + Number(n).toLocaleString('en-US');

  const comps = compSet();
  const cards = rows.map((r) => {
    const isComp = comps.has(r.email);
    const isPaid = paid.get(r.email) === true;
    const due = isComp ? 0 : (r.guests || 1) * SEAT_PRICE;
    const proof = r.proofFile
      ? `<a class="lnk" href="/admin/proof?key=${k}&file=${encodeURIComponent(r.proofFile)}" target="_blank">View proof</a>`
      : '';
    const action = isComp
      ? `<span class="tag comp">GUEST</span>
         <a class="lnk small" href="/admin/comp?key=${k}&off=1&email=${encodeURIComponent(r.email)}">undo</a>`
      : (isPaid
        ? `<span class="tag paid">PAID</span>
           <a class="lnk small" href="/admin/comp?key=${k}&email=${encodeURIComponent(r.email)}">guest</a>`
        : `<a class="lnk mark" href="/admin/verify?key=${k}&email=${encodeURIComponent(r.email)}">Mark paid</a>
           <a class="lnk small" href="/admin/comp?key=${k}&email=${encodeURIComponent(r.email)}">guest</a>`);
    const details = [r.role, r.properties ? r.properties + ' properties' : '', r.employees ? r.employees + ' staff' : '',
      r.pms, r.pain].filter(Boolean).map((x) => `<span class="chip">${esc(x)}</span>`).join('');
    return `<article class="card${isComp ? ' guest' : (isPaid ? ' ok' : '')}" data-email="${esc(r.email)}">
      <header><label class="pick"><input type="checkbox" class="sel" value="${esc(r.email)}"></label>
        <h3>${esc(r.name)}</h3><span class="amt${isComp ? ' free' : ''}">${
          isComp ? 'Complimentary' : money(due)}</span></header>
      <p class="co">${esc(r.company || '\u2014')}${r.walkin ? ' <span class="chip wi">walk-in</span>' : ''}</p>
      <p class="ct"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a><br>
        <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></p>
      <div class="chips"><span class="chip seats">${esc(r.guests)} seat${r.guests > 1 ? 's' : ''}</span>${details}</div>
      <footer><span class="ts">${esc(r.ts.slice(0, 16).replace('T', ' '))} UTC</span>
        <span class="acts">${proof}${action}</span></footer>
    </article>`;
  }).join('');

  // Seats throughout, not a mix of seats and registrations: a complimentary
  // booking of two seats used to show up as "1 complimentary".
  const seatsOf = (r) => parseInt(r.guests, 10) || 1;
  const seats = rows.reduce((a, r) => a + seatsOf(r), 0);
  const compSeats = rows.filter((r) => comps.has(r.email)).reduce((a, r) => a + seatsOf(r), 0);
  const paidSeats = rows.filter((r) => paid.get(r.email) === true && !comps.has(r.email))
    .reduce((a, r) => a + seatsOf(r), 0);
  const unpaidSeats = seats - compSeats - paidSeats;
  // Only seats that are actually owed count as revenue
  const revenue = rows.filter((r) => !comps.has(r.email)).reduce((a, r) => a + seatsOf(r) * SEAT_PRICE, 0);

  const waitlist = fs.existsSync(WAITLIST_FILE())
    ? fs.readFileSync(WAITLIST_FILE(), 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const wlRows = waitlist.map((w) => `<div class="wl">
      <div><b>${esc(w.name)}</b> <span>${esc(w.company || '')}</span><br>
        <a href="mailto:${esc(w.email)}">${esc(w.email)}</a> &middot;
        <a href="tel:${esc(w.phone)}">${esc(w.phone)}</a></div>
      <span class="chip">${esc(w.guests)} seat${w.guests > 1 ? 's' : ''}</span>
    </div>`).join('');

  res.send(`<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><title>Registrations (${rows.length})</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111111">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black">
  <meta name="apple-mobile-web-app-title" content="CHA-08 Admin">
  <link rel="apple-touch-icon" href="/img/appicon.png">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
  :root{--cream:#F7F4EE;--gold:#F6BB12;--grey:#666}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,system-ui,sans-serif;background:var(--cream);color:#111;padding:18px;
    padding-bottom:calc(110px + env(safe-area-inset-bottom))}
  h1{font-size:19px;line-height:1.35}
  h1 small{display:block;font-size:13.5px;color:var(--grey);font-weight:500;margin-top:3px;line-height:1.5}
  h1 .ver{font-size:11.5px;font-weight:600;letter-spacing:.5px;color:var(--grey);
    background:#EFEAE0;border-radius:20px;padding:3px 9px;text-decoration:none;vertical-align:middle}
  .bar{display:flex;gap:10px 18px;margin:16px 0 20px;flex-wrap:wrap;align-items:flex-end}
  .grp{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .lbl{flex-basis:100%;font-size:10.5px;font-weight:700;letter-spacing:1.2px;
    text-transform:uppercase;color:#a09884;margin-bottom:-2px}
  .btn{text-align:center;padding:11px 14px;border-radius:9px;font-size:14px;
    font-weight:600;text-decoration:none;white-space:nowrap}
  .btn.primary{background:#111;color:#fff}
  .btn.ghost{background:#fff;color:#333;border:1px solid #ddd}
  .btn.danger{background:#fff;color:#a33;border:1px solid #e3bcbc}
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
  .card{background:#fff;border:1px solid #e5e0d5;border-radius:14px;padding:16px 18px}
  .card.ok{background:#F7FCF8;border-color:#cfe8d4}
  .card.guest{background:#F7F9FD;border-color:#cfd9e8}
  .amt.free{color:#2c5282;font-size:13.5px}
  .tag.comp{color:#2c5282;font-weight:700;font-size:13px;letter-spacing:.5px}
  .lnk.small{font-size:12.5px;padding:6px 9px;color:#666}
  .card header{display:flex;align-items:center;gap:10px}
  .pick{display:flex;align-items:center;cursor:pointer;padding:2px}
  .pick input{width:20px;height:20px;accent-color:#111;cursor:pointer}
  .card.picked{outline:2px solid #111;outline-offset:-2px}
  .selbar{position:fixed;left:0;right:0;bottom:0;background:#111;color:#fff;
    padding:14px 18px calc(14px + env(safe-area-inset-bottom));display:none;gap:12px;
    align-items:center;flex-wrap:wrap;z-index:30;box-shadow:0 -4px 20px rgba(0,0,0,.2)}
  .selbar.on{display:flex}
  .selbar .n{font-weight:700;font-size:15px}
  .selbar input[type=password]{flex:1 1 160px;min-width:130px;padding:11px 12px;border:0;
    border-radius:8px;font-size:16px;font-family:inherit}
  .selbar button{border:0;border-radius:8px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer}
  .selbar .go{background:#F6BB12;color:#111}
  .selbar .cancel{background:transparent;color:#bbb;padding:12px 6px}
  .selbar .msg{flex-basis:100%;font-size:13px;color:#F6BB12}
  .card h3{font-size:17px;flex:1;min-width:0;overflow-wrap:anywhere}
  .amt{font-weight:700;font-size:15px;white-space:nowrap}
  .co{color:var(--grey);font-size:14px;margin-top:2px;overflow-wrap:anywhere}
  .ct{font-size:14px;margin-top:8px;line-height:1.6;overflow-wrap:anywhere}
  .ct a{color:#111}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .chip{background:#F2EEE5;border-radius:20px;padding:4px 10px;font-size:12px;font-weight:600}
  .chip.seats{background:#111;color:#fff}
  .chip.wi{background:#E8F0FB;color:#2c5282}
  .card footer{display:flex;align-items:center;gap:12px;margin-top:12px;padding-top:10px;
    border-top:1px solid #eee7db;flex-wrap:wrap}
  .ts{font-size:12px;color:#999}
  .acts{margin-left:auto;display:flex;gap:10px;align-items:center}
  .lnk{font-size:14px;font-weight:600;color:#111;text-decoration:none;padding:8px 12px;
    border:1px solid #ddd;border-radius:8px;background:#fff}
  .lnk.mark{background:var(--gold);border-color:var(--gold)}
  .tag.paid{color:#137333;font-weight:700;font-size:13px;letter-spacing:.5px}
  .empty{background:#fff;border:1px dashed #d8d2c4;border-radius:14px;padding:40px 20px;
    text-align:center;color:var(--grey)}
  .cap{background:#e5e0d5;border-radius:4px;height:7px;margin-top:10px;overflow:hidden}
  .capfill{background:var(--gold);height:100%}
  .wlh{font-size:16px;margin:26px 0 10px}
  .wl{background:#fff;border:1px solid #e5e0d5;border-radius:12px;padding:14px 16px;margin-bottom:8px;
    display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:14px}
  .wl div{flex:1;min-width:200px;overflow-wrap:anywhere}
  .wl span{color:var(--grey)}
  .wl a{color:#111}
  @media(max-width:600px){body{padding:14px;padding-bottom:calc(120px + env(safe-area-inset-bottom))}
    .bar{gap:14px}.grp{gap:6px}.btn{flex:1 1 46%;padding:11px 10px}}
  </style></head><body>
  <h1>Registrations: ${rows.length} <a class="ver" href="/admin/changelog?key=${k}">v${version.VERSION}</a>
    <small>${seats} of ${SEAT_CAP} seats &middot; ${paidSeats} paid${
      unpaidSeats ? ' &middot; ' + unpaidSeats + ' unpaid' : ''}${
      compSeats ? ' &middot; ' + compSeats + ' complimentary' : ''}<br>
      ${money(revenue)} expected${
      waitlist.length ? ' &middot; ' + waitlist.length + ' on the waitlist' : ''}</small></h1>
  <div class="cap"><div class="capfill" style="width:${Math.min(100, Math.round((seats / SEAT_CAP) * 100))}%"></div></div>
  <nav class="bar">
    <div class="grp">
      <span class="lbl">On the day</span>
      <a class="btn primary" href="/checkin?key=${k}">Check-in desk</a>
      <a class="btn ghost" href="/admin/questions?key=${k}">Questions</a>
      <a class="btn ghost" href="/admin/badges?key=${k}">Badges</a>
      <a class="btn ghost" href="/guides.html" target="_blank">Desk guide</a>
    </div>
    <div class="grp">
      <span class="lbl">On the screen</span>
      <a class="btn ghost" href="/screen/register" target="_blank">Register QR</a>
      <a class="btn ghost" href="/screen/ask" target="_blank">Questions QR</a>
      <a class="btn ghost" href="/screen" target="_blank">Feedback QR</a>
    </div>
    <div class="grp">
      <span class="lbl">Afterwards</span>
      <a class="btn ghost" href="/admin/decks?key=${k}">Slide decks</a>
      <a class="btn ghost" href="/admin/feedback?key=${k}">Feedback</a>
      <a class="btn ghost" href="/admin/stats?key=${k}">Visitor stats</a>
      <a class="btn ghost" href="/admin.csv?key=${k}">CSV</a>
      <a class="btn ghost" href="/admin/resync?key=${k}">Resync</a>
    </div>
    <div class="grp">
      <span class="lbl">Data</span>
      <a class="btn ghost" href="/admin/archives?key=${k}">Archive</a>
      <a class="btn danger" href="/admin/reset?key=${k}">Clear\u2026</a>
    </div>
  </nav>
  ${rows.length ? `<div class="grid">${cards}</div>` : '<div class="empty">No registrations yet.</div>'}
  ${waitlist.length ? `<h2 class="wlh">Waitlist (${waitlist.length})</h2>${wlRows}` : ''}

  <div class="selbar" id="selbar">
    <span class="n" id="selcount">0 selected</span>
    <input type="password" id="selpw" placeholder="Reset password" autocomplete="off">
    <button class="go" id="selgo">Archive</button>
    <button class="cancel" id="selcancel">Cancel</button>
    <span class="msg" id="selmsg"></span>
  </div>

  <script>
  var bar = document.getElementById('selbar');
  function picked() {
    return [].slice.call(document.querySelectorAll('.sel:checked')).map(function (c) { return c.value; });
  }
  function sync() {
    var n = picked().length;
    document.getElementById('selcount').textContent = n + ' selected';
    bar.classList.toggle('on', n > 0);
    document.getElementById('selmsg').textContent = '';
    [].forEach.call(document.querySelectorAll('.card'), function (c) {
      c.classList.toggle('picked', c.querySelector('.sel').checked);
    });
  }
  document.addEventListener('change', function (e) { if (e.target.classList.contains('sel')) sync(); });
  document.getElementById('selcancel').addEventListener('click', function () {
    [].forEach.call(document.querySelectorAll('.sel'), function (c) { c.checked = false; });
    sync();
  });
  document.getElementById('selgo').addEventListener('click', async function () {
    var emails = picked(), pw = document.getElementById('selpw').value;
    var msg = document.getElementById('selmsg');
    if (!emails.length) return;
    if (!pw) { msg.textContent = 'Enter the reset password.'; return; }
    if (!confirm('Archive ' + emails.length + ' registration(s)? They are moved to an archive folder, not deleted.')) return;
    this.disabled = true; msg.textContent = 'Archiving\\u2026';
    try {
      var r = await fetch('/admin/archive?key=${k}', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw, emails: emails }),
      });
      var d = await r.json();
      if (d.ok) { location.reload(); return; }
      msg.textContent = d.error || 'Failed.';
    } catch (e) { msg.textContent = 'Network error \\u2014 nothing was changed.'; }
    this.disabled = false;
  });
  </script>
  </body></html>`);
});

app.get('/admin.csv', (req, res) => {
  if (!guard(req, res)) return;
  const csvEsc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const paid = paidSet();
  const comps = compSet();
  const csv = ['ts,name,email,phone,company,role,properties,employees,pms,pain_point,seats,amount_idr,paid,complimentary,walkin,proof_file,order_id']
    .concat(readAll().map((r) => [r.ts, r.name, r.email, r.phone, r.company, r.role, r.properties, r.employees, r.pms, r.pain, r.guests,
      comps.has(r.email) ? 0 : (r.guests || 1) * SEAT_PRICE,
      paid.get(r.email) === true ? 'yes' : 'no', comps.has(r.email) ? 'yes' : 'no', r.walkin ? 'yes' : 'no',
      r.proofFile || '', r.orderId || ''].map(csvEsc).join(',')))
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
  const k = encodeURIComponent(req.query.key);
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Resync</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:system-ui;padding:24px;background:#F7F4EE;max-width:640px}
  li{font-size:14px;color:#a33}</style></head><body>
  <h2>GHL resync</h2>
  <p>${pending.length} registration(s) were not marked as sent. ${sent} synced now.</p>
  ${errors.length ? '<ul>' + errors.map((e) => `<li>${String(e).replace(/[<>&]/g, '')}</li>`).join('') + '</ul>' : ''}
  <p><a href="/admin?key=${k}">\u2190 Back to registrations</a></p></body></html>`);
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

// Visitor statistics, aggregated on the fly from views.jsonl
app.get('/admin/stats', (req, res) => {
  if (!guard(req, res)) return;
  const k = encodeURIComponent(req.query.key);
  const views = [];
  if (fs.existsSync(VIEWS_FILE())) {
    fs.readFileSync(VIEWS_FILE(), 'utf8').trim().split('\n').filter(Boolean).forEach((l) => {
      try { views.push(JSON.parse(l)); } catch {}
    });
  }
  const regs = readAll();

  const byDay = new Map();
  const refs = new Map();
  let mobile = 0;
  views.forEach((v) => {
    if (!byDay.has(v.d)) byDay.set(v.d, { views: 0, visitors: new Set() });
    const d = byDay.get(v.d);
    d.views++; d.visitors.add(v.v);
    refs.set(v.r, (refs.get(v.r) || 0) + 1);
    if (v.m === 'mobile') mobile++;
  });
  regs.forEach((r) => {
    const day = String(r.ts).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { views: 0, visitors: new Set() });
    byDay.get(day).regs = (byDay.get(day).regs || 0) + 1;
  });

  const days = [...byDay.keys()].sort().reverse();
  const totalViews = views.length;
  const totalVisitors = new Set(views.map((v) => v.v)).size;
  const conv = totalVisitors ? ((regs.length / totalVisitors) * 100).toFixed(1) : '0.0';
  const maxViews = Math.max(1, ...days.map((d) => byDay.get(d).views));

  const rows = days.map((d) => {
    const x = byDay.get(d);
    const bar = Math.round((x.views / maxViews) * 100);
    return `<tr><td>${d}</td><td>${x.views}</td><td>${x.visitors.size}</td><td>${x.regs || 0}</td>
      <td style="width:40%"><div style="background:#F6BB12;height:14px;border-radius:3px;width:${bar}%"></div></td></tr>`;
  }).join('');

  const refRows = [...refs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([r, n]) => `<tr><td>${String(r).replace(/[<>&]/g, '')}</td><td>${n}</td></tr>`).join('');

  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Visitor stats</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111111">
  <link rel="apple-touch-icon" href="/img/appicon.png">
  <style>body{font-family:system-ui;padding:18px;background:#F7F4EE;max-width:1000px;
    padding-bottom:calc(18px + env(safe-area-inset-bottom))}
  h1{font-size:20px}h2{font-size:15px;margin:24px 0 6px}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{border-collapse:collapse;width:100%;min-width:460px;background:#fff;margin-top:6px}
  td,th{border:1px solid #ddd;padding:8px 10px;font-size:14px;text-align:left;white-space:nowrap}
  .cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin:14px 0}
  .card{background:#fff;border:1px solid #e5e0d5;border-radius:10px;padding:14px 16px}
  .card .n{font-size:24px;font-weight:700}
  .card .l{font-size:11.5px;color:#666;text-transform:uppercase;letter-spacing:1px}
  a{color:#333}</style></head><body>
  <p><a href="/admin?key=${k}">\u2190 Back to registrations</a></p>
  <h1>Visitor statistics</h1>
  <div class="cards">
    <div class="card"><div class="n">${totalViews}</div><div class="l">Page views</div></div>
    <div class="card"><div class="n">${totalVisitors}</div><div class="l">Visitors</div></div>
    <div class="card"><div class="n">${regs.length}</div><div class="l">Registrations</div></div>
    <div class="card"><div class="n">${conv}%</div><div class="l">Conversion</div></div>
    <div class="card"><div class="n">${totalViews ? Math.round((mobile / totalViews) * 100) : 0}%</div><div class="l">On mobile</div></div>
  </div>
  <h2>By day</h2>
  <div class="scroll"><table><tr><th>Day</th><th>Views</th><th>Visitors</th><th>Registrations</th><th></th></tr>${rows || '<tr><td colspan="5">No visits recorded yet.</td></tr>'}</table></div>
  <h2>Where visitors came from</h2>
  <div class="scroll"><table><tr><th>Source</th><th>Views</th></tr>${refRows || '<tr><td colspan="2">\u2014</td></tr>'}</table></div>
  <p style="margin-top:20px;font-size:13px;color:#666">Visitors are counted by a salted daily hash of IP and browser \u2014 no IP addresses are stored and hashes cannot be linked across days. Known bots are excluded.</p>
  <p><a href="/admin?key=${k}">\u2190 Back to registrations</a></p></body></html>`);
});

// Archive individual registrations. Same principle as the full reset: entries
// are moved to a timestamped folder, never deleted, and the password is
// required so a stray tap on a phone cannot wipe a paying attendee.
app.post('/admin/archive', (req, res) => {
  if (!guard(req, res)) return;
  const { password, emails } = req.body || {};
  if (!RESET_PASSWORD) return res.status(500).json({ ok: false, error: 'No reset password configured.' });
  if (String(password || '') !== RESET_PASSWORD) {
    console.error('[admin] selective archive attempt with wrong password');
    return res.status(403).json({ ok: false, error: 'Wrong password.' });
  }
  const wanted = new Set((Array.isArray(emails) ? emails : []).map((e) => String(e).trim().toLowerCase()));
  if (!wanted.size) return res.status(400).json({ ok: false, error: 'Nothing selected.' });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = path.join(DATA_DIR, 'archive-selected-' + stamp);
  fs.mkdirSync(archiveDir, { recursive: true });

  // Split a jsonl file into kept and removed lines, writing atomically so a
  // request arriving mid-rewrite cannot read a half-written file.
  const split = (fileName) => {
    const src = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(src)) return 0;
    const kept = []; const gone = [];
    fs.readFileSync(src, 'utf8').trim().split('\n').filter(Boolean).forEach((l) => {
      let email = '';
      try { email = String(JSON.parse(l).email || '').toLowerCase(); } catch {}
      (wanted.has(email) ? gone : kept).push(l);
    });
    if (gone.length) {
      fs.writeFileSync(path.join(archiveDir, fileName), gone.join('\n') + '\n');
      const tmp = src + '.tmp';
      fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '');
      fs.renameSync(tmp, src);
    }
    return gone.length;
  };

  // Grab the proof filenames before the registrations disappear
  const proofs = readAll().filter((r) => wanted.has(r.email)).map((r) => r.proofFile).filter(Boolean);

  const removed = split('registrations.jsonl');
  split('payments.jsonl');
  split('pending.jsonl');
  split('ghl-sync.jsonl');
  split('checkins.jsonl');
  split('waitlist.jsonl');

  let movedProofs = 0;
  if (proofs.length) {
    const dest = path.join(archiveDir, 'proofs');
    fs.mkdirSync(dest, { recursive: true });
    proofs.forEach((f) => {
      const src = path.join(PROOF_DIR, f);
      if (fs.existsSync(src)) { fs.renameSync(src, path.join(dest, f)); movedProofs++; }
    });
  }

  console.log('[admin] archived', removed, 'registration(s) to', archiveDir, '| proofs:', movedProofs);
  res.json({ ok: true, archived: removed, folder: path.basename(archiveDir) });
});

// Clear all registration data. Nothing is deleted: files and proof images are
// moved into a timestamped archive folder inside DATA_DIR, so a mistake is
// always recoverable. Needs the admin key AND the reset password, and the
// password travels by POST so it never lands in a URL, log or browser history.
function resetPage(k, error) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Clear all data</title>'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<link rel="apple-touch-icon" href="/img/appicon.png"></head>'
    + '<body style="font-family:system-ui;padding:24px;background:#F7F4EE;max-width:560px">'
    + '<h2 style="margin-bottom:6px">Clear all registration data?</h2>'
    + '<p style="color:#444;line-height:1.5">This moves every registration, payment record and payment '
    + 'screenshot into an archive folder. The list will be empty afterwards. Nothing is permanently deleted. '
    + 'To remove only some entries, tick them on the registrations page instead.</p>'
    + (error ? `<p style="color:#a33;font-weight:600">${error}</p>` : '')
    + `<form method="POST" action="/admin/reset?key=${k}" style="margin-top:18px">`
    + '<label style="display:block;font-weight:600;font-size:14px;margin-bottom:6px">Reset password</label>'
    + '<input type="password" name="password" autocomplete="off" autofocus '
    + 'style="width:100%;padding:13px 12px;border:1px solid #d8d2c4;border-radius:9px;font-size:16px;background:#fff">'
    + '<div style="margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">'
    + '<button type="submit" style="background:#a33;color:#fff;border:0;border-radius:8px;padding:13px 20px;'
    + 'font-size:15px;font-weight:600;cursor:pointer">Clear all data</button>'
    + `<a href="/admin?key=${k}" style="color:#555">Cancel</a></div></form></body></html>`;
}

app.get('/admin/reset', (req, res) => {
  if (!guard(req, res)) return;
  res.send(resetPage(encodeURIComponent(req.query.key), ''));
});

app.post('/admin/reset', (req, res) => {
  if (!guard(req, res)) return;
  const k = encodeURIComponent(req.query.key);
  if (!RESET_PASSWORD) {
    return res.status(500).send(resetPage(k, 'No reset password is configured. Set RESET_PASSWORD first.'));
  }
  if (String((req.body || {}).password || '') !== RESET_PASSWORD) {
    console.error('[admin] reset attempt with wrong password');
    return res.status(403).send(resetPage(k, 'Wrong password.'));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = path.join(DATA_DIR, 'archive-' + stamp);
  fs.mkdirSync(archiveDir, { recursive: true });

  const moved = [];
  ['registrations.jsonl', 'payments.jsonl', 'pending.jsonl', 'ghl-sync.jsonl',
    'views.jsonl', 'checkins.jsonl', 'waitlist.jsonl', 'feedback.jsonl', 'questions.jsonl'].forEach((f) => {
    const src = path.join(DATA_DIR, f);
    if (fs.existsSync(src)) { fs.renameSync(src, path.join(archiveDir, f)); moved.push(f); }
  });

  let proofs = 0;
  if (fs.existsSync(PROOF_DIR)) {
    const dest = path.join(archiveDir, 'proofs');
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(PROOF_DIR).forEach((f) => {
      fs.renameSync(path.join(PROOF_DIR, f), path.join(dest, f));
      proofs++;
    });
  }

  console.log('[admin] data cleared, archived to', archiveDir, '| files:', moved.join(','), '| proofs:', proofs);
  res.send('<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
    + '<body style="font-family:system-ui;padding:24px;background:#F7F4EE">'
    + '<h2>Done \u2014 the list is empty.</h2>'
    + `<p>Archived ${moved.length} data file(s) and ${proofs} payment screenshot(s). `
    + 'Everything can be restored from the archive.</p>'
    + `<p><a href="/admin?key=${k}">Back to registrations</a></p></body></html>`);
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

// Mark a guest as complimentary, or take the status away again
app.get('/admin/comp', async (req, res) => {
  if (!guard(req, res)) return;
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).send('email required');
  const on = String(req.query.off || '') !== '1';

  fs.appendFileSync(path.join(DATA_DIR, 'payments.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), email, paid: on, comp: on }) + '\n');
  console.log('[admin]', on ? 'complimentary' : 'complimentary removed', email);

  const entry = readAll().find((r) => r.email === email);
  if (on && entry && GHL_API_TOKEN && GHL_LOCATION_ID) {
    try { await addGhlTag(entry, GHL_TAG_COMP); } catch (e) { console.error('[ghl] comp tag failed', e.message); }
  }
  res.redirect('/admin?key=' + encodeURIComponent(req.query.key));
});

// Archive browser with per-entry restore
archive.mount(app, {
  DATA_DIR, guard, PROOF_DIR, SEAT_PRICE,
  RESET_PASSWORD: () => RESET_PASSWORD,
});

// A walk-in is a real registration: stored, paid (they pay cash at the door)
// and pushed to GHL with its own tag so the follow-up can tell them apart.
function addWalkin(entry) {
  fs.appendFileSync(DB_FILE, JSON.stringify(entry) + '\n');
  fs.appendFileSync(path.join(DATA_DIR, 'payments.jsonl'),
    JSON.stringify({ ts: entry.ts, email: entry.email, paid: true, walkin: true }) + '\n');

  sendToGHL(entry)
    .then(async (mode) => {
      if (mode === 'disabled') return;
      logSync(entry.email, 'sent', mode);
      if (GHL_API_TOKEN && GHL_LOCATION_ID) {
        for (const t of [GHL_TAG_WALKIN, GHL_TAG_ATTENDED, GHL_TAG_PAID]) {
          try { await addGhlTag(entry, t); } catch (e) { console.error('[ghl] walk-in tag failed', e.message); }
        }
      }
    })
    .catch((e) => { console.error('[ghl] walk-in sync failed', e.message); logSync(entry.email, 'failed', e.message); });
}

// Reception check-in (tablet interface at the door)
checkin.mount(app, {
  DATA_DIR, guard, readAll, paidSet, compSet, addGhlTag, addWalkin,
  ATTENDED_TAG: GHL_TAG_ATTENDED,
  ghlReady: () => Boolean(GHL_API_TOKEN && GHL_LOCATION_ID),
});

slides.mount(app);
badges.mount(app, { guard, readAll, paidSet });
feedback.mount(app, {
  DATA_DIR, guard,
  registrations: readAll,
  // Everyone marked arrived at the desk - the only people worth chasing
  checkedIn: () => {
    const f = path.join(DATA_DIR, 'checkins.jsonl');
    const m = new Map();
    if (fs.existsSync(f)) {
      fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).forEach((l) => {
        try { const r = JSON.parse(l); m.set(r.email, r.arrived); } catch {}
      });
    }
    return new Set([...m.entries()].filter(([, v]) => v).map(([e]) => e));
  },
});
screen.mount(app);
version.mount(app, { guard });

app.get('/health', (_req, res) => res.json({
  ok: true,
  ghl: GHL_WEBHOOK_URL ? 'webhook' : (GHL_API_TOKEN && GHL_LOCATION_ID ? 'api' : 'not configured'),
  tag: GHL_TAG,
  assignedTo: GHL_ASSIGNED_USER || 'not set',
  payment: payment.isEnabled() ? payment.mode() + ' (automatic QRIS)' : (PAYMENT_REQUIRED ? PAYMENT_AMOUNT + ' via ' + PAYMENT_METHOD + ' (proof required)' : 'disabled'),
  seatPrice: SEAT_PRICE,
  seatCap: SEAT_CAP,
  seatsLeft: seatsLeft(),
  version: version.VERSION,
}));

app.listen(PORT, () => {
  const mode = GHL_WEBHOOK_URL ? 'webhook' : (GHL_API_TOKEN && GHL_LOCATION_ID ? 'api' : 'NOT CONFIGURED (still placeholders)');
  console.log(`CHA-08 event page v${version.VERSION} running on :${PORT}`);
  console.log(`[ghl] mode: ${mode} | tag: "${GHL_TAG}" | assigned to: ${GHL_ASSIGNED_USER || 'nobody'}`);
  console.log(`[seats] cap ${SEAT_CAP} | ${seatsLeft()} left`);
  console.log(`[payment] ${payment.isEnabled()
    ? payment.mode() + ' - automatic QRIS, IDR ' + SEAT_PRICE + ' per seat'
    : (PAYMENT_REQUIRED ? PAYMENT_AMOUNT + ' via ' + PAYMENT_METHOD + ', screenshot required' : 'disabled')}`);
});
