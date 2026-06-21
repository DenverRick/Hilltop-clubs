// Resident gate — Netlify Edge Function.
//
// This is the static-site equivalent of the calendar app's `requireResident`
// Express middleware. It runs before every request (config.path = "/*"),
// checks for a valid resident cookie, and 302-redirects unauthenticated
// visitors to /login?next=… . It gates BOTH the HTML pages and the /api/*
// content functions — gating HTML alone would leave the meeting data readable
// via a direct API call (e.g. /api/get-club?slug=…), which is the whole point
// of the gate.
//
// The cookie holds an HMAC token derived from RESIDENT_PASSWORD (never the raw
// password). The same token is computed by resident-login.js when it sets the
// cookie; here we recompute the expected token and compare in constant time.

const COOKIE = 'hc_resident';
const TOKEN_MESSAGE = 'hilltop-resident-v1';

export const config = { path: '/*' };

export default async function gate(request, context) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Paths that must stay reachable without auth: the login page + endpoint,
  // robots.txt, and static assets (so the login page can style itself).
  if (isPublicPath(path)) return; // continue down the pipeline

  const password = Netlify.env.get('RESIDENT_PASSWORD');
  // Fail closed: if the gate can't see the password, deny rather than expose.
  if (password) {
    const expected = await computeToken(password);
    const token = readCookie(request, COOKIE);
    if (token && timingSafeEqualHex(token, expected)) {
      // Authenticated — let it through, but make sure gated HTML is never
      // cached (otherwise the browser serves stale pre-gate HTML and the gate
      // looks broken on the next visit).
      const res = await context.next();
      const type = res.headers.get('content-type') || '';
      if (type.includes('text/html')) {
        const headers = new Headers(res.headers);
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return new Response(res.body, { status: res.status, headers });
      }
      return res;
    }
  }

  // Not authenticated. For API calls, a 302 to the HTML login page is useless —
  // fetch() silently follows it and the caller sees a 200 with login HTML,
  // which JSON clients then mistake for a successful response (e.g. a leader's
  // save reporting "Saved!" while nothing was written). So gate the API with a
  // clean 401 JSON instead, and only redirect actual page navigations.
  if (isApiPath(path)) {
    return new Response(
      JSON.stringify({ error: 'Your resident session has expired. Reload the page and sign in again.' }),
      { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  // Page navigation → send to the login page with a safe return path.
  const next = safeNext(path + url.search);
  const location = `${url.origin}/login?next=${encodeURIComponent(next)}`;
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

function isApiPath(path) {
  return path.startsWith('/api/') || path.startsWith('/.netlify/functions/');
}

function isPublicPath(path) {
  if (path === '/login' || path === '/login.html') return true;
  if (path === '/robots.txt' || path === '/favicon.ico') return true;
  if (path === '/api/resident-login' || path === '/.netlify/functions/resident-login') return true;
  // Static assets needed to render the login page (and harmless to expose).
  if (/\.(css|js|png|jpe?g|svg|gif|webp|ico|woff2?|ttf|map|webmanifest)$/i.test(path)) return true;
  return false;
}

// Only allow same-site absolute paths as a post-login redirect target — blocks
// open-redirect via a crafted ?next= (external URLs, protocol-relative //evil).
function safeNext(candidate) {
  if (typeof candidate !== 'string' || !candidate.startsWith('/')) return '/';
  if (candidate.startsWith('//')) return '/';
  if (candidate.startsWith('/login')) return '/';
  return candidate;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Constant-time-ish compare of two equal-length hex strings.
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// HMAC-SHA256(key=password, msg=TOKEN_MESSAGE) as hex. Web Crypto works in both
// the Deno edge runtime (here) and Node 18+ (resident-login.js), so both sides
// compute an identical token.
async function computeToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(TOKEN_MESSAGE));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
