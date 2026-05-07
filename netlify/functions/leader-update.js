import { preflight, json, env, airtableFetch, escapeFormulaString } from './_airtable.js';

// Fields a club leader is allowed to update on their own row.
// Anything not in this list is silently dropped before the PATCH.
const ALLOWED_FIELDS = new Set([
  'Short Blurb',
  'Long Description',
  'Tags',
  'Meeting Frequency',
  'Meeting Day',
  'Meeting Schedule',
  'Meeting Time',
  'Meeting Location',
  'Next Meeting',
  'Member Count',
  'Vibe / Demographics',
  'YouTube URLs',
  'External Website',
  'TeamReach',
]);

const normalize = (s) => String(s || '').trim().toLowerCase();

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PATCH') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { slug, submitter_email, fields } = payload;
  if (!slug || !submitter_email || !fields || typeof fields !== 'object') {
    return json(400, { error: 'Missing slug, submitter_email, or fields' });
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

  // Generic 403 whether the club is missing or the email doesn't match.
  // We don't tell the caller which — they shouldn't be able to enumerate either.
  const leaderEmail = record?.fields?.['Leader Email'];
  if (!record || !leaderEmail || normalize(submitter_email) !== normalize(leaderEmail)) {
    return json(403, { error: 'Email does not match the leader on file for this club.' });
  }

  // Filter to allowed fields only.
  const safeFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(k)) safeFields[k] = v;
  }
  if (Object.keys(safeFields).length === 0) {
    return json(400, { error: 'No allowed fields supplied' });
  }

  // typecast lets Airtable coerce string values into singleSelect /
  // multipleSelects options — creating new options on the fly when a
  // leader adds a tag we haven't seen before. Without this, an unknown
  // tag returns 422 "Cannot parse value for field Tags."
  const patch = await airtableFetch(`${e.baseId}/${e.tableClubs}/${record.id}`, {
    token: e.token,
    method: 'PATCH',
    body: { fields: safeFields, typecast: true },
  });
  if (!patch.ok) {
    // Surface Airtable's specific reason to the form so leaders see what
    // actually went wrong, not just "Airtable update failed."
    const reason = patch.data?.error?.message || patch.data?.error?.type || `HTTP ${patch.status}`;
    return json(patch.status, { error: `Update failed: ${reason}`, details: patch.data });
  }

  return json(200, { ok: true, id: record.id, updated: Object.keys(safeFields) });
}
