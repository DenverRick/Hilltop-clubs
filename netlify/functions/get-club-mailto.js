import { preflight, json, env, airtableFetch, escapeFormulaString, CACHE } from './_airtable.js';

// Returns a mailto: URL for a given club, only on explicit user click.
// The Leader Email is resolved server-side and embedded into the mailto string.
// We do NOT include it in any list/detail response, so it is never exposed to
// passive page loads or scrapers — only at the moment a resident taps the
// "I'm interested" button.

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

  const f = record.fields || {};
  const leaderEmail = f['Leader Email'];
  const leaderName = f['Leader Name(s)'] || f['Leader Name'] || 'there';
  const clubName = f['Name'] || 'this club';
  if (!leaderEmail) return json(404, { error: 'No leader contact on file for this club' });

  const subject = `Interested in ${clubName} at Hilltop`;
  const body = `Hi ${leaderName},\n\nI live at Hilltop and saw your club in the directory — I'd love to learn more about how to get involved.\n\nThanks!\n`;
  const mailto = `mailto:${encodeURIComponent(leaderEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  // Privacy-sensitive — never cache. Each click resolves the leader email
  // freshly and emits a one-shot mailto, ensuring deactivated leaders or
  // updated addresses propagate immediately.
  return json(200, { mailto }, { 'Cache-Control': CACHE.NEVER });
}
