// Returns club meetings grouped by week for the full calendar page, over the
// next N weeks (default 6, Monday-start). Club-run model: all events come from
// the club's own ClubEvents (recurring + one-offs) with per-date overrides
// applied. Club-meetings-only — no community classes, no MPR.

import { preflight, json, env, CACHE } from './_airtable.js';
import { computeCalendarWeeks } from './_events.js';

const DEFAULT_WEEKS = 6;
const MAX_WEEKS = 12;

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const e = env();
  if (e.error) return e.error;

  const raw = parseInt((event.queryStringParameters || {}).weeks, 10);
  const weeks = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), MAX_WEEKS) : DEFAULT_WEEKS;

  const result = await computeCalendarWeeks({
    baseId: e.baseId,
    token: e.token,
    tableClubs: e.tableClubs,
    tableClubEvents: e.tableClubEvents,
    tableEventOverrides: e.tableEventOverrides,
    weeks,
  });

  if (!result.ok) {
    return json(result.status || 500, { error: result.error || 'Unknown error' });
  }

  return json(200, { weeks: result.weeks, today: result.today }, { 'Cache-Control': CACHE.EVENTS });
}
