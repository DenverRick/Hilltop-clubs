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

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const e = env();
  if (e.error) return e.error;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS);

  const result = await computeWeekClubEventsFromMpr({
    baseId: e.baseId,
    token: e.token,
    tableClubs: e.tableClubs,
    mprBaseId: MPR_BASE_ID,
    windowStart: today,
    windowEnd,
  });

  if (!result.ok) {
    return json(result.status || 500, { error: result.error || 'Unknown error' });
  }

  // Stamp today's date (YYYY-MM-DD, server-local) so the client can split
  // "today" from "later this week" without timezone drift between server
  // and browser.
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  return json(200, { events: result.events, today: todayStr }, { 'Cache-Control': CACHE.EVENTS });
}
