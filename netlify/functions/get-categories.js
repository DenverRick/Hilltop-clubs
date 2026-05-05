import { preflight, json, env, airtableFetch } from './_airtable.js';

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const e = env();
  if (e.error) return e.error;

  const { ok, status, data } = await airtableFetch(`${e.baseId}/${e.tableCategories}`, {
    token: e.token,
    query: { 'sort[0][field]': 'Sort Order', 'sort[0][direction]': 'asc' },
  });
  if (!ok) return json(status, { error: 'Airtable error', details: data });

  const categories = (data.records || []).map((r) => ({
    id: r.id,
    name: r.fields['Name'] || '',
    slug: r.fields['Slug'] || '',
    icon: r.fields['Icon'] || '',
    description: r.fields['Short Description'] || '',
    sortOrder: r.fields['Sort Order'] ?? 999,
  }));
  return json(200, { categories });
}
