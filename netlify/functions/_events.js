// Shared helper: compute upcoming meeting occurrences for a given club record.
// Used by get-club-events.js (public) and leader-draft-email.js (auth-gated).
//
// Sources of truth, all in the same Airtable base as Clubs:
//   - MeetingSlots (recurring rules linked to Clubs)
//   - Weeks        (gated by Status=Published)
//   - WeekOverrides (per-week cancels / overrides)

import { airtableFetch, escapeFormulaString } from './_airtable.js';
import { expandRecurrence, fmt } from './_recurrence.js';

const TABLE_MEETING_SLOTS = 'tblO3Vg7yoxioywpN';
const TABLE_WEEKS = 'tbl2lRvniORa1XTAz';
const TABLE_WEEK_OVERRIDES = 'tblSE0mTSYTSQiHMe';

const WINDOW_DAYS = 28;
const MAX_OCCURRENCES = 8;

const DAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayLabel(date) {
  return `${DAY_LABELS_SHORT[date.getDay()]}, ${MONTH_LABELS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

function weekStartFor(date) {
  const d = new Date(date);
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - offset);
  return fmt(d);
}

/**
 * Compute club meetings across ALL opted-in clubs within a date window.
 * Used by get-week-events.js to power the landing-page "today" widget and
 * the inline week view. Only clubs that are Active AND not Hide Events are
 * included — community events (exercise, music, etc.) are never here because
 * we only walk MeetingSlots whose Club link points to a directory club.
 *
 * @param {object} args
 * @param {string} args.baseId
 * @param {string} args.token
 * @param {string} args.tableClubs
 * @param {Date} args.windowStart
 * @param {Date} args.windowEnd
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, events?: Array }>}
 *   events include a `cancelled` flag (cancelled meetings are kept so the UI
 *   can show them struck-through rather than silently dropping them).
 */
export async function computeAllClubEvents({ baseId, token, tableClubs, windowStart, windowEnd }) {
  // 1. Allowed clubs: Active and not opted out. Map recordId → {name, slug}.
  const clubsRes = await airtableFetch(`${baseId}/${tableClubs}`, {
    token,
    query: {
      filterByFormula: `AND({Active} = TRUE(), NOT({Hide Events}))`,
    },
  });
  if (!clubsRes.ok) return { ok: false, status: clubsRes.status, error: 'Airtable error fetching clubs' };
  const clubById = new Map();
  for (const c of clubsRes.data.records || []) {
    clubById.set(c.id, { name: c.fields['Name'] || '', slug: c.fields['Slug'] || '' });
  }
  if (!clubById.size) return { ok: true, events: [] };

  // 2. All active MeetingSlots.
  const slotsRes = await airtableFetch(`${baseId}/${TABLE_MEETING_SLOTS}`, {
    token,
    query: { filterByFormula: `{Active} = TRUE()` },
  });
  if (!slotsRes.ok) return { ok: false, status: slotsRes.status, error: 'Airtable error fetching slots' };
  const slots = slotsRes.data.records || [];

  // 3. Published weeks in window.
  const weekFloor = new Date(windowStart);
  weekFloor.setDate(weekFloor.getDate() - 7);
  const weeksRes = await airtableFetch(`${baseId}/${TABLE_WEEKS}`, {
    token,
    query: {
      filterByFormula: `AND({Status} = 'Published', IS_AFTER({Week Start}, '${fmt(weekFloor)}'), IS_BEFORE({Week Start}, '${fmt(windowEnd)}'))`,
    },
  });
  if (!weeksRes.ok) return { ok: false, status: weeksRes.status, error: 'Airtable error fetching weeks' };
  const publishedWeekStarts = new Set();
  const weekStartById = new Map();
  (weeksRes.data.records || []).forEach((r) => {
    const ws = r.fields['Week Start'];
    if (ws) { publishedWeekStarts.add(ws); weekStartById.set(r.id, ws); }
  });
  if (!publishedWeekStarts.size) return { ok: true, events: [] };

  // 4. All overrides; keep only those tied to a published week in window.
  const overridesRes = await airtableFetch(`${baseId}/${TABLE_WEEK_OVERRIDES}`, { token });
  if (!overridesRes.ok) return { ok: false, status: overridesRes.status, error: 'Airtable error fetching overrides' };
  const overrideMap = new Map(); // slotId|weekStart → fields
  for (const o of overridesRes.data.records || []) {
    const slotId = o.fields['Slot']?.[0];
    const weekId = o.fields['Week']?.[0];
    if (!slotId || !weekId) continue;
    const ws = weekStartById.get(weekId);
    if (ws) overrideMap.set(`${slotId}|${ws}`, o.fields);
  }

  // 5. Expand each slot, join its club + overrides.
  const occurrences = [];
  for (const slot of slots) {
    const club = clubById.get(slot.fields['Club']?.[0]);
    if (!club) continue; // slot not tied to an opted-in directory club

    const dates = expandRecurrence(
      {
        day: slot.fields['Day'],
        recurrence: slot.fields['Recurrence'],
        referenceDate: slot.fields['Recurrence Reference Date'],
      },
      windowStart,
      windowEnd
    );

    for (const date of dates) {
      const ws = weekStartFor(date);
      if (!publishedWeekStarts.has(ws)) continue;

      const override = overrideMap.get(`${slot.id}|${ws}`);
      const cancelled = override?.['Override Type'] === 'Cancel';

      occurrences.push({
        date: fmt(date),
        dayLabel: formatDayLabel(date),
        startTime: override?.['Start Time'] || slot.fields['Start Time'] || '',
        endTime: override?.['End Time'] || slot.fields['End Time'] || '',
        location: override?.['Location'] || slot.fields['Location'] || '',
        note: override?.['Note'] || slot.fields['Default Note'] || '',
        eventName: slot.fields['Event Name'] || club.name,
        clubName: club.name,
        clubSlug: club.slug,
        cancelled,
      });
    }
  }

  occurrences.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });
  return { ok: true, events: occurrences };
}

/**
 * Compute upcoming meeting occurrences for a club.
 *
 * @param {object} args
 * @param {string} args.baseId
 * @param {string} args.token
 * @param {object} args.clubRecord - the Airtable record (with .id and .fields including Name)
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, events?: Array }>}
 */
export async function computeUpcomingEvents({ baseId, token, clubRecord }) {
  const clubName = clubRecord.fields['Name'];
  if (!clubName) return { ok: true, events: [] };

  // Fetch active MeetingSlots linked to this club.
  const slotsRes = await airtableFetch(`${baseId}/${TABLE_MEETING_SLOTS}`, {
    token,
    query: {
      filterByFormula: `AND(FIND('${escapeFormulaString(clubName)}', ARRAYJOIN({Club})), {Active} = TRUE())`,
    },
  });
  if (!slotsRes.ok) return { ok: false, status: slotsRes.status, error: 'Airtable error fetching slots' };
  const slots = slotsRes.data.records || [];
  if (!slots.length) return { ok: true, events: [] };

  // Date window.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS);

  // Published weeks in window.
  const weekFloor = new Date(today);
  weekFloor.setDate(weekFloor.getDate() - 7);
  const weeksRes = await airtableFetch(`${baseId}/${TABLE_WEEKS}`, {
    token,
    query: {
      filterByFormula: `AND({Status} = 'Published', IS_AFTER({Week Start}, '${fmt(weekFloor)}'), IS_BEFORE({Week Start}, '${fmt(windowEnd)}'))`,
    },
  });
  if (!weeksRes.ok) return { ok: false, status: weeksRes.status, error: 'Airtable error fetching weeks' };
  const publishedWeekStarts = new Set(
    (weeksRes.data.records || [])
      .map((r) => r.fields['Week Start'])
      .filter(Boolean)
  );
  const publishedWeekIdByStart = new Map();
  (weeksRes.data.records || []).forEach((r) => {
    if (r.fields['Week Start']) publishedWeekIdByStart.set(r.fields['Week Start'], r.id);
  });

  // WeekOverrides for our slots.
  const slotIds = slots.map((s) => s.id);
  const overrideRes = await airtableFetch(`${baseId}/${TABLE_WEEK_OVERRIDES}`, {
    token,
    query: {
      filterByFormula: `OR(${slotIds.map((id) => `FIND('${id}', ARRAYJOIN({Slot}))`).join(',')})`,
    },
  });
  if (!overrideRes.ok) return { ok: false, status: overrideRes.status, error: 'Airtable error fetching overrides' };

  const overrideMap = new Map();
  for (const o of overrideRes.data.records || []) {
    const slotIdLinked = o.fields['Slot']?.[0];
    const weekIdLinked = o.fields['Week']?.[0];
    if (!slotIdLinked || !weekIdLinked) continue;
    for (const [start, id] of publishedWeekIdByStart) {
      if (id === weekIdLinked) {
        overrideMap.set(`${slotIdLinked}|${start}`, o.fields);
        break;
      }
    }
  }

  // Expand and merge.
  const occurrences = [];
  for (const slot of slots) {
    const slotFields = slot.fields;
    const dates = expandRecurrence(
      {
        day: slotFields['Day'],
        recurrence: slotFields['Recurrence'],
        referenceDate: slotFields['Recurrence Reference Date'],
      },
      today,
      windowEnd
    );

    for (const date of dates) {
      const wkStart = weekStartFor(date);
      if (!publishedWeekStarts.has(wkStart)) continue;

      const override = overrideMap.get(`${slot.id}|${wkStart}`);
      const overrideType = override?.['Override Type'];
      if (overrideType === 'Cancel') continue;

      const startTime = override?.['Start Time'] || slotFields['Start Time'] || '';
      const endTime = override?.['End Time'] || slotFields['End Time'] || '';
      const location = override?.['Location'] || slotFields['Location'] || '';
      const note = override?.['Note'] || slotFields['Default Note'] || '';
      const slotName = slotFields['Event Name'] || clubName;

      occurrences.push({
        date: fmt(date),
        dayLabel: formatDayLabel(date),
        startTime,
        endTime,
        location,
        note,
        slotName,
      });
    }
  }

  occurrences.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });
  return { ok: true, events: occurrences.slice(0, MAX_OCCURRENCES) };
}
