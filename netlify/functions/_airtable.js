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
  if (!token || !baseId || !tableClubs || !tableCategories) {
    return { error: json(500, { error: 'Server configuration error' }) };
  }
  return { token, baseId, tableClubs, tableCategories };
}

export async function airtableFetch(path, { token, method = 'GET', body, query } = {}) {
  let url = `https://api.airtable.com/v0/${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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
