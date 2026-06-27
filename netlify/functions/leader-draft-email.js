// Leader-driven AI promo email drafter.
//
// Gated by email-match against the club's Leader Email (same posture as
// leader-update.js). Reads the club's blurb/description + next upcoming
// event, prompts Claude to produce a short subject + body, returns them
// as JSON for the form to surface and feed into a mailto link.

import { preflight, json, env, airtableFetch, escapeFormulaString, CACHE, leaderEmailMatches } from './_airtable.js';
import { computeUpcomingEvents } from './_events.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 700;

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildPrompt({
  clubName, blurb, description, leaderName, nextEvent, hasFlyer,
  context, vibe, whatToBring, tags, teamReach, website, memberCount, clubUrl,
}) {
  const eventLine = nextEvent
    ? `Next upcoming meeting: ${nextEvent.dayLabel}${nextEvent.startTime ? ` at ${nextEvent.startTime}` : ''}${nextEvent.location ? ` in ${nextEvent.location}` : ''}${nextEvent.note ? ` — ${nextEvent.note}` : ''}`
    : `No specific upcoming meeting is on the calendar — keep the email about the club itself rather than a single date.`;

  // The leader's own note about THIS email is the most important input — it's
  // the specific hook (speaker, topic, occasion) that nothing in Airtable knows.
  const contextLine = context
    ? `MOST IMPORTANT — what the leader specifically wants this email to be about: ${context}`
    : '';

  return [
    `You're drafting a short promotional email for the leader of ${clubName} at Hilltop at Inspiration (a 55+ active adult community).`,
    `The email goes to current members and potentially-interested residents. Tone: warm, neighborly, concise — feels like a fellow resident writing, not corporate marketing.`,
    ``,
    contextLine,
    ``,
    `Club details to draw on (use what's relevant; don't list them mechanically):`,
    `- One-line blurb: ${blurb || '(none on file)'}`,
    description ? `- Full description: ${description}` : '',
    vibe ? `- Vibe / who comes: ${vibe}` : '',
    whatToBring ? `- What to bring / how to prepare: ${whatToBring}` : '',
    tags ? `- Tags: ${tags}` : '',
    memberCount ? `- Member count: ${memberCount}` : '',
    teamReach ? `- Members coordinate via the TeamReach app, group code ${teamReach}.` : '',
    website ? `- Club's own external website: ${website}` : '',
    clubUrl ? `- The club's page in the Hilltop directory (full details, schedule, flyer): ${clubUrl}` : '',
    eventLine,
    hasFlyer ? `- A promo flyer is on the club's directory page; you may point readers there for more.` : '',
    ``,
    `Rules:`,
    `- Lead with the specific hook above, not a generic greeting. If the leader gave a topic/speaker, that IS the email.`,
    `- Whenever you describe the club or invite readers to learn more, include the club's directory page link above so they can see the full page.`,
    `- Use concrete, club-specific detail. Avoid filler like "we're excited to invite you" or "don't miss out".`,
    `- Only state facts given above — do not invent speakers, topics, dates, or numbers.`,
    `- Sign off from "${leaderName || 'the leadership team'}".`,
    ``,
    `Reply with ONLY a JSON object of this exact shape, no surrounding prose or markdown fences:`,
    `{"subject": "<under 50 chars, specific not generic — do NOT include the club name, it's added automatically>", "body": "<3-4 short paragraphs, under 180 words, plain text with \\n between paragraphs>"}`,
  ].filter(Boolean).join('\n');
}

function parseModelOutput(text) {
  if (!text) return null;
  // Strip code fences if the model added them despite instruction.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.subject === 'string' && typeof parsed.body === 'string') {
      return { subject: parsed.subject.trim(), body: parsed.body.trim() };
    }
  } catch { /* fall through */ }
  return null;
}

