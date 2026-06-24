// Returns the Club Newsletter content for /newsletter:
//   - blocks: the Newsletter table rows (Active, sorted by Sort Order) — each
//     either an authored Markdown block or an auto placeholder (Club Events /
//     Club Flyers / Announcements) the page fills from live data.
//   - clubFlyers: Active clubs that have a Promo Flyer (the "one-pager for the
//     newsletter") — name, slug, flyer image URL.
//   - announcements: Active clubs whose Announcement is currently showing.
// Leader Email is never read here.

import { preflight, json, env, airtableFetch, CACHE } from './_airtable.js';
import { isAnnouncementActive, isFlyerActive } from './_events.js';

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const e = env();
  if (e.error) return e.error;
  if (!e.tableNewsletter) return json(500, { error: 'Newsletter table not configured' });

  // 1. Newsletter blocks (active), sorted by Sort Order ascending.
  const blocksRes = await airtableFetch(`${e.baseId}/${e.tableNewsletter}`, {
    token: e.token,
    query: { filterByFormula: `{Active} = TRUE()` },
  });
  if (!blocksRes.ok) return json(blocksRes.status, { error: 'Airtable error', details: blocksRes.data });
  const blocks = (blocksRes.data.records || []).map((r) => ({
    id: r.id,
    title: r.fields['Title'] || '',
    type: r.fields['Type'] || 'Markdown',
    body: r.fields['Body'] || '',
    sortOrder: r.fields['Sort Order'] ?? 9999,
    images: (r.fields['Images'] || []).map((a) => a.thumbnails?.large?.url || a.url).filter(Boolean),
  })).sort((a, b) => a.sortOrder - b.sortOrder);

  // 2. Clubs → promo flyers + active announcements. Fetch ALL clubs (not just
  //    Active): flyers are gated by their own "Flyer Active" toggle + expiry
  //    (isFlyerActive — a flyer can run before a club is publicly launched),
  //    while announcements still show only for Active clubs. Hide Events only
  //    suppresses dated meeting lists, not flyers/announcements.
  const clubsRes = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
  });
  if (!clubsRes.ok) return json(clubsRes.status, { error: 'Airtable error', details: clubsRes.data });
  const clubFlyers = [];
  const announcements = [];
  for (const r of clubsRes.data.records || []) {
    const f = r.fields;
    const name = f['Name'] || '';
    const slug = f['Slug'] || '';
    if (isFlyerActive(f)) {
      const flyer = f['Promo Flyer'][0];
      clubFlyers.push({ name, slug, flyerUrl: flyer.thumbnails?.large?.url || flyer.url || '' });
    }
    if (f['Active'] && isAnnouncementActive(f)) announcements.push({ name, slug, text: String(f['Announcement']).trim() });
  }
  clubFlyers.sort((a, b) => a.name.localeCompare(b.name));
  announcements.sort((a, b) => a.name.localeCompare(b.name));

  return json(200, { blocks, clubFlyers, announcements }, { 'Cache-Control': CACHE.EVENTS });
}
