import { preflight, json, env, airtableFetch, stripSensitive, escapeFormulaString, CACHE } from './_airtable.js';
import { isAnnouncementActive } from './_events.js';

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const { slug, all } = event.queryStringParameters || {};
  const e = env();
  if (e.error) return e.error;

  // If `all=1` is set, return all active clubs (used by landing-page search).
  // Otherwise filter to a single category by its slug, which we look up against
  // the Categories table first to resolve to a Name (Airtable single-selects
  // store the visible name, not the slug, on the Clubs row).
  let filterFormula;
  if (all) {
    filterFormula = `{Active} = TRUE()`;
  } else {
    if (!slug) return json(400, { error: 'Missing slug' });
    const cat = await airtableFetch(`${e.baseId}/${e.tableCategories}`, {
      token: e.token,
      query: { filterByFormula: `{Slug} = '${escapeFormulaString(slug)}'`, maxRecords: '1' },
    });
    if (!cat.ok) return json(cat.status, { error: 'Airtable error', details: cat.data });
    const catRecord = cat.data.records?.[0];
    if (!catRecord) return json(404, { error: 'Category not found' });
    const categoryName = catRecord.fields['Name'];
    filterFormula = `AND({Active} = TRUE(), {Primary Category} = '${escapeFormulaString(categoryName)}')`;
  }

  const { ok, status, data } = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
    query: { filterByFormula: filterFormula, 'sort[0][field]': 'Name', 'sort[0][direction]': 'asc' },
  });
  if (!ok) return json(status, { error: 'Airtable error', details: data });

  const clubs = (data.records || []).map((r) => {
    const safe = stripSensitive(r);
    const f = safe.fields;
    return {
      id: safe.id,
      name: f['Name'] || '',
      slug: f['Slug'] || '',
      category: f['Primary Category'] || '',
      blurb: f['Short Blurb'] || '',
      whatToBring: f['What to Bring'] || '',
      tags: f['Tags'] || [],
      meetingDay: f['Meeting Day'] || '',
      meetingTime: f['Meeting Time'] || '',
      meetingFrequency: f['Meeting Frequency'] || '',
      meetingSchedule: f['Meeting Schedule'] || '',
      thumbnail: f['Thumbnail Image']?.[0]?.thumbnails?.large?.url || f['Thumbnail Image']?.[0]?.url || '',
      // Only surface the announcement on cards while it's active (Denver-date
      // expiry computed server-side); empty string when none/expired.
      announcement: isAnnouncementActive(f) ? String(f['Announcement']).trim() : '',
      lastUpdated: f['Last Updated'] || null,
      createdTime: safe.createdTime || null,
    };
  });
  return json(200, { clubs }, { 'Cache-Control': CACHE.CLUBS });
}
