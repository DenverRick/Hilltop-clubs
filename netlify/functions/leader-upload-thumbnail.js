// Leader-driven thumbnail upload.
//
// Auth model mirrors leader-update.js: email-match against the row's Leader Email.
// On success the function calls Airtable's content-upload endpoint
// (https://content.airtable.com/v0/.../uploadAttachment) with the secret token
// server-side, so the token never reaches the browser. Airtable then hosts
// its own copy of the image and the field reflects the new attachment.
//
// Privacy note: the photo policy ("no actual club members") is communicated in
// the welcome email and on the form itself. Enforcement is post-hoc — Rick
// gets an Airtable automation notification on each row update and can clear
// a problematic image manually.

import { preflight, json, env, airtableFetch, escapeFormulaString } from './_airtable.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB. Netlify sync function payload limit is ~6 MB.
const THUMBNAIL_FIELD_ID = 'fldQQOaKB4AeTQC6k'; // Clubs.Thumbnail Image

const normalize = (s) => String(s || '').trim().toLowerCase();

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { slug, submitter_email, filename, contentType, fileBase64 } = payload;
  if (!slug || !submitter_email || !filename || !contentType || !fileBase64) {
    return json(400, { error: 'Missing slug, submitter_email, filename, contentType, or fileBase64' });
  }
  if (!ALLOWED_TYPES.has(contentType)) {
    return json(400, { error: 'Unsupported image type. Use JPEG, PNG, or WebP.' });
  }
  // base64 → bytes ≈ length × 0.75. Cheap pre-check before we forward to Airtable.
  if (fileBase64.length * 0.75 > MAX_BYTES) {
    return json(400, { error: 'Image too large (max 5 MB).' });
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

  // Generic 403 — same posture as leader-update.js.
  const leaderEmail = record?.fields?.['Leader Email'];
  if (!record || !leaderEmail || normalize(submitter_email) !== normalize(leaderEmail)) {
    return json(403, { error: 'Email does not match the leader on file for this club.' });
  }

  // Content-upload endpoint is on a different host than the standard API.
  const uploadUrl = `https://content.airtable.com/v0/${e.baseId}/${record.id}/${THUMBNAIL_FIELD_ID}/uploadAttachment`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${e.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contentType, file: fileBase64, filename }),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) return json(res.status, { error: 'Airtable upload failed', details: data });

  return json(200, { ok: true });
}
