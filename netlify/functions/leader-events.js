// Club-leader self-service editing of their OWN club's meeting events.
//
// Auth mirrors leader-update.js: email must match the club's Leader Email.
// Authorization is the new, critical part — a verified leader may only touch
// ClubEvents / EventOverrides belonging to THEIR club. Every mutate re-fetches
// the target row server-side and asserts its Club link equals the authenticated
// club's recordId; `Club` is server-forced on create (never trusted from the
// client). Action-dispatched POST: { slug, submitter_email, action, ...payload }.

import { preflight, json, env, airtableFetch, escapeFormulaString, CACHE, leaderEmailMatches } from './_airtable.js';

// Fields a leader may set on a ClubEvents row. `Club` is intentionally absent —
// it's forced to the authenticated club on create and never changed.
const ALLOWED_EVENT_FIELDS = [
  'Event Name', 'Active', 'Event Type', 'Day', 'Recurrence',
  'Recurrence Reference Date', 'Event Date', 'Start Time', 'End Time',
  'Location', 'Default Note',
];
// Fields a leader may set on an EventOverrides row. `Event` is server-forced.
const ALLOWED_OVERRIDE_FIELDS = [
  'Name', 'Date', 'Override Type', 'Start Time', 'End Time', 'Location', 'Note',
];

