// Shared helper: compute club meeting occurrences from the club-run base.
//
// Club-run model (no "published week" gating): club leaders keep their own
// schedule current in the new base and it shows immediately. Sources, all in
// the same base as Clubs:
//   - ClubEvents     (recurring rules + one-offs, each linked to a Club)
//   - EventOverrides (per-DATE cancel / edit for a specific occurrence)
//
// Output shape (EventRecord) is unchanged from the old engine, so the existing
// rendering and add-to-calendar code reuse cleanly.

import { airtableFetch } from './_airtable.js';
import { expandRecurrence, fmt } from './_recurrence.js';

// Parse a YYYY-MM-DD string as a LOCAL date (avoids the UTC-midnight shift that
// `new Date("2026-06-04")` would introduce, which can land on the wrong day).
function parseLocalDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "Today" in Hilltop's timezone. Netlify Functions run on UTC, so the server
// clock rolls to tomorrow in the evening Mountain time — always derive the
// current date here, never from server-local `new Date()`. See CLAUDE.md.
const TIME_ZONE = 'America/Denver';
export function todayDenver() {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [y, m, d] = ymd.split('-').map(Number);
  return { ymd, date: new Date(y, m - 1, d) };
}

// Whether a club's leader Announcement should currently display. Shows while
// today (America/Denver — never server-local UTC; see CLAUDE.md invariant #5)
// is on or before the optional "Announcement Expires" date. Blank expiry =
// show indefinitely. Empty text = nothing to show.
export function isAnnouncementActive(fields) {
  const text = String(fields['Announcement'] || '').trim();
  if (!text) return false;
  const expires = String(fields['Announcement Expires'] || '').slice(0, 10);
  if (!expires) return true;
  return expires >= todayDenver().ymd; // inclusive: shows through the expiry day
}

// Parse a 12-hour clock string ("9:30 am", "6:00PM") to minutes-since-midnight
// for chronological sorting — string-comparing these puts "9:30 am" after
// "12:30 pm". Blank/unparseable sorts last.
function timeToMinutes(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  return h * 60 + parseInt(m[2], 10);
}
// Sort club events chronologically: by date, then by actual start time.
function byDateThenTime(a, b) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
}

const WINDOW_DAYS = 28;
const MAX_OCCURRENCES = 8;

const DAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayLabel(date) {
  return `${DAY_LABELS_SHORT[date.getDay()]}, ${MONTH_LABELS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

// Monday of the week containing `date`, as YYYY-MM-DD. Used to group the
// calendar page into weeks (the model no longer gates on published weeks).
function weekStartFor(date) {
  const d = new Date(date);
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - offset);
  return fmt(d);
}

/**
 * Compute club meetings across ALL opted-in clubs within a date window.
 * Reads the club-run model: ClubEvents (recurring + one-off, each with a
 * mandatory Club link) and EventOverrides (per-date cancel/edit). No published-
 * week gating — whatever a leader has entered shows.
 *
 * @param {object} args
 * @param {string} args.baseId
 * @param {string} args.token
 * @param {string} args.tableClubs
 * @param {string} args.tableClubEvents
 * @param {string} args.tableEventOverrides
 * @param {Date} args.windowStart
 * @param {Date} args.windowEnd
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, events?: Array }>}
 *   events include a `cancelled` flag (cancelled meetings are kept so the UI
 *   can show them struck-through rather than silently dropping them).
 */
export async function computeAllClubEvents({ baseId, token, tableClubs, tableClubEvents, tableEventOverrides, windowStart, windowEnd }) {
  if (!tableClubEvents || !tableEventOverrides) {
    return { ok: false, status: 500, error: 'ClubEvents/EventOverrides tables not configured' };
  }

  // 1. Allowed clubs: Active and not opted out. Map recordId → {name, slug}.
  const clubsRes = await airtableFetch(`${baseId}/${tableClubs}`, {
    token,
    query: { filterByFormula: `AND({Active} = TRUE(), NOT({Hide Events}))` },
  });
  if (!clubsRes.ok) return { ok: false, status: clubsRes.status, error: 'Airtable error fetching clubs' };
  const clubById = new Map();
  for (const c of clubsRes.data.records || []) {
    clubById.set(c.id, { name: c.fields['Name'] || '', slug: c.fields['Slug'] || '' });
  }
  if (!clubById.size) return { ok: true, events: [] };

  // 2. All active ClubEvents.
  const eventsRes = await airtableFetch(`${baseId}/${tableClubEvents}`, {
    token,
    query: { filterByFormula: `{Active} = TRUE()` },
  });
  if (!eventsRes.ok) return { ok: false, status: eventsRes.status, error: 'Airtable error fetching club events' };
  const clubEvents = eventsRes.data.records || [];

  // 3. Overrides — per-date cancel/edit. Keyed eventId|date (no week gating).
  const overridesRes = await airtableFetch(`${baseId}/${tableEventOverrides}`, { token });
  if (!overridesRes.ok) return { ok: false, status: overridesRes.status, error: 'Airtable error fetching overrides' };
  const overrideMap = new Map(); // eventId|YYYY-MM-DD → fields
  for (const o of overridesRes.data.records || []) {
    const eventId = o.fields['Event']?.[0];
    const date = String(o.fields['Date'] || '').slice(0, 10);
    if (eventId && date) overrideMap.set(`${eventId}|${date}`, o.fields);
  }

  const startStr = fmt(windowStart);
  const endStr = fmt(windowEnd);

  // 4. Expand each event, join its club + overrides.
  const occurrences = [];
  for (const ev of clubEvents) {
    // Club link is mandatory in the club-run model. Skip events whose club is
    // inactive/hidden/missing (don't surface).
    const club = clubById.get(ev.fields['Club']?.[0]);
    if (!club) continue;

    // One-off: a single concrete Event Date. Recurring: expand the rule.
    let dates;
    if (ev.fields['Event Type'] === 'One-off') {
      const d = String(ev.fields['Event Date'] || '').slice(0, 10);
      dates = d && d >= startStr && d <= endStr ? [parseLocalDate(d)] : [];
    } else {
      dates = expandRecurrence(
        {
          day: ev.fields['Day'],
          recurrence: ev.fields['Recurrence'],
          referenceDate: ev.fields['Recurrence Reference Date'],
        },
        windowStart,
        windowEnd
      );
    }

    for (const date of dates) {
      const override = overrideMap.get(`${ev.id}|${fmt(date)}`);
      const cancelled = override?.['Override Type'] === 'Cancel';

      occurrences.push({
        date: fmt(date),
        dayLabel: formatDayLabel(date),
        startTime: override?.['Start Time'] || ev.fields['Start Time'] || '',
        endTime: override?.['End Time'] || ev.fields['End Time'] || '',
        location: override?.['Location'] || ev.fields['Location'] || '',
        note: override?.['Note'] || ev.fields['Default Note'] || '',
        eventName: ev.fields['Event Name'] || club.name,
        clubName: club.name,
        clubSlug: club.slug,
        cancelled,
      });
    }
  }

  occurrences.sort(byDateThenTime);
  return { ok: true, events: occurrences };
}

/**
 * Compute upcoming meeting occurrences for a single club, over a 28-day window.
 * Built on computeAllClubEvents (so it inherits the club-run model).
 *
 * @param {object} args
 * @param {string} args.baseId
 * @param {string} args.token
 * @param {string} args.tableClubs
 * @param {string} args.tableClubEvents
 * @param {string} args.tableEventOverrides
 * @param {object} args.clubRecord - the Airtable record (with .fields.Slug)
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, events?: Array }>}
 */
export async function computeUpcomingEvents({ baseId, token, tableClubs, tableClubEvents, tableEventOverrides, clubRecord }) {
  const slug = clubRecord.fields['Slug'];
  if (!slug) return { ok: true, events: [] };

  // Mountain-time "today", not server/UTC (see CLAUDE.md date invariant).
  const today = todayDenver().date;
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS);

  const all = await computeAllClubEvents({ baseId, token, tableClubs, tableClubEvents, tableEventOverrides, windowStart: today, windowEnd });
  if (!all.ok) return all;

  // Per-club view hides cancelled meetings (the all-clubs feed keeps them for
  // the week grid; a single club's "upcoming" list reads cleaner without them).
  const events = all.events
    .filter((e) => e.clubSlug === slug && !e.cancelled)
    .slice(0, MAX_OCCURRENCES);
  return { ok: true, events };
}

/**
 * Calendar-page source: all club meetings over the next `weeks` weeks, grouped
 * by Monday-start week. The window floor is the Monday of the current week so
 * the page shows the whole current week (including meetings earlier this week).
 *
 * @param {object} args - baseId, token, tableClubs, tableClubEvents, tableEventOverrides
 * @param {number} [args.weeks=6]
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, weeks?: Array, today?: string }>}
 *   weeks: [{ weekStart: 'YYYY-MM-DD', label: 'Jun 22 – Jun 28', events: [...] }]
 */
export async function computeCalendarWeeks({ baseId, token, tableClubs, tableClubEvents, tableEventOverrides, weeks = 6 }) {
  const { ymd: today } = todayDenver();
  const windowStart = parseLocalDate(weekStartFor(todayDenver().date)); // Monday of current week
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + weeks * 7 - 1); // inclusive last day

  const all = await computeAllClubEvents({ baseId, token, tableClubs, tableClubEvents, tableEventOverrides, windowStart, windowEnd });
  if (!all.ok) return all;

  // Pre-seed every week in the window so empty weeks still render a header.
  const byWeek = new Map();
  for (let i = 0; i < weeks; i++) {
    const ws = new Date(windowStart);
    ws.setDate(ws.getDate() + i * 7);
    const wsStr = fmt(ws);
    const wEnd = new Date(ws);
    wEnd.setDate(wEnd.getDate() + 6);
    const label = `${MONTH_LABELS_SHORT[ws.getMonth()]} ${ws.getDate()} – ${MONTH_LABELS_SHORT[wEnd.getMonth()]} ${wEnd.getDate()}`;
    byWeek.set(wsStr, { weekStart: wsStr, label, events: [] });
  }
  for (const ev of all.events) {
    const ws = weekStartFor(parseLocalDate(ev.date));
    const bucket = byWeek.get(ws);
    if (bucket) bucket.events.push(ev);
  }

  const out = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return { ok: true, weeks: out, today };
}
