// Returns club meetings for a rolling window (today → today + 7 days) for the
// landing-page Today/Tomorrow widget. Sourced from ALL rooms (not just the MPR):
// computeWeekClubEventsAllRooms() unions the all-rooms MeetingSlots recurrence
// (overrides/cancellations applied, published-weeks gated — the same engine the
// club pages use) with any one-off events that live only in the published MPR
// "Events" table. Both are name-matched to opted-in clubs, so community classes
// (Yoga, Tai Chi) never appear.

import { preflight, json, env, CACHE } from './_airtable.js';
import { computeWeekClubEventsAllRooms, todayDenver } from './_events.js';

const WINDOW_DAYS = 7;
const MPR_BASE_ID = process.env.MPR_BASE_ID || 'appNJgCpn3NJCRC8U';

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const e = env();
  if (e.error) return e.error;

  // Mountain-time "today", not server/UTC (see CLAUDE.md date invariant).
  const { ymd: todayStr, date: windowStart } = todayDenver();
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowStart.getDate() + WINDOW_DAYS);

  const result = await computeWeekClubEventsAllRooms({
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