// Airtable rejects '' for single-select and date fields ("Cannot parse value").
// Drop empty-string / undefined values before writing — an omitted field is
// left unchanged on update and unset on create. (null is allowed through, to
// intentionally clear a text field.)
function sanitize(fields, allowed) {
  const out = {};
  for (const k of allowed) {
    if (!(k in fields)) continue;
    const v = fields[k];
    if (v === '' || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

// Verify the submitter is the club's leader. Returns { clubId } or { error }.
async function verifyLeader(e, slug, submitter_email) {
  if (!slug || !submitter_email) {
    return { error: json(400, { error: 'Missing slug or submitter_email' }) };
  }
  const lookup = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
    query: { filterByFormula: `{Slug} = '${escapeFormulaString(slug)}'`, maxRecords: '1' },
  });
  if (!lookup.ok) return { error: json(lookup.status, { error: 'Airtable error', details: lookup.data }) };
  const record = lookup.data.records?.[0];
  const leaderEmail = record?.fields?.['Leader Email'];
  // Generic 403 — don't reveal whether the club or the email was the mismatch.
  if (!record || !leaderEmail || !leaderEmailMatches(submitter_email, leaderEmail)) {
    return { error: json(403, { error: "That email doesn't match the leader on file for this club." }, { 'Cache-Control': CACHE.NEVER }) };
  }
  return { clubId: record.id };
}

// Fetch a ClubEvents row and assert it belongs to the authenticated club.
// Returns { record } or { error }.
async function fetchOwnedEvent(e, eventId, clubId) {
  if (!eventId) return { error: json(400, { error: 'Missing event id' }) };
  const res = await airtableFetch(`${e.baseId}/${e.tableClubEvents}/${eventId}`, { token: e.token });
  if (res.status === 404) return { error: json(404, { error: 'Event not found' }) };
  if (!res.ok) return { error: json(res.status, { error: 'Airtable error', details: res.data }) };
  if (res.data.fields?.['Club']?.[0] !== clubId) {
    return { error: json(403, { error: 'That event belongs to a different club.' }) };
  }
  return { record: res.data };
}

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { slug, submitter_email, action } = payload;

  const e = env();
  if (e.error) return e.error;
  if (!e.tableClubEvents || !e.tableEventOverrides) {
    return json(500, { error: 'Server configuration error' });
  }

  const auth = await verifyLeader(e, slug, submitter_email);
  if (auth.error) return auth.error;
  const { clubId } = auth;

  switch (action) {
    case 'list': {
      // This club's active events + their overrides. The tables are small, so
      // filter by the (linked-record) Club in JS rather than a formula.
      const evRes = await airtableFetch(`${e.baseId}/${e.tableClubEvents}`, {
        token: e.token,
        query: { filterByFormula: `{Active} = TRUE()` },
      });
      if (!evRes.ok) return json(evRes.status, { error: 'Airtable error', details: evRes.data });
      const mine = (evRes.data.records || []).filter((r) => r.fields?.['Club']?.[0] === clubId);
      const myIds = new Set(mine.map((r) => r.id));

      const ovRes = await airtableFetch(`${e.baseId}/${e.tableEventOverrides}`, { token: e.token });
      if (!ovRes.ok) return json(ovRes.status, { error: 'Airtable error', details: ovRes.data });
      const overrides = (ovRes.data.records || [])
        .filter((r) => myIds.has(r.fields?.['Event']?.[0]))
        .map((r) => ({ id: r.id, eventId: r.fields['Event'][0], ...r.fields }));

      const events = mine.map((r) => ({ id: r.id, ...r.fields }));
      return json(200, { events, overrides }, { 'Cache-Control': CACHE.NEVER });
    }

    case 'create': {
      const fields = sanitize(payload.fields || {}, ALLOWED_EVENT_FIELDS);
      const type = fields['Event Type'];
      if (!fields['Event Name']) return json(400, { error: 'Event name is required.' });
      if (type !== 'Recurring' && type !== 'One-off') return json(400, { error: 'Choose recurring or one-off.' });
      if (type === 'Recurring' && (!fields['Day'] || !fields['Recurrence'])) {
        return json(400, { error: 'Recurring events need a day and a recurrence.' });
      }
      if (type === 'Recurring' && fields['Recurrence'] === 'Every other' && !fields['Recurrence Reference Date']) {
        return json(400, { error: 'An "Every other" event needs a reference date to anchor the cycle.' });
      }
      if (type === 'One-off' && !fields['Event Date']) return json(400, { error: 'A one-off event needs a date.' });

      // Force Club + Active; never trust a client-supplied Club.
      const create = await airtableFetch(`${e.baseId}/${e.tableClubEvents}`, {
        token: e.token,
        method: 'POST',
        body: { fields: { ...fields, Club: [clubId], Active: true }, typecast: true },
      });
      if (!create.ok) {
        const reason = create.data?.error?.message || `HTTP ${create.status}`;
        return json(create.status, { error: `Could not add event: ${reason}` });
      }
      return json(200, { ok: true, id: create.data.id });
    }

    case 'update': {
      const { id } = payload;
      const owned = await fetchOwnedEvent(e, id, clubId);
      if (owned.error) return owned.error;
      const fields = sanitize(payload.fields || {}, ALLOWED_EVENT_FIELDS);
      if (Object.keys(fields).length === 0) return json(400, { error: 'No allowed fields supplied' });
      const patch = await airtableFetch(`${e.baseId}/${e.tableClubEvents}/${id}`, {
        token: e.token, method: 'PATCH', body: { fields, typecast: true },
      });
      if (!patch.ok) {
        const reason = patch.data?.error?.message || `HTTP ${patch.status}`;
        return json(patch.status, { error: `Update failed: ${reason}` });
      }
      return json(200, { ok: true, id });
    }

    case 'delete': {
      // Soft-delete (Active=false) so any EventOverrides keyed to it survive and
      // the row can be revived later.
      const { id } = payload;
      const owned = await fetchOwnedEvent(e, id, clubId);
      if (owned.error) return owned.error;
      const patch = await airtableFetch(`${e.baseId}/${e.tableClubEvents}/${id}`, {
        token: e.token, method: 'PATCH', body: { fields: { Active: false } },
      });
      if (!patch.ok) return json(patch.status, { error: 'Delete failed', details: patch.data });
      return json(200, { ok: true, id });
    }

    case 'override': {
      // Create or delete a per-date exception (cancel/edit a single occurrence).
      // The parent event must belong to this club.
      const { eventId, overrideId, remove } = payload;

      if (remove) {
        if (!overrideId) return json(400, { error: 'Missing override id' });
        // Verify the override's parent event is owned before deleting.
        const ovRes = await airtableFetch(`${e.baseId}/${e.tableEventOverrides}/${overrideId}`, { token: e.token });
        if (!ovRes.ok) return json(ovRes.status, { error: 'Override not found' });
        const parentId = ovRes.data.fields?.['Event']?.[0];
        const owned = await fetchOwnedEvent(e, parentId, clubId);
        if (owned.error) return owned.error;
        const del = await airtableFetch(`${e.baseId}/${e.tableEventOverrides}/${overrideId}`, { token: e.token, method: 'DELETE' });
        if (!del.ok) return json(del.status, { error: 'Could not remove override', details: del.data });
        return json(200, { ok: true });
      }

      const owned = await fetchOwnedEvent(e, eventId, clubId);
      if (owned.error) return owned.error;
      const fields = sanitize(payload.fields || {}, ALLOWED_OVERRIDE_FIELDS);
      if (!fields['Date']) return json(400, { error: 'An override needs a date.' });
      if (!fields['Override Type']) return json(400, { error: 'Choose cancel or edit.' });
      const create = await airtableFetch(`${e.baseId}/${e.tableEventOverrides}`, {
        token: e.token, method: 'POST',
        body: { fields: { ...fields, Event: [eventId] }, typecast: true },
      });
      if (!create.ok) {
        const reason = create.data?.error?.message || `HTTP ${create.status}`;
        return json(create.status, { error: `Could not save override: ${reason}` });
      }
      return json(200, { ok: true, id: create.data.id });
    }

    default:
      return json(400, { error: 'Unknown action' });
  }
}
