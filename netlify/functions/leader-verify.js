// Leader login verification.
//
// Confirms that a submitter email matches the Leader Email on file for a club,
// BEFORE the edit form reveals its fields. Same email-match logic as
// leader-update.js — the difference is this endpoint exists purely to gate the
// UI so a leader knows immediately whether they entered the right address,
// rather than filling everything out and getting a 403 on save.
//
// Note: unlike the other read/write endpoints (which return a generic 403 to
// avoid revealing whether an address is the leader on file), this endpoint
// intentionally confirms a match — that's the whole point of a login step.
// Acceptable for a residents-only club directory; the tradeoff was approved.

import { preflight, json, env, airtableFetch, escapeFormulaString, CACHE } from './_airtable.js';

const normalize = (s) => String(s || '').trim().toLowerCase();

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { slug, submitter_email } = payload;
  if (!slug || !submitter_email) {
    return json(400, { error: 'Missing slug or submitter_email' });
  }

  const e = env();
  if (e.error) return e.error;

  const lookup = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
    query: {
      filterByFormula: `{Slug} = '${escapeFormulaString(slug)}'`,
      maxRecords: '1',
    },
  });
  if (!lookup.ok) return json(lookup.status, { error: 'Airtable error', details: lookup.data });
  const record = lookup.data.records?.[0];

  const leaderEmail = record?.fields?.['Leader Email'];
  if (!record || !leaderEmail || normalize(submitter_email) !== normalize(leaderEmail)) {
    return json(403, { error: "That email doesn't match the leader on file for this club. Double-check the address, or contact Rick if you think it's wrong." }, { 'Cache-Control': CACHE.NEVER });
  }

  // Never cache an auth result.
  return json(200, { ok: true, name: record.fields['Name'] || '' }, { 'Cache-Control': CACHE.NEVER });
}
