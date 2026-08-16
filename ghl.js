/**
 * Minimal GoHighLevel tag helpers.
 *
 * server.js owns the registration sync - creating contacts, custom fields,
 * the tags that go with a sign-up. This file exists for the one thing a
 * feature module occasionally has to do on its own: take a tag back off.
 *
 * Reading the credentials from the environment here rather than threading a
 * callback through mount() keeps the check-in module self-contained.
 */

const BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';

// Values still holding a PASTE_... placeholder count as not configured
const real = (v) => {
  const s = String(v || '').trim();
  return (!s || s.startsWith('PASTE_')) ? '' : s;
};

const TOKEN = real(process.env.GHL_API_TOKEN);
const LOCATION = real(process.env.GHL_LOCATION_ID);

function headers() {
  return {
    Authorization: 'Bearer ' + TOKEN,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function ready() {
  return Boolean(TOKEN && LOCATION);
}

// Upsert by email to obtain the contact id. Sending no tags here is
// deliberate: the upsert endpoint replaces the whole tag list.
async function contactId(entry) {
  const r = await fetch(BASE + '/contacts/upsert', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      locationId: LOCATION,
      email: entry.email,
      phone: entry.phone,
      name: entry.name,
    }),
  });
  if (!r.ok) throw new Error('upsert HTTP ' + r.status);
  const body = await r.json().catch(() => ({}));
  const id = body?.contact?.id || body?.id;
  if (!id) throw new Error('no contact id');
  return id;
}

async function removeTag(entry, tag) {
  if (!ready()) return;
  const id = await contactId(entry);
  const r = await fetch(BASE + '/contacts/' + id + '/tags', {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify({ tags: [tag] }),
  });
  if (!r.ok) throw new Error('untag HTTP ' + r.status);
}

module.exports = { ready, removeTag };
