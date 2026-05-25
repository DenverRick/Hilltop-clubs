// Returns the list of MeetingSlots that occur THIS calendar week
// (Mon → Sun), mapped to the linked club so the landing page can show a
// "Clubs meeting this week" section. Uses the same recurrence logic as
// the Calendar app at hilltop-weekly-calendar.onrender.com.
//
// One Airtable round-trip for MeetingSlots + one for Clubs (to resolve
// the Club link IDs to slugs/names). Caches at the edge for 5 minutes —
// data only changes when (a) a new Monday rolls over, or (b) an admin
// edits the master schedule.

import { preflight, json, env, airtableFetch, CACHE } from './_airtable.js';

// MeetingSlots lives in the same base as Clubs (appVROkzrYBAvrKmE). The
// table ID is stable; falls back to the env var if you'd rather configure
// it without a code change.
const MEETING_SLOTS_TABLE = process.env.AIRTABLE_TABLE_MEETING_SLOTS || 'tblO3Vg7yoxioywpN';

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getCurrentMondayIso() {
  const d = new Date();
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekDates(weekStartIso) {
  const monday = new Date(weekStartIso + "T12:00:00");
  const map = {};
  DAYS.forEach((d, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    map[d] = date;
  });
  return map;
}

function nthWeekdayOfMonth(date) { return Math.ceil(date.getDate() / 7); }

function isLastWeekdayOfMonth(date) {
  const next = new Date(date);
  next.setDate(date.getDate() + 7);
  return next.getMonth() !== date.getMonth();
}

function occursThisWeek(slot, dates) {
  const date = dates[slot.day];
  if (!date) return false;
  switch (slot.recurrence) {
    case "Weekly":      return true;
    case "1st":         return nthWeekdayOfMonth(date) === 1;
    case "2nd":         return nthWeekdayOfMonth(date) === 2;
    case "3rd":         return nthWeekdayOfMonth(date) === 3;
    case "4th":         return nthWeekdayOfMonth(date) === 4;
    case "Last":        return isLastWeekdayOfMonth(date);
    case "Every other": {
      if (!slot.referenceDate) return true;
      const ref = new Date(slot.referenceDate + "T12:00:00");
      const dow = ref.getDay();
      const refMonday = new Date(ref);
      refMonday.setDate(ref.getDate() - ((dow + 6) % 7));
      const monday = new Date(dates["Mon"]);
      const diffWeeks = Math.round((monday - refMonday) / (7 * 24 * 60 * 60 * 1000));
      return diffWeeks % 2 === 0;
    }
    default: return true;
  }
}

function timeToMinutes(t) {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(t || "");
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  if (m[3].toLowerCase() === "pm" && h !== 12) h += 12;
  if (m[3].toLowerCase() === "am" && h === 12) h = 0;
  return h * 60 + parseInt(m[2], 10);
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const e = env();
  if (e.error) return e.error;

  const [slotsRes, clubsRes] = await Promise.all([
    airtableFetch(`${e.baseId}/${MEETING_SLOTS_TABLE}`, {
      token: e.token,
      query: { filterByFormula: '{Active} = TRUE()' },
    }),
    airtableFetch(`${e.baseId}/${e.tableClubs}`, {
      token: e.token,
      query: { filterByFormula: '{Active} = TRUE()' },
    }),
  ]);
  if (!slotsRes.ok) return json(slotsRes.status, { error: 'Airtable slots fetch failed', details: slotsRes.data });
  if (!clubsRes.ok) return json(clubsRes.status, { error: 'Airtable clubs fetch failed', details: clubsRes.data });

  const clubsById = {};
  for (const r of clubsRes.data.records || []) {
    clubsById[r.id] = {
      name: r.fields['Name'] || '',
      slug: r.fields['Slug'] || '',
      thumbnail: r.fields['Thumbnail Image']?.[0]?.thumbnails?.large?.url || r.fields['Thumbnail Image']?.[0]?.url || '',
    };
  }

  const mondayIso = getCurrentMondayIso();
  const dates = weekDates(mondayIso);
  const events = [];

  for (const r of slotsRes.data.records || []) {
    const f = r.fields;
    const slot = {
      name: f['Event Name'] || '',
      day: f['Day'] || '',
      startTime: f['Start Time'] || '',
      endTime: f['End Time'] || '',
      location: f['Location'] || '',
      recurrence: f['Recurrence'] || 'Weekly',
      referenceDate: f['Recurrence Reference Date'] || null,
      clubLink: f['Club']?.[0] || null,
    };
    if (!occursThisWeek(slot, dates)) continue;
    if (!slot.clubLink) continue;
    const club = clubsById[slot.clubLink];
    if (!club || !club.slug) continue;
    events.push({
      eventName: slot.name,
      day: slot.day,
      date: isoDate(dates[slot.day]),
      startTime: slot.startTime,
      endTime: slot.endTime,
      location: slot.location,
      clubName: club.name,
      clubSlug: club.slug,
      thumbnail: club.thumbnail,
    });
  }

  const DAY_ORDER = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  events.sort((a, b) => {
    const dd = (DAY_ORDER[a.day] ?? 7) - (DAY_ORDER[b.day] ?? 7);
    if (dd) return dd;
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });

  return json(200, { events, weekStart: mondayIso }, { 'Cache-Control': CACHE.CLUBS });
}
