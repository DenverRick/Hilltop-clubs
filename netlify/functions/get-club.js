import { preflight, json, env, airtableFetch, stripSensitive, escapeFormulaString, CACHE } from './_airtable.js';

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const { slug } = event.queryStringParameters || {};
  if (!slug) return json(400, { error: 'Missing slug' });

  const e = env();
  if (e.error) return e.error;

  const { ok, status, data } = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
    query: {
      filterByFormula: `AND({Slug} = '${escapeFormulaString(slug)}', {Active} = TRUE())`,
      maxRecords: '1',
    },
  });
  if (!ok) return json(status, { error: 'Airtable error', details: data });
  const record = data.records?.[0];
  if (!record) return json(404, { error: 'Club not found' });

  const safe = stripSensitive(record);
  const f = safe.fields;
  const youtubeUrls = (f['YouTube URLs'] || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  return json(200, {
    club: {
      id: safe.id,
      name: f['Name'] || '',
      slug: f['Slug'] || '',
      category: f['Primary Category'] || '',
      leaderName: f['Leader Name(s)'] || f['Leader Name'] || '',
      blurb: f['Short Blurb'] || '',
      description: f['Long Description'] || '',
      tags: f['Tags'] || [],
      meetingFrequency: f['Meeting Frequency'] || '',
      meetingDay: f['Meeting Day'] || '',
      meetingSchedule: f['Meeting Schedule'] || '',
      meetingTime: f['Meeting Time'] || '',
      meetingLocation: f['Meeting Location'] || '',
      memberCount: f['Member Count'] ?? null,
      vibe: f['Vibe / Demographics'] || '',
      whatToBring: f['What to Bring'] || '',
      youtubeUrls,
      thumbnail: f['Thumbnail Image']?.[0]?.thumbnails?.large?.url || f['Thumbnail Image']?.[0]?.url || '',
      website: f['External Website'] || '',
      teamReach: f['TeamReach'] || '',
      hideEvents: f['Hide Events'] || false,
      promoFlyer: f['Promo Flyer']?.[0]?.url || '',
      promoFlyerLarge: f['Promo Flyer']?.[0]?.thumbnails?.large?.url || f['Promo Flyer']?.[0]?.url || '',
      lastUpdated: f['Last Updated'] || null,
      createdTime: safe.createdTime || null,
    },
  }, { 'Cache-Control': CACHE.CLUBS });
}
