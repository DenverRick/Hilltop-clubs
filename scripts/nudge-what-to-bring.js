// One-off outreach script: nudge opted-in club leaders whose "What to
// Bring" field is empty. Prints a personalized mailto: link per club so
// you (Rick) can click each one and review/send the draft from your own
// mail client. Mirrors the existing outreach pattern — no SMTP, no
// bulk-send, no leaked emails.
//
// Usage: needs AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_CLUBS
// in the environment. Easiest paths:
//
//   1. If you have a local .env (e.g. from `netlify link` + manual setup):
//        node --env-file=.env scripts/nudge-what-to-bring.js
//
//   2. Inline, sourced from Netlify dashboard / your password manager:
//        AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=appVROk... \
//          AIRTABLE_TABLE_CLUBS=tbl72PM... \
//          node scripts/nudge-what-to-bring.js
//
//   3. From a linked Netlify project (CLI v25+):
//        netlify env:list --plain   # peek
//        netlify env:get AIRTABLE_TOKEN   # fetch one
//
// Exits 0 on success, non-zero on missing env or Airtable error.

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_CLUBS = process.env.AIRTABLE_TABLE_CLUBS;
const SITE = process.env.PUBLIC_SITE_URL || 'https://hilltopclubs.org';

if (!TOKEN || !BASE_ID || !TABLE_CLUBS) {
  console.error('Missing env. Need AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_CLUBS.');
  console.error('Run: netlify env:pull && node --env-file=.env scripts/nudge-what-to-bring.js');
  process.exit(1);
}

// Airtable REST: paginate through Clubs, filtering server-side to
// Active=true AND a blank "What to Bring". BLANK() handles both empty
// strings and unset fields. Encoding the formula safely matters because
// it goes into a URL query param.
async function fetchClubsNeedingNudge() {
  const filter = `AND({Active} = TRUE(), {What to Bring} = BLANK())`;
  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_CLUBS}`);
  url.searchParams.set('filterByFormula', filter);
  url.searchParams.set('sort[0][field]', 'Name');
  url.searchParams.set('sort[0][direction]', 'asc');

  const all = [];
  let offset;
  do {
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable ${res.status}: ${body}`);
    }
    const data = await res.json();
    all.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return all;
}

// One leader, one email. Tone: friendly, brief, concrete example so they
// know what to write. The mailto: body is URL-encoded with %0A for line
// breaks. Most mail clients render this fine; Rick can still tweak each
// draft before sending.
function buildMailto({ leaderName, leaderEmail, clubName, clubSlug }) {
  const firstName = (leaderName || '').split(/[\s&,]/)[0] || 'there';
  const lines = [
    `Hi ${firstName},`,
    '',
    `Quick favor — we added a new "What to Bring" field on the clubs directory for first-time attendees. It now shows as a one-line hint on the club cards so newcomers know what to expect (e.g. "Just show up — we\'ll have extra paddles" or "Bring $10 buy-in and a deck of cards").`,
    '',
    `Could you take a minute to fill it in for ${clubName}? Visit ${SITE}/admin/leader, pick your club from the dropdown, and add the line. Your email (${leaderEmail}) is the one on file, so it\'ll let you in.`,
  ];
  if (clubSlug) {
    lines.push('', `You can see your current listing at ${SITE}/club/${clubSlug}.`);
  }
  lines.push('', 'Thanks!', 'Rick');
  const body = lines.join('\n');

  const subject = `Quick favor for your ${clubName} listing on hilltopclubs.org`;
  return `mailto:${encodeURIComponent(leaderEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function main() {
  const records = await fetchClubsNeedingNudge();
  if (!records.length) {
    console.log('No active clubs are missing a "What to Bring" entry. Nothing to nudge. 🎉');
    return;
  }

  console.log(`${records.length} active club(s) need a "What to Bring" nudge.\n`);
  console.log('Click each mailto link below to open a draft in your mail client.');
  console.log('Review, tweak, and send. (Cmd+click in most terminals.)\n');

  records.forEach((r, i) => {
    const f = r.fields || {};
    const clubName = f['Name'] || '(unnamed)';
    const clubSlug = f['Slug'] || '';
    const leaderName = f['Leader Name(s)'] || '';
    const leaderEmail = f['Leader Email'] || '';
    if (!leaderEmail) {
      console.log(`[${i + 1}/${records.length}] ${clubName} — ⚠️  no Leader Email on record, skipping`);
      console.log('');
      return;
    }
    const link = buildMailto({ leaderName, leaderEmail, clubName, clubSlug });
    console.log(`[${i + 1}/${records.length}] ${clubName}`);
    console.log(`        Leader: ${leaderName || '(none)'} <${leaderEmail}>`);
    console.log(`        ${link}`);
    console.log('');
  });
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
