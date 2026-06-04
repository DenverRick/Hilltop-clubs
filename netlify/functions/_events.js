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
