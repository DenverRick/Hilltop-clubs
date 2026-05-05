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

export function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

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
