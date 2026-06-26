// Leader-driven promo flyer upload.
//
// Same shape as leader-upload-thumbnail.js — email-match auth, Airtable
// content-upload endpoint, secret token stays server-side. The only
// differences are the target field (Promo Flyer instead of Thumbnail
// Image) and a slightly higher size cap (flyers tend to be higher
// resolution than card thumbnails).
//
// Replacing: each upload becomes the new attachment. The Promo Flyer
// field is a multipleAttachments field but on the public page we only
// surface the first attachment, so functionally the latest upload
// always wins.

import { preflight, json, env, airtableFetch, escapeFormulaString } from './_airtable.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB. Netlify sync function payload limit is ~6 MB.
const PROMO_FLYER_FIELD_ID = 'fldGm6YN2ibB3YkRM'; // Clubs.Promo Flyer

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
  if (fileBase64.length * 0.75 > MAX_BYTES) {
    return json(400, { error: 'Flyer too large (max 5 MB).' });
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
    return json(403, { error: 'Email does not match the leader on file for this club.' });
  }

  const uploadUrl = `https://content.airtable.com/v0/${e.baseId}/${record.id}/${PROMO_FLYER_FIELD_ID}/uploadAttachment`;
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
  if (!res.ok) {
    const reason = data?.error?.message || data?.error?.type || `HTTP ${res.status}`;
    return json(res.status, { error: `Upload failed: ${reason}`, details: data });
  }

  // Stamp "Last Updated" so a fresh flyer surfaces the club in the landing
  // page's "New Information" section — same dateTime the text-save form sets
  // (see leader-update.js). Best-effort: the image is already uploaded, so a
  // failed stamp shouldn't fail the request.
  await airtableFetch(`${e.baseId}/${e.tableClubs}/${record.id}`, {
    token: e.token,
    method: 'PATCH',
    body: { fields: { 'Last Updated': new Date().toISOString() } },
  });

  return json(200, { ok: true });
}
