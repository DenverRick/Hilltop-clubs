// Returns upcoming meetings for a single club, expanded from the Calendar
// app's recurring MeetingSlots and adjusted for any WeekOverrides (cancels /
// per-week changes) in published weeks.
//
// All compute is delegated to _events.js so leader-draft-email.js can share
// the same logic when picking "next upcoming event" for the AI prompt.

import { preflight, json, env, airtableFetch, escapeFormulaString, CACHE } from './_airtable.js';
import { computeUpcomingEvents } from './_events.js';

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const { slug } = event.queryStringParameters || {};
  if (!slug) return json(400, { error: 'Missing slug' });

  const e = env();
  if (e.error) return e.error;

  const clubRes = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
    query: {
      filterByFormula: `AND({Slug} = '${escapeFormulaString(slug)}', {Active} = TRUE())`,
      maxRecords: '1',
    },
  });
  if (!clubRes.ok) return json(clubRes.status, { error: 'Airtable error', details: clubRes.data });
  const clubRecord = clubRes.data.records?.[0];
  if (!clubRecord) return json(404, { error: 'Club not found' });

  // Opt-out: return empty event list immediately.
  if (clubRecord.fields['Hide Events']) {
    return json(200, { events: [] }, { 'Cache-Control': CACHE.EVENTS });
  }

  const result = await computeUpcomingEvents({
    baseId: e.baseId,
    token: e.token,
    tableClubs: e.tableClubs,
    clubRecord,
  });

  if (!result.ok) {
    return json(result.status || 500, { error: result.error || 'Unknown error' });
  }

  return json(200, { events: result.events }, { 'Cache-Control': CACHE.EVENTS });
}
