// Editor-gated CRUD for the Club Newsletter blocks (Newsletter table).
// Powers the /admin/newsletter editor. Auth is a single shared EDITOR_PASSWORD
// (Rick-only) checked server-side on every call — separate from the per-club
// leader email-match. The whole site also sits behind the resident gate, so
// this is double-gated. Action-dispatched POST: { password, action, ...payload }.

import crypto from 'node:crypto';
import { preflight, json, env, airtableFetch, CACHE } from './_airtable.js';

const IMAGES_FIELD_ID = 'fldhsUSayTGpY9Ip7'; // Newsletter.Images attachment field
const ALLOWED = ['Title', 'Type', 'Body', 'Sort Order', 'Active'];
const SELECT = ['Type']; // single-selects reject '' — drop empties for these

function sanitize(fields) {
  const out = {};
  for (const k of ALLOWED) {
    if (!(k in fields)) continue;
    const v = fields[k];
    if (SELECT.includes(k) && (v === '' || v == null)) continue;
    out[k] = v;
  }
  return out;
}

// Constant-time-ish password compare.
function pwEqual(a, b) {
  const ab = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const e = env();
  if (e.error) return e.error;
  if (!e.tableNewsletter) return json(500, { error: 'Newsletter table not configured' });

  const editorPw = process.env.EDITOR_PASSWORD;
  if (!editorPw) return json(500, { error: 'Editor password not configured on the server.' });
  if (!pwEqual(p.password, editorPw)) {
    return json(403, { error: 'Incorrect editor password.' }, { 'Cache-Control': CACHE.NEVER });
  }

  const base = `${e.baseId}/${e.tableNewsletter}`;

  switch (p.action) {
    case 'list': {
      // All blocks (active + inactive), sorted, with image metadata for the editor.
      const r = await airtableFetch(base, { token: e.token });
      if (!r.ok) return json(r.status, { error: 'Airtable error', details: r.data });
      const blocks = (r.data.records || []).map((rec) => ({
        id: rec.id,
        title: rec.fields['Title'] || '',
        type: rec.fields['Type'] || 'Markdown',
        body: rec.fields['Body'] || '',
        sortOrder: rec.fields['Sort Order'] ?? 9999,
        active: !!rec.fields['Active'],
        images: (rec.fields['Images'] || []).map((a) => ({ id: a.id, url: a.thumbnails?.large?.url || a.url, filename: a.filename || '' })),
      })).sort((a, b) => a.sortOrder - b.sortOrder);
      return json(200, { blocks }, { 'Cache-Control': CACHE.NEVER });
    }

    case 'create': {
      const fields = sanitize(p.fields || {});
      if (!fields['Type']) return json(400, { error: 'Choose a block type.' });
      if (!('Active' in fields)) fields['Active'] = true;
      if (!('Sort Order' in fields)) fields['Sort Order'] = 9999;
      const r = await airtableFetch(base, { token: e.token, method: 'POST', body: { fields, typecast: true } });
      if (!r.ok) return json(r.status, { error: `Could not create: ${r.data?.error?.message || r.status}` });
      return json(200, { ok: true, id: r.data.id });
    }

    case 'update': {
      if (!p.id) return json(400, { error: 'Missing block id' });
      const fields = sanitize(p.fields || {});
      // Allow explicit booleans/numbers that sanitize would otherwise pass through.
      if ('Active' in (p.fields || {})) fields['Active'] = !!p.fields['Active'];
      if ('Sort Order' in (p.fields || {})) fields['Sort Order'] = Number(p.fields['Sort Order']) || 0;
      const r = await airtableFetch(`${base}/${p.id}`, { token: e.token, method: 'PATCH', body: { fields, typecast: true } });
      if (!r.ok) return json(r.status, { error: `Update failed: ${r.data?.error?.message || r.status}` });
      return json(200, { ok: true, id: p.id });
    }

    case 'delete': {
      if (!p.id) return json(400, { error: 'Missing block id' });
      const r = await airtableFetch(`${base}/${p.id}`, { token: e.token, method: 'DELETE' });
      if (!r.ok) return json(r.status, { error: 'Delete failed', details: r.data });
      return json(200, { ok: true });
    }

    case 'reorder': {
      // ids in the desired top-to-bottom order → Sort Order 10, 20, 30, …
      if (!Array.isArray(p.ids)) return json(400, { error: 'Missing ids array' });
      for (let i = 0; i < p.ids.length; i++) {
        const r = await airtableFetch(`${base}/${p.ids[i]}`, { token: e.token, method: 'PATCH', body: { fields: { 'Sort Order': (i + 1) * 10 } } });
        if (!r.ok) return json(r.status, { error: 'Reorder failed', details: r.data });
      }
      return json(200, { ok: true });
    }

    case 'upload': {
      // Append an image to a block's Images attachment field.
      if (!p.id || !p.fileBase64) return json(400, { error: 'Missing block id or file' });
      const res = await fetch(`https://content.airtable.com/v0/${e.baseId}/${p.id}/${IMAGES_FIELD_ID}/uploadAttachment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: p.contentType || 'application/octet-stream', file: p.fileBase64, filename: p.filename || 'image' }),
      });
      const text = await res.text();
      let data; try { data = text ? JSON.parse(text) : {}; } catch { data = null; }
      if (!res.ok) return json(res.status, { error: `Upload failed: ${data?.error?.message || res.status}` });
      return json(200, { ok: true });
    }

    case 'removeImage': {
      if (!p.id || !p.attachmentId) return json(400, { error: 'Missing block id or attachmentId' });
      const cur = await airtableFetch(`${base}/${p.id}`, { token: e.token });
      if (!cur.ok) return json(cur.status, { error: 'Airtable error', details: cur.data });
      const kept = (cur.data.fields['Images'] || []).filter((a) => a.id !== p.attachmentId).map((a) => ({ id: a.id }));
      const r = await airtableFetch(`${base}/${p.id}`, { token: e.token, method: 'PATCH', body: { fields: { Images: kept } } });
      if (!r.ok) return json(r.status, { error: 'Could not remove image', details: r.data });
      return json(200, { ok: true });
    }

    default:
      return json(400, { error: 'Unknown action' });
  }
}
