// Returns club meetings for a rolling window (today → today + 7 days) for the
// landing-page Today/Tomorrow widget. Club-run model: sourced entirely from the
// club's own ClubEvents (recurring + one-offs) with per-date overrides applied.
// Only Active, non-hidden clubs' events appear — no community classes, no MPR.

import { preflight, json, env, CACHE } from './_airtable.js';
import { computeAllClubEvents, todayDenver } from './_events.js';

const WINDOW_DAYS = 7;

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

  const result = await computeAllClubEvents({
    baseId: e.baseId,
    token: e.token,
    tableClubs: e.tableClubs,
    tableClubEvents: e.tableClubEvents,
    tableEventOverrides: e.tableEventOverrides,
    windowStart,
    windowEnd,
  });

  if (!result.ok) {
    return json(result.status || 500, { error: result.error || 'Unknown error' });
  }

  return json(200, { events: result.events, today: todayStr }, { 'Cache-Control': CACHE.EVENTS });
}
