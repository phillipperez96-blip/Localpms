// Integration adapters. Every adapter works in "demo mode" (simulated) when its
// credentials are absent, and talks to the real provider once the environment
// variables documented in .env.example are set. Swap providers by editing this file only.

const env = process.env;
const simRef = (p) => `${p}-SIM-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

export function integrationStatus() {
  return {
    payments: {
      label: 'Card Payments', provider: 'Stripe', connected: !!env.STRIPE_SECRET_KEY,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || null,
      vars: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
      notes: 'Processes card payments at move-in, on tenant accounts, POS sales and autopay. In demo mode cards are approved instantly and nothing is charged.',
    },
    email: {
      label: 'Email', provider: 'SendGrid', connected: !!(env.SENDGRID_API_KEY && env.EMAIL_FROM),
      vars: ['SENDGRID_API_KEY', 'EMAIL_FROM'],
      notes: 'Sends receipts, notices and announcements. In demo mode messages are logged but not delivered.',
    },
    sms: {
      label: 'Text Messaging', provider: 'Twilio', connected: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER),
      vars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
      notes: 'Sends payment reminders and lead follow-ups. In demo mode texts are logged but not delivered.',
    },
    gate: {
      label: 'Gate Access Control', provider: 'Webhook (any gate system)', connected: !!env.GATE_WEBHOOK_URL,
      vars: ['GATE_WEBHOOK_URL', 'GATE_API_KEY'],
      notes: 'Pushes gate code creation, removal and access lockouts to your keypad/gate controller. Point the webhook at your gate vendor API or a small bridge service.',
    },
    letters: {
      label: 'Certified Mail / Letters', provider: 'Print in-office', connected: true, vars: [],
      notes: 'Letters render as printable documents. A mailing service (e.g. a certified-mail API) can be added in server/services/integrations.js → sendLetter().',
    },
  };
}

async function postForm(url, data, headers) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(data) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || json?.message || `HTTP ${res.status}`);
  return json;
}

/** Charge a card. `paymentMethodId` comes from Stripe.js on the client when Stripe is connected. */
export async function chargeCard({ amount, paymentMethodId, description, last4 }) {
  if (!env.STRIPE_SECRET_KEY) {
    return { ok: true, simulated: true, reference: simRef('CH'), last4: last4 || '4242' };
  }
  if (!paymentMethodId) throw new Error('Card details are required (Stripe payment method missing).');
  const pi = await postForm('https://api.stripe.com/v1/payment_intents', {
    amount: Math.round(amount * 100), currency: 'usd', payment_method: paymentMethodId, confirm: 'true',
    description: description || 'Storage payment',
    'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
  }, { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` });
  if (pi.status !== 'succeeded') throw new Error(`Payment ${pi.status}`);
  return { ok: true, simulated: false, reference: pi.id };
}

export async function refundCard({ reference, amount }) {
  if (!env.STRIPE_SECRET_KEY || !reference || reference.includes('-SIM-')) return { ok: true, simulated: true, reference: simRef('RF') };
  const r = await postForm('https://api.stripe.com/v1/refunds', { payment_intent: reference, amount: Math.round(amount * 100) },
    { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` });
  return { ok: true, simulated: false, reference: r.id };
}

export async function sendEmail({ to, subject, body }) {
  if (!to) return { status: 'failed', error: 'No email address on file' };
  if (!(env.SENDGRID_API_KEY && env.EMAIL_FROM)) return { status: 'simulated', provider_ref: simRef('EM') };
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: env.EMAIL_FROM }, subject, content: [{ type: 'text/plain', value: body }] }),
    });
    if (!res.ok) return { status: 'failed', error: `SendGrid HTTP ${res.status}` };
    return { status: 'sent', provider_ref: res.headers.get('x-message-id') };
  } catch (e) { return { status: 'failed', error: e.message }; }
}

export async function sendSms({ to, body }) {
  if (!to) return { status: 'failed', error: 'No phone number on file' };
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER)) return { status: 'simulated', provider_ref: simRef('SM') };
  try {
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const r = await postForm(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      { To: to, From: env.TWILIO_FROM_NUMBER, Body: body }, { Authorization: `Basic ${auth}` });
    return { status: 'sent', provider_ref: r.sid };
  } catch (e) { return { status: 'failed', error: e.message }; }
}

export async function sendLetter() {
  // Letters are printed from the Communications page. Hook a mail API in here if desired.
  return { status: 'ready_to_print' };
}

/** Push gate access state to the gate controller. */
export async function gateSetAccess({ facilityId, code, allowed, units, tenantName, action = 'set_access' }) {
  if (!env.GATE_WEBHOOK_URL) return { status: 'simulated' };
  try {
    const res = await fetch(env.GATE_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(env.GATE_API_KEY ? { Authorization: `Bearer ${env.GATE_API_KEY}` } : {}) },
      body: JSON.stringify({ action, facility_id: facilityId, code, allowed, units, tenant: tenantName }),
    });
    return { status: res.ok ? 'sent' : 'failed', error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) { return { status: 'failed', error: e.message }; }
}
