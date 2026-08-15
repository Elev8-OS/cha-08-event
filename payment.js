/**
 * QRIS payment module (Midtrans Core API).
 *
 * Deliberately self-contained and provider-agnostic at the boundary, so this
 * file can move into Elev8 Suite OS as-is. The rest of the app only uses:
 *
 *   isEnabled()                       -> gateway configured?
 *   createCharge({ orderId, amount }) -> { qrImageUrl, qrString, expiresAt }
 *   readNotification(body)            -> { orderId, status, raw } | throws on bad signature
 *   checkStatus(orderId)              -> { orderId, status }
 *
 * status is normalised to: 'paid' | 'pending' | 'failed'
 *
 * Environment:
 *   MIDTRANS_SERVER_KEY    server key from the Midtrans dashboard
 *   MIDTRANS_PRODUCTION    'true' for live, anything else uses sandbox
 *   MIDTRANS_BASE          optional override (used by the test suite)
 */

const crypto = require('crypto');

const real = (v) => {
  const s = String(v || '').trim();
  return (!s || s.startsWith('PASTE_')) ? '' : s;
};

const SERVER_KEY = real(process.env.MIDTRANS_SERVER_KEY);
const PRODUCTION = String(process.env.MIDTRANS_PRODUCTION || '').toLowerCase() === 'true';
const BASE = process.env.MIDTRANS_BASE
  || (PRODUCTION ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com');

function authHeader() {
  return 'Basic ' + Buffer.from(SERVER_KEY + ':').toString('base64');
}

function isEnabled() {
  return Boolean(SERVER_KEY);
}

function mode() {
  if (!isEnabled()) return 'not configured';
  return PRODUCTION ? 'midtrans live' : 'midtrans sandbox';
}

// Midtrans transaction_status -> our three states
function normalise(status, fraud) {
  if (status === 'settlement' || status === 'capture') {
    return fraud === 'challenge' ? 'pending' : 'paid';
  }
  if (status === 'pending') return 'pending';
  return 'failed'; // deny, cancel, expire, failure
}

/**
 * Create a dynamic QRIS charge. The amount is baked into the QR, so the payer
 * cannot under- or overpay and reconciliation is exact.
 */
async function createCharge({ orderId, amount, customer }) {
  if (!isEnabled()) throw new Error('payment gateway not configured');
  const seats = Math.max(1, Number(customer && customer.seats ? customer.seats : 1));
  const body = {
    payment_type: 'qris',
    transaction_details: { order_id: orderId, gross_amount: Number(amount) },
    qris: { acquirer: 'gopay' },
    item_details: [{
      id: 'cha-08-seat',
      price: Number(amount) / seats,
      quantity: seats,
      name: 'Smarter Revenue Better Tech - seat',
    }],
  };
  if (customer) {
    body.customer_details = {
      first_name: String(customer.name || '').slice(0, 60),
      email: customer.email,
      phone: customer.phone,
    };
  }

  const r = await fetch(BASE + '/v2/charge', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || (data.status_code && Number(data.status_code) >= 400)) {
    throw new Error('midtrans charge failed: ' + (data.status_message || ('HTTP ' + r.status)));
  }

  const actions = Array.isArray(data.actions) ? data.actions : [];
  const qr = actions.find((a) => a.name === 'generate-qr-code') || actions[0];
  return {
    orderId,
    qrImageUrl: qr ? qr.url : '',
    qrString: data.qr_string || '',
    expiresAt: data.expiry_time || '',
    status: normalise(data.transaction_status, data.fraud_status),
  };
}

/**
 * Validate a webhook payload. Midtrans signs every notification with
 * sha512(order_id + status_code + gross_amount + server_key); an unsigned or
 * mismatching payload must never be trusted, since this endpoint is public.
 */
function readNotification(body) {
  if (!isEnabled()) throw new Error('payment gateway not configured');
  const { order_id, status_code, gross_amount, signature_key } = body || {};
  if (!order_id || !status_code || !gross_amount || !signature_key) {
    throw new Error('incomplete notification');
  }
  const expected = crypto.createHash('sha512')
    .update(String(order_id) + String(status_code) + String(gross_amount) + SERVER_KEY)
    .digest('hex');
  const a = Buffer.from(String(signature_key));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('invalid signature');
  }
  return {
    orderId: order_id,
    status: normalise(body.transaction_status, body.fraud_status),
    raw: body.transaction_status,
  };
}

/** Ask Midtrans directly - used as a fallback when a webhook is missed. */
async function checkStatus(orderId) {
  if (!isEnabled()) throw new Error('payment gateway not configured');
  const r = await fetch(BASE + '/v2/' + encodeURIComponent(orderId) + '/status', {
    method: 'GET',
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('status HTTP ' + r.status);
  return { orderId, status: normalise(data.transaction_status, data.fraud_status), raw: data.transaction_status };
}

module.exports = { isEnabled, mode, createCharge, readNotification, checkStatus };
