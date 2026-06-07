// /api/razorpay-webhook — Consult ₹497 payment → tag Kit `content-consultation-paid`
// Razorpay pushes here on payment. We verify the signature, pull the payer's email,
// then create/tag the subscriber in Kit. Make.com is NOT used.
//
// Env vars needed (set in Vercel):
//   RAZORPAY_WEBHOOK_SECRET  — the signing secret from the Razorpay webhook setup
//   KIT_API_KEY              — Kit v4 API key (same one used elsewhere)
//   KIT_PAID_TAG_ID          — the Kit tag ID for `content-consultation-paid` (= 17740069)

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

// read the raw body (needed for signature verification)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'body_read_failed' });
  }

  // 1) Verify the signature — proves the call really came from Razorpay
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  try {
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (expected !== signature) {
      // not from Razorpay (or wrong secret) — ignore, but return 200 so RP doesn't retry forever
      return res.status(200).json({ ok: false, reason: 'bad_signature' });
    }
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'verify_error' });
  }

  // 2) Parse the event
  let event;
  try {
    event = JSON.parse(raw);
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'bad_json' });
  }

  // Only act on a successful payment
  const type = event.event; // e.g. "payment.captured"
  if (type !== 'payment.captured' && type !== 'order.paid') {
    return res.status(200).json({ ok: true, ignored: type });
  }

  // 3) Pull the payer's details from the payload
  const payment =
    event?.payload?.payment?.entity ||
    event?.payload?.order?.entity ||
    {};
  const email = payment.email || '';
  const contact = payment.contact || '';
  const name =
    (payment.notes && (payment.notes.name || payment.notes.customer_name)) || '';

  if (!email) {
    // no email = can't tag in Kit; log and move on
    return res.status(200).json({ ok: false, reason: 'no_email' });
  }

  // 4) Tag in Kit (v4 API) — create/find subscriber, then add the paid tag
  const KIT_KEY = process.env.KIT_API_KEY;
  const TAG_ID = process.env.KIT_PAID_TAG_ID;
  const kitHeaders = { 'X-Kit-Api-Key': KIT_KEY, 'Content-Type': 'application/json' };

  try {
    // upsert the subscriber
    await fetch('https://api.kit.com/v4/subscribers', {
      method: 'POST',
      headers: kitHeaders,
      body: JSON.stringify({
        email_address: email,
        first_name: name || undefined,
        fields: contact ? { phone: contact } : undefined,
      }),
    });

    // add the paid tag (this triggers the confirmation email automation)
    const tagRes = await fetch(`https://api.kit.com/v4/tags/${TAG_ID}/subscribers`, {
      method: 'POST',
      headers: kitHeaders,
      body: JSON.stringify({ email_address: email }),
    });

    const tagOk = tagRes.ok;
    return res.status(200).json({ ok: true, tagged: tagOk, email });
  } catch (e) {
    // always return 200 so Razorpay doesn't hammer retries; we log the failure
    return res.status(200).json({ ok: false, reason: 'kit_error', detail: String(e) });
  }
}