export async function handler(event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { slug, submitter_email } = payload;
  if (!slug || !submitter_email) {
    return json(400, { error: 'Missing slug or submitter_email' });
  }
  // Optional free-text hook the leader typed for THIS email. Cap length so a
  // pasted wall of text can't blow up the prompt.
  const context = String(payload.context || '').trim().slice(0, 600);

  const e = env();
  if (e.error) return e.error;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return json(500, { error: 'Server configuration error: ANTHROPIC_API_KEY not set' });
  }

  // 1. Find the club + verify email match.
  const lookup = await airtableFetch(`${e.baseId}/${e.tableClubs}`, {
    token: e.token,
    query: {
      filterByFormula: `{Slug} = '${escapeFormulaString(slug)}'`,
      maxRecords: '1',
    },
  });
  if (!lookup.ok) return json(lookup.status, { error: 'Airtable error', details: lookup.data });
  const clubRecord = lookup.data.records?.[0];
  const leaderEmail = clubRecord?.fields?.['Leader Email'];
  if (!clubRecord || !leaderEmail || !leaderEmailMatches(submitter_email, leaderEmail)) {
    return json(403, { error: 'Email does not match the leader on file for this club.' });
  }

  // 2. Get next upcoming event (if any).
  const eventsResult = await computeUpcomingEvents({
    baseId: e.baseId,
    token: e.token,
    tableClubs: e.tableClubs,
    tableClubEvents: e.tableClubEvents,
    tableEventOverrides: e.tableEventOverrides,
    clubRecord,
  });
  const nextEvent = eventsResult.ok && eventsResult.events.length ? eventsResult.events[0] : null;

  // 3. Build the prompt.
  const fields = clubRecord.fields;
  const promotionPrompt = buildPrompt({
    clubName: fields['Name'] || '',
    blurb: fields['Short Blurb'] || '',
    description: fields['Long Description'] || '',
    leaderName: fields['Leader Name(s)'] || '',
    nextEvent,
    hasFlyer: !!(fields['Promo Flyer'] && fields['Promo Flyer'][0]),
    context,
    vibe: fields['Vibe / Demographics'] || '',
    whatToBring: fields['What to Bring'] || '',
    tags: Array.isArray(fields['Tags']) ? fields['Tags'].join(', ') : (fields['Tags'] || ''),
    teamReach: fields['TeamReach'] || '',
    website: fields['External Website'] || '',
    memberCount: fields['Member Count'] || '',
    clubUrl: `https://hilltopclubs.org/club/${slug}`,
  });

  // 4. Call Anthropic.
  let modelRes;
  try {
    modelRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: promotionPrompt }],
      }),
    });
  } catch (err) {
    return json(503, { error: 'Could not reach drafting service. Please try again in a moment.' }, { 'Cache-Control': CACHE.NEVER });
  }

  const modelText = await modelRes.text();
  let modelData;
  try { modelData = JSON.parse(modelText); } catch { modelData = { raw: modelText }; }

  if (!modelRes.ok) {
    const reason = modelData?.error?.message || `HTTP ${modelRes.status}`;
    return json(modelRes.status, { error: `Drafting failed: ${reason}` }, { 'Cache-Control': CACHE.NEVER });
  }

  // Anthropic Messages API returns content as an array of blocks; the first
  // text block is what we want.
  const textBlock = modelData?.content?.find?.((b) => b.type === 'text');
  const draft = parseModelOutput(textBlock?.text);
  if (!draft) {
    return json(502, { error: 'Drafting service returned an unexpected format. Please try again.' }, { 'Cache-Control': CACHE.NEVER });
  }

  // Prefix the subject with "[Club Name] - ". Strip any club-name prefix the
  // model added anyway so we don't double it up.
  const clubName = fields['Name'] || '';
  if (clubName) {
    const bare = draft.subject.replace(new RegExp(`^\\s*\\[?${escapeRegExp(clubName)}\\]?\\s*[-–:]?\\s*`, 'i'), '').trim();
    draft.subject = `[${clubName}] - ${bare}`;
  }

  return json(200, draft, { 'Cache-Control': CACHE.NEVER });
}
