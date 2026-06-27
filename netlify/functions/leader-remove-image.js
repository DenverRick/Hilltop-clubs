// Leader-driven removal of a club's promo flyer or banner/thumbnail.
//
// The upload functions only ever REPLACE an attachment, so there was no way
// for a leader to clear one. This endpoint clears a single allow-listed
// attachment field by PATCHing it to an empty array. Same email-match auth as
// the upload functions; only 'flyer' and 'thumbnail' targets are permitted, so
// a crafted request can't blank arbitrary fields.

import { preflight, json, env, airtableFetch, escapeFormulaString, leaderEmailMatches } from './_airtable.js';

// target key → Airtable attachment field name.
const FIELD_BY_TARGET = {
  flyer: 'Promo Flyer',
  thumbnail: 'Thumbnail Image',
};

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { slug, submitter_email, target } = payload;
  if (!slug || !submitter_email || !target) {
    return json(400, { error: 'Missing slug, submitter_email, or target' });
  }
  const fieldName = FIELD_BY_TARGET[target];
  if (!fieldName) return json(400, { error: 'Invalid target (expected "flyer" or "thumbnail").' });

  const e = env();
  if (e.error) return e.error;

  const lookup = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
    query: { filterByFormula: `{Slug} = '${escapeFormulaString(slug)}'`, maxRecords: '1' },
  });
  if (!lookup.ok) return json(lookup.status, { error: 'Airtable error', details: lookup.data });
  const record = lookup.data.records?.[0];

  const leaderEmail = record?.fields?.['Leader Email'];
  if (!record || !leaderEmail || !leaderEmailMatches(submitter_email, leaderEmail)) {
    return json(403, { error: 'Email does not match the leader on file for this club.' });
  }

  const patch = await airtableFetch(`${e.baseId}/${e.tableClubs}/${record.id}`, {
    token: e.token,
    method: 'PATCH',
    body: { fields: { [fieldName]: [] } },
  });
  if (!patch.ok) {
    const reason = patch.data?.error?.message || patch.data?.error?.type || `HTTP ${patch.status}`;
    return json(patch.status, { error: `Remove failed: ${reason}`, details: patch.data });
  }

  return json(200, { ok: true });
}
