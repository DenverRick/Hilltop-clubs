// Bridge between the club-directory leader page and the separate RSVP app.
//
// The directory verifies the leader (same email-match as leader-update.js) and
// then calls the RSVP app's machine-to-machine endpoints with a shared
// PARTNER_SECRET. The RSVP app owns its own Airtable base + ENCRYPTION_KEY; we
// never touch them here, and the App Password is encrypted on the RSVP side.
//
// actions:
//   status      -> provision-club (find-or-create) + return current state
//   import      -> import-members  { emails }
//   credentials -> save-credentials { gmailUser, appPassword }

import { preflight, json, env, airtableFetch, escapeFormulaString, CACHE } from './_airtable.js';

const normalize = (s) => String(s || '').trim().toLowerCase();

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const partnerSecret = process.env.PARTNER_SECRET;
  const rsvpApiBase = (process.env.RSVP_API_BASE || '').replace(/\/+$/, '');
  if (!partnerSecret || !rsvpApiBase) {
    return json(500, { error: 'RSVP integration is not configured.' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { slug, submitter_email, action, ...rest } = payload;
  if (!slug || !submitter_email || !action) {
    return json(400, { error: 'Missing slug, submitter_email, or action' });
  }
  if (!['status', 'import', 'credentials'].includes(action)) {
    return json(400, { error: 'Unknown action' });
  }

  const e = env();
  if (e.error) return e.error;

  // Verify the leader against the directory's club record (same posture as
  // leader-update.js: generic 403 whether the club is missing or the email
  // doesn't match — callers can't enumerate either).
  const lookup = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
    query: { filterByFormula: `{Slug} = '${escapeFormulaString(slug)}'`, maxRecords: '1' },
  });
  if (!lookup.ok) return json(lookup.status, { error: 'Airtable error', details: lookup.data });
  const record = lookup.data.records?.[0];
  const leaderEmail = record?.fields?.['Leader Email'];
  if (!record || !leaderEmail || normalize(submitter_email) !== normalize(leaderEmail)) {
    return json(403, { error: 'Email does not match the leader on file for this club.' },
      { 'Cache-Control': CACHE.NEVER });
  }
  const clubName = record.fields['Name'] || slug;

  // Build the RSVP-app call for this action.
  let path;
  let body;
  if (action === 'status') {
    path = 'provision-club';
    body = { slug, name: clubName, leaderEmail: submitter_email };
  } else if (action === 'import') {
    path = 'import-members';
    body = { slug, emails: rest.emails || '' };
  } else {
    path = 'save-credentials';
    body = { slug, gmailUser: rest.gmailUser || '', appPassword: rest.appPassword || '' };
  }

  try {
    const res = await fetch(`${rsvpApiBase}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partnerSecret, ...body }),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = null; }
    if (!data) return json(502, { error: 'Unexpected response from the RSVP service.' });
    if (!res.ok) return json(res.status, { error: data.error || 'RSVP request failed.' },
      { 'Cache-Control': CACHE.NEVER });
    return json(200, data, { 'Cache-Control': CACHE.NEVER });
  } catch (err) {
    return json(502, { error: 'Could not reach the RSVP service.' }, { 'Cache-Control': CACHE.NEVER });
  }
}
