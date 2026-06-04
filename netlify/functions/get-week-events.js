// Returns club meetings for a rolling window (today → today + 7 days) across
// all opted-in clubs. Powers the landing-page "Clubs meeting today" widget
// and the inline "This week's club events" section.
//
// Club events only — community events (exercise classes, music, etc.) never
// appear here, because computeAllClubEvents only walks MeetingSlots whose
// Club link points to an Active, non-hidden directory club.

import { preflight, json, env, CACHE } from './_airtable.js';
import { computeAllClubEvents } from './_events.js';

const WINDOW_DAYS = 7;

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

  const result = await computeAllClubEvents({
    baseId: e.baseId,
    token: e.token,
    tableClubs: e.tableClubs,
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
