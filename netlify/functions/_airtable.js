// Shared Airtable helpers used by all functions in this directory.
// Keeps the Bearer token and Leader-Email stripping logic in one place.

export const SENSITIVE_FIELDS = ['Leader Email'];

export const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Content-Type': 'application/json',
};

export function preflight(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_HEADERS, body: '' };
  }
  return null;
}

export function json(statusCode, body, extraHeaders) {
  const headers = extraHeaders ? { ...JSON_HEADERS, ...extraHeaders } : JSON_HEADERS;
  return { statusCode, headers, body: JSON.stringify(body) };
}

// Cache directives used by the read functions. Tuned for the free-tier
// Airtable plan: short browser TTL so a leader's edit propagates within a
// minute on their own device, longer Netlify-CDN (s-maxage) so repeat hits
// from other visitors hit the edge instead of Airtable. Set on 200 OK only —
// errors must not be cached.
export const CACHE = {
  // Categories rarely change. Long TTL.
  CATEGORIES: 'public, max-age=300, s-maxage=3600',
  // Club lists / detail. Up to ~5 min stale at edge after a leader edit.
  CLUBS:      'public, max-age=60, s-maxage=300',
  // Upcoming-events lists. Slightly longer edge cache — schedules don't change
  // minute-by-minute, and the recurrence expansion + override join is more
  // expensive than a single-record fetch.
  EVENTS:     'public, max-age=300, s-maxage=1800',
  // Privacy-sensitive: must always fetch fresh (Leader Email is the payload).
  // Caching this anywhere — browser, edge, intermediate — would risk leakage.
  NEVER:      'private, no-store, max-age=0',
};

export function env() {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableClubs = process.env.AIRTABLE_TABLE_CLUBS;
  const tableCategories = process.env.AIRTABLE_TABLE_CATEGORIES;
  // Club-run event model (new base). Not in the required guard below so the
  // club/category functions still work if these are ever unset; the event
  // functions validate them on their own.
  const tableClubEvents = process.env.AIRTABLE_TABLE_CLUB_EVENTS;
  const tableEventOverrides = process.env.AIRTABLE_TABLE_EVENT_OVERRIDES;
  const tableNewsletter = process.env.AIRTABLE_TABLE_NEWSLETTER;
  if (!token || !baseId || !tableClubs || !tableCategories) {
    return { error: json(500, { error: 'Server configuration error' }) };
  }
  return { token, baseId, tableClubs, tableCategories, tableClubEvents, tableEventOverrides, tableNewsletter };
}

export async function airtableFetch(path, { token, method = 'GET', body, query } = {}) {
  let url = `https://api.airtable.com/v0/${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += `?${qs}`;
  }
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  };
  // Airtable caps each base at ~5 requests/second and replies 429 when a burst
  // exceeds it. The clubs site, the calendar app, and the iPad reader all share
  // one base, so brief bursts happen. Retry a 429 a few times with a short
  // backoff before giving up — turns a transient spike into a slightly slower
  // response instead of a visible "Request failed" for the resident.
  const backoffs = [300, 700, 1500];
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, init);
    if (res.status !== 429 || attempt >= backoffs.length) break;
    await new Promise((r) => setTimeout(r, backoffs[attempt]));
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// Strip Leader Email (and any other sensitive fields) from a record.
// CRITICAL: every list/detail response that reaches the browser MUST go through this.
export function stripSensitive(record) {
  if (!record || !record.fields) return record;
  const fields = { ...record.fields };
  for (const f of SENSITIVE_FIELDS) delete fields[f];
  return { ...record, fields };
}

export function escapeFormulaString(s) {
  // Airtable formula strings escape single quotes by doubling them, plus backslashes.
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Case-insensitive match of a submitter email against a club's "Leader Email"
// field, which may hold MORE THAN ONE address (comma/semicolon separated) so a
// club with co-leaders can have several people who each log in with their own
// address. Single-address fields are unaffected.
export function leaderEmailMatches(submitterEmail, leaderField) {
  const submitter = String(submitterEmail || '').trim().toLowerCase();
  if (!submitter) return false;
  return String(leaderField || '')
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(submitter);
}
