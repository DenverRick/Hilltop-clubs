// Returns the NEXT upcoming Senior Geeks presentation for the "dynamic
// lightbulb hero" on the Senior Geeks club page. Reads the SEPARATE
// "Senior Geeks" Airtable base (the same data source as hilltopseniorgeeks.org),
// not the Clubs base — so it mirrors get-mpr-today.js: reuse AIRTABLE_TOKEN
// (must have read access to this base) and override the base/table with env
// vars if they ever move.
//
// Read-only. Fails SOFT: on any missing-env / API error it returns
// { next: null } with a 200 so the hero simply shows its static fallback —
// a bad key must never surface an error on the club page.
//
// Record/speaker/date rules are a port of the Senior Geeks site's build.js.

import { preflight, json, airtableFetch, CACHE } from './_airtable.js';

const BASE_ID = process.env.SENIOR_GEEKS_BASE_ID || 'appNqcVDrGn3E733D';
const TABLE_ID = process.env.SENIOR_GEEKS_TABLE_ID || 'tblSPa84vKrEED3NJ';
const UNKNOWN_SPEAKERS = ['Unknown Speaker', 'Speaker (see Airtable)'];

// Date-only Airtable values arrive as midnight UTC — format those in UTC so the
// day matches the calendar date; timed values format in Mountain Time.
function fmtDate(d) {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const tz = dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 ? 'UTC' : 'America/Denver';
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: tz });
}

function speakerOf(f) {
  let speaker = 'Unknown Speaker';
  if (f['Speaker Name'] && typeof f['Speaker Name'] === 'string') {
    speaker = f['Speaker Name'];
  } else if (f.Speaker) {
    if (typeof f.Speaker === 'string') {
      speaker = f.Speaker;
    } else if (Array.isArray(f.Speaker) && f.Speaker.length > 0) {
      const first = f.Speaker[0];
      if (typeof first === 'string') speaker = f['Speaker Name'] || 'Speaker (see Airtable)';
      else if (first.name) speaker = first.name;
      else speaker = first;
    } else if (typeof f.Speaker === 'object' && f.Speaker.name) {
      speaker = f.Speaker.name;
    }
  } else if (f['Presenter Name']) {
    speaker = f['Presenter Name'];
  } else if (f.Presenter) {
    if (typeof f.Presenter === 'string') {
      speaker = f.Presenter;
    } else if (Array.isArray(f.Presenter)) {
      const first = f.Presenter[0];
      speaker = typeof first === 'string' ? first : first.name || first;
    }
  }
  return UNKNOWN_SPEAKERS.includes(speaker) ? null : speaker;
}

// Pull every record (Airtable paginates 100-per-page via `offset`).
async function fetchAll(token) {
  const all = [];
  let offset;
  do {
    const query = offset ? { offset } : undefined;
    const res = await airtableFetch(`${BASE_ID}/${TABLE_ID}`, { token, query });
    if (!res.ok) return null;
    all.push(...(res.data.records || []));
    offset = res.data.offset;
  } while (offset);
  return all;
}

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return json(200, { next: null }, { 'Cache-Control': CACHE.EVENTS });

  let records;
  try {
    records = await fetchAll(token);
  } catch {
    records = null;
  }
  if (!records) return json(200, { next: null }, { 'Cache-Control': CACHE.EVENTS });

  // Valid presentation: not an Idea, has a title and a date.
  const valid = records
    .map((r) => {
      const f = r.fields || {};
      if (f['Pipeline_Status'] === 'Idea') return null;
      const title = f.Title || f.Name;
      const date = f.Date || f['Presentation Date'];
      if (!title || !date) return null;
      return { title, date, speaker: speakerOf(f) };
    })
    .filter(Boolean);

  // "Next upcoming" = earliest whose start + 1h is still in the future.
  const now = Date.now();
  const next = valid
    .filter((p) => new Date(p.date).getTime() + 3600000 >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  if (!next) return json(200, { next: null }, { 'Cache-Control': CACHE.EVENTS });

  return json(
    200,
    { next: { dateLabel: fmtDate(next.date), title: next.title, speaker: next.speaker || null } },
    { 'Cache-Control': CACHE.EVENTS }
  );
}
