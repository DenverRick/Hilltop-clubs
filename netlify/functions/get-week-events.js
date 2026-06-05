// Returns club meetings for a rolling window (today → today + 7 days),
// sourced from the Calendar app's published MPR "Events" table and name-matched
// to opted-in directory clubs. Powers the landing-page Today/Tomorrow widget.
//
// We read the materialized Events table (not the MeetingSlots recurrence)
// because it already reflects per-week overrides, one-off events, and
// cancellations exactly as published. Community events never appear — they
// don't name-match any directory club.

import { preflight, json, env, CACHE } from './_airtable.js';
import { computeWeekClubEventsFromMpr } from './_events.js';

const WINDOW_DAYS = 7;
const MPR_BASE_ID = process.env.MPR_BASE_ID || 'appNJgCpn3NJCRC8U';
const TIME_ZONE = 'America/Denver';

// "Today" must be the Hilltop (Mountain) calendar date, not the server's UTC
// date. Netlify runs on UTC, so in the evening Mountain time the server would
// otherwise roll to tomorrow and show the wrong day's events.
function denverYMD() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const e = env();
  if (e.error) return e.error;

  const todayStr = denverYMD();           // e.g. "2026-06-04" (Mountain)
  const [y, m, d] = todayStr.split('-').map(Number);
  const windowStart = new Date(y, m - 1, d);          // local midnight, Denver date
  const windowEnd = new Date(y, m - 1, d + WINDOW_DAYS);

  const result = await computeWeekClubEventsFromMpr({
    baseId: e.baseId,
    token: e.token,
    tableClubs: e.tableClubs,
    mprBaseId: MPR_BASE_ID,
    windowStart,
    windowEnd,
  });

  if (!result.ok) {
    return json(result.status || 500, { error: result.error || 'Unknown error' });
  }

  return json(200, { events: result.events, today: todayStr }, { 'Cache-Control': CACHE.EVENTS });
}
