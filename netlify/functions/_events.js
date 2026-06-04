// Shared helper: compute upcoming meeting occurrences for a given club record.
// Used by get-club-events.js (public) and leader-draft-email.js (auth-gated).
//
// Sources of truth, all in the same Airtable base as Clubs:
//   - MeetingSlots (recurring rules linked to Clubs)
//   - Weeks        (gated by Status=Published)
//   - WeekOverrides (per-week cancels / overrides)

import { airtableFetch } from './_airtable.js';
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

// --- Name matching --------------------------------------------------------
// Most MeetingSlots don't carry an explicit Club link, so we fall back to
// matching the slot's name to a club by significant words — mirroring the
// Calendar app's club-match.js. Tokens drop punctuation and filler words
// ("club", "the", "class", "group").
const FILLER = new Set(['club', 'the', 'class', 'group', 'a', 'of', 'and']);
function nameTokens(name) {
  return new Set(
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !FILLER.has(t))
  );
}
function isSubset(small, big) {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}
// Build a name index over the opted-in clubs.
function buildClubIndex(clubs) {
  return clubs.map((c) => ({ ...c, tokens: nameTokens(c.name) }));
}
// Resolve an event name to one opted-in club. Exact token-set match wins;
// otherwise a unique club whose distinctive words are all contained in the
// event name (e.g. "Social Bridge" → "Bridge Club"). Ambiguous → null.
function matchClubByName(eventName, clubIndex) {
  const ev = nameTokens(eventName);
  if (!ev.size) return null;
  const key = [...ev].sort().join(' ');
  // 1. exact token-set equality
  for (const c of clubIndex) {
    if (c.tokens.size && [...c.tokens].sort().join(' ') === key) return c;
  }
  // 2. unique club whose tokens ⊆ event tokens
  const subs = clubIndex.filter((c) => c.tokens.size && isSubset(c.tokens, ev));
  if (subs.length === 1) return subs[0];
  return null;
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
  const clubList = [];
  for (const c of clubsRes.data.records || []) {
    const club = { name: c.fields['Name'] || '', slug: c.fields['Slug'] || '' };
    clubById.set(c.id, club);
    clubList.push(club);
  }
  if (!clubById.size) return { ok: true, events: [] };
  const clubIndex = buildClubIndex(clubList);

  // 2. All active MeetingSlots.
  const slotsRes = await airtableFetch(`${baseId}/${TABLE_MEETING_SLOTS}`, {
    token,
    query: { filterByFormula: `{Active} = TRUE()` },
  });
  if (!slotsRes.ok) return { ok: false, status: slotsRes.status, error: 'Airtable error fetching slots' };
  const slots = slotsRes.data.records || [];

  // 3. Published weeks only. A published week is the finalized view — all its
  //    overrides (cancellations, room/time changes, one-offs) are baked in.
  //    Unpublished/draft weeks are excluded so the directory never shows a
  //    meeting that hasn't been reviewed (e.g. one that's actually cancelled
  //    but not yet marked). The recurring schedule still comes from
  //    MeetingSlots; publish status just gates which weeks are shown.
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

  // 4. Overrides — cancellations and per-week changes, applied where present.
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
    // Resolve the slot's club: explicit Club link first, else name-match the
    // slot's Event Name against the opted-in clubs. Slots that match neither
    // (community classes like Yoga, Tai Chi) are skipped.
    let club = clubById.get(slot.fields['Club']?.[0]);
    if (!club) club = matchClubByName(slot.fields['Event Name'], clubIndex);
    if (!club) continue;

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
      if (!publishedWeekStarts.has(ws)) continue; // only finalized weeks

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
 * Compute upcoming meeting occurrences for a single club, over a 28-day
 * window. Built on top of computeAllClubEvents so it inherits the same
 * link-or-name-match resolution — a club whose MeetingSlot has no explicit
 * Club link still gets its meetings via name matching.
 *
 * @param {object} args
 * @param {string} args.baseId
 * @param {string} args.token
 * @param {string} args.tableClubs
 * @param {object} args.clubRecord - the Airtable record (with .fields.Slug)
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, events?: Array }>}
 */
export async function computeUpcomingEvents({ baseId, token, tableClubs, clubRecord }) {
  const slug = clubRecord.fields['Slug'];
  if (!slug) return { ok: true, events: [] };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS);

  const all = await computeAllClubEvents({ baseId, token, tableClubs, windowStart: today, windowEnd });
  if (!all.ok) return all;

  // Per-club view hides cancelled meetings (the all-clubs feed keeps them for
  // the week grid; a single club's "upcoming" list reads cleaner without them).
  const events = all.events
    .filter((e) => e.clubSlug === slug && !e.cancelled)
    .slice(0, MAX_OCCURRENCES);
  return { ok: true, events };
}
