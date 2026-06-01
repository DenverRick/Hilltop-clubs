// Returns TODAY's events in the Multi-Purpose Room, read straight from the
// MPR wall-display's published Events table — the same source the in-room
// iPad shows. The weekly Calendar app (hilltop-weekly-calendar) is what
// publishes into that base: it applies week-by-week overrides, hides
// cancellations, and filters to MP/Kitchen rooms. So this is the authoritative
// "what's happening in the MPR today" list, and unlike the club schedule it
// includes events that aren't tied to a club record (e.g. Mexican Train
// Dominoes).
//
// Read-only, one Airtable round-trip. Reuses AIRTABLE_TOKEN (must have read
// access to the MPR base). The MPR base lives at appNJgCpn3NJCRC8U
// ("Hilltop Clubhouse"); override with MPR_BASE_ID if it ever moves.

import { preflight, json, env, airtableFetch, CACHE } from './_airtable.js';

const MPR_BASE_ID = process.env.MPR_BASE_ID || 'appNJgCpn3NJCRC8U';
const MPR_EVENTS_TABLE = 'Events';

function timeToMinutes(t) {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(t || '');
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  return h * 60 + parseInt(m[2], 10);
}

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const e = env();
  if (e.error) return e.error;

  // "Today" in the clubhouse's timezone (Mountain), not the server's UTC.
  // en-CA formats as YYYY-MM-DD, matching the Airtable Date field.
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });

  const res = await airtableFetch(`${MPR_BASE_ID}/${MPR_EVENTS_TABLE}`, {
    token: e.token,
    query: { filterByFormula: `AND({Active} = TRUE(), DATESTR({Date}) = '${todayIso}')` },
  });
  if (!res.ok) return json(res.status, { error: 'Airtable MPR fetch failed', details: res.data });

  const events = (res.data.records || [])
    .map((r) => ({
      name: r.fields['Name'] || '',
      startTime: r.fields['Start'] || '',
      endTime: r.fields['End'] || '',
      room: r.fields['Room'] || '',
    }))
    .filter((ev) => ev.name)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  return json(200, { events, date: todayIso }, { 'Cache-Control': CACHE.CLUBS });
}
