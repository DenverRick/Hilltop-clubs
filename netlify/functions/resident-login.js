// Resident login — validates the shared community password and sets the
// resident cookie that the edge gate (gate.js) checks. Mirrors the calendar
// app's login, adapted to a Netlify Function.
//
// The cookie value is an HMAC token derived from RESIDENT_PASSWORD, never the
// raw password. gate.js recomputes the same token to authorize requests.

import crypto from 'node:crypto';

const COOKIE = 'hc_resident';
const TOKEN_MESSAGE = 'hilltop-resident-v1';
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days, matches the calendar session.

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const password = process.env.RESIDENT_PASSWORD;
  if (!password) {
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: 'Server not configured (RESIDENT_PASSWORD unset).' }) };
  }

  let submitted = '';
  try { submitted = String(JSON.parse(event.body || '{}').password || ''); }
  catch { return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: 'Invalid request.' }) }; }

  if (!submitted || !timingSafeEqualStr(submitted, password)) {
    // Generic message — don't hint whether it was close.
    return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ error: 'Incorrect password.' }) };
  }

  const token = computeToken(password);
  const cookie = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE}`,
  ].join('; ');

  return {
    statusCode: 200,
    headers: { ...jsonHeaders, 'Set-Cookie': cookie },
    body: JSON.stringify({ ok: true }),
  };
}

// HMAC-SHA256(key=password, msg=TOKEN_MESSAGE) as hex — must match gate.js.
function computeToken(password) {
  return crypto.createHmac('sha256', password).update(TOKEN_MESSAGE).digest('hex');
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
