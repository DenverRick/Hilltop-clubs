# Hilltop Clubs Directory — Handoff (2026-05-06)

A snapshot of where the project stands. Pair with [CLAUDE.md](./CLAUDE.md) (durable architecture/conventions) — this file decays over time, that one shouldn't.

## Status

**Phase 1 MVP is live** at **[hilltopclubs.org](https://hilltopclubs.org)** with a valid Let's Encrypt cert. Code on GitHub at [DenverRick/HIlltop-clubs](https://github.com/DenverRick/HIlltop-clubs); Netlify auto-deploys from `main`.

What's working end-to-end:
- Landing page: opt-in note + stats → **Featured this week** (3-card weekly rotation) → category grid (8 colored cards with live counts) → **Search clubs** (single search input with inline results)
- Category pages with **day filter chips** (Mon–Sun + All), client-side
- Club detail page: banner, eyebrow category link, meeting info strip (incl. free-text Meeting Schedule override), vibe callout, embedded YouTube, TeamReach code, leader/members/tags footer, "I'm interested" + "Visit website" buttons
- **Print-friendly** club detail page (Cmd+P strips chrome, emphasizes meeting info + leader)
- **"I'm interested"** opens the resident's mail client with a pre-filled message; leader email resolved server-side per click; never appears in static HTML or list responses
- **Leader self-service** form at `/admin/leader` with email-match auth; allowlisted fields only
- Sitewide footer link: **"Suggest a club or report a correction"** → mailto Rick

## Recent additions (2026-05-06)

- **Featured this week** — 3 cards, deterministic weekly rotation by id-sorted index. Every active club gets a turn over time. All visitors see the same set in any given week.
- **"Updated" chip** — green pill on cards whose `Last Updated` is within 14 days. Replaces the old "New" chip; signals an actively maintained listing rather than just a new addition.
- **Meeting cadence text on cards** — shows `Meeting Schedule` (or `Meeting Day`) + " at " + `Meeting Time`. E.g. "3rd Wednesday each month at 10:00AM" for Senior Geeks. No date math, no chip; specific upcoming dates live on each club's external website.
- **Day filter chips** on category pages — chips only render for days that have at least one matching club.
- **Search moved to bottom** of landing page — results render inline below the input. Featured + categories rows hide during an active search.
- **`Next Meeting` (Date)** field added to Airtable + leader form + API — currently unused by the rendering, but available for future logic.

## Where we are with content

Dayna Grober (Hilltop Management) sent the **full 2026 Hilltop Club List PDF** on 2026-05-05 (`Club List 2026 WITH CONTACTS 5.01.26.pdf` — local only, not committed). Contains all 47 clubs with leader contacts.

**Per Dayna, launch is opt-in.** Rick emails each leader; leaders reply YES; only then does the row go Active.

Airtable status:
- **5 Active clubs** (visible on the site): Tennis, Senior Geeks, Hiking, Hilltop University without Walls, Pickleball.
- **42 staged clubs** (Active=false, Leader Email blank — invisible to public). Pre-populated from the PDF with: Name, Slug, Primary Category, Leader Name(s), Short Blurb, meeting fields where stated, TeamReach code where listed.

**Categories:** 8 buckets — Sports & Fitness, Games & Cards, Arts & Crafts, Civic, Learning & Discussion, Social & Cultural, Service & Volunteer, Special Interests / Hobbies. (*Music & Performing Arts* dropped 2026-05-05 — no clubs; *Civic* added.)

## Outstanding work

### Immediate
- **Send the leader outreach email** (draft at `outreach-email.md`, local only). Get Dayna's sign-off on the draft before sending.
- **Per opt-in YES**: open the row in Airtable, paste in **Leader Email**, check **Active**. Site picks it up immediately.
- **Per opt-in YES that wants to enhance**: send the leader the link to `/admin/leader` for long description, vibe, TeamReach (if not yet captured), photo, videos.

### Data gaps to fill
- **Three active clubs have no meeting fields populated**: Tennis, Hiking, Pickleball. Their cards show no meeting line. Add `Meeting Schedule` (or `Meeting Day` + `Meeting Time`) to surface meeting info.
- **Senior Geeks slug is `Science & Technology`** — non-URL-safe and doesn't match name. Worth fixing in Airtable.

### Once leaders start opting in
- Scan the existing physical 3-ring binder in the clubhouse for richer per-club content (long descriptions, photos). Rick to scan; add manually or via Airtable MCP.
- Consider activating select rows yourself for clubs whose leaders go silent but whose info is already public — only with prior agreement that this is acceptable. Default is wait for explicit opt-in.

### Code/config still pending
- **Review the admin pages** (`admin-management.html` and `admin-leader.html`) — Rick wants to walk through these in the app before launch and decide what (if anything) needs polish. Captured 2026-05-06.
- **Management form embed** — `admin-management.html` has a placeholder iframe `src`. Lower priority now that opt-in is the workflow; keep as a back-office tool for Rick.
- **`Next Meeting` field** is wired through but unused by the UI. Leave in place or repurpose — harmless either way.

## Key references

| Thing | Value |
|---|---|
| Repo | https://github.com/DenverRick/HIlltop-clubs |
| Live URL | https://hilltopclubs.org |
| Netlify subdomain | https://hilltop-clubs.netlify.app (kept; primary is the custom domain) |
| Airtable base ID | `appVROkzrYBAvrKmE` |
| Airtable table — Clubs | `tbl72PMwBEukHfcme` |
| Airtable table — Categories | `tblRQpEMTkqlI73xZ` |
| Airtable workspace | "Hilltop Clubs" |
| Source-of-truth PDF | `Club List 2026 WITH CONTACTS 5.01.26.pdf` (local, not committed) |
| Outreach email draft | `outreach-email.md` (local, not committed) |

Netlify env vars (must be set on the Netlify site):
- `AIRTABLE_TOKEN`
- `AIRTABLE_BASE_ID` = `appVROkzrYBAvrKmE`
- `AIRTABLE_TABLE_CLUBS` = `tbl72PMwBEukHfcme`
- `AIRTABLE_TABLE_CATEGORIES` = `tblRQpEMTkqlI73xZ`

## Locked decisions (record so we don't relitigate)

- **Vanilla JS only** in the browser.
- **Email "I'm interested" via `mailto:`**, not a Resend/SendGrid relay. Leader email resolved server-side per click.
- **Leader auth = email-match.** Server compares case-insensitively. No magic links, no review queue.
- **8 categories**, with *Civic* replacing *Music & Performing Arts* as of 2026-05-05.
- **Opt-in launch model** per Dayna: leaders must reply YES before their club is Active. Site displays an opt-in disclaimer.
- **Vibe / Demographics is free-text**, no gender or age breakdown fields.
- **Residents-only by social convention**, not auth.
- **Two-role admin model:** Rick (operating as management for now) adds/activates rows; leaders enhance via `/admin/leader`.
- **Meeting Schedule** (free-text) overrides Frequency + Day for irregular patterns. Card meeting line uses `Meeting Schedule` first, falling back to `Meeting Day`, with `Meeting Time` appended via " at ".
- **No view counters / analytics on cards.** Discouraged after discussion 2026-05-06: bad for community dynamics in a small population. If interest signals are needed later, log mailto-clicks privately for Rick, not public counters.
- **No date-based "next meeting" chip.** Decided 2026-05-06 to show the cadence text instead — specific dates live on each club's external website.
- **Featured row rotates weekly**, not by recency. Deterministic so all visitors agree.
- **TeamReach code** field surfaces in the club footer.
- **Dayna confirmed** the binder (clubhouse 3-ring binder of club info) is fine to draw from — content there was authored by club leaders and is fair game.

## Critical security invariants (do not violate)

1. **Never expose `Leader Email` to the browser.** All read functions strip it via `stripSensitive()`. Only `get-club-mailto.js` reads it on the way out, and only on explicit click.
2. **Airtable token never in browser code.** All Airtable access through Netlify functions.
3. **Leader updates server-side gated by email-match.** `leader-update.js` uses an allowlist; on mismatch returns generic 403.

## File map

```
/                       → index.html (landing)
/category/:slug         → category.html
/club/:slug             → club.html
/admin/management       → admin-management.html (Airtable form embed — placeholder)
/admin/leader           → admin-leader.html (leader self-service form)
api-client.js           → window.ClubsAPI wrapper
styles.css              → all styles, single file (incl. @media print rules for club page)
netlify/functions/
  _airtable.js          → shared helpers, including stripSensitive()
  get-categories.js
  get-clubs-by-category.js   (also serves ?all=1 for landing search + counts)
  get-club.js
  get-club-mailto.js
  leader-update.js
```

## Phase 2 wishlist (deferred)

- Calendar/agenda view of all club meeting times (single page, chronological)
- "Interest Submissions" logging table for analytics on which clubs get clicks (private to Rick, not surfaced on cards)
- Filter category pages by frequency / tags (day chips already shipped)
- Per-club analytics (interest clicks, last-updated freshness)
- Better admin dashboard with deactivate-club toggle
- Photo galleries (multiple attachments)
- "Stale content" admin view — list of clubs whose Last Updated is >6 months old, to nudge leaders
- Bulk-activate UI for waves of opt-ins

## Recent timeline

- **2026-05-05 morning**: Met with Dayna; confirmed scope and management workflow.
- **2026-05-05 afternoon**: Dayna sent the full club list PDF; agreed on opt-in model with Stacey + Dayna; staged 42 clubs in Airtable Active=false; replaced Music category with Civic; added opt-in disclaimer to landing page; drafted leader outreach email.
- **2026-05-05 evening**: Landing-page redesign (slim search-first hero, color-themed category cards, cream "Recently updated" cards). Header centered + larger; back-to-landing rendered as pill button on category and club pages. Custom domain `hilltopclubs.org` registered via Cloudflare and pointed at Netlify (DNS-only, A record at apex), Let's Encrypt cert issued.
- **2026-05-06**: Round of feature work. Added day filter chips on category pages, print stylesheet for club page, sitewide "Suggest/Report" footer mailto, "Updated" chip (replacing "New") tied to `lastUpdated` within 14 days. Replaced the date-based meeting chip with cadence text ("3rd Wednesday each month at 10:00AM"). Featured row became a deterministic weekly rotation. Search consolidated to a single input at the bottom of the landing page with inline results. CLAUDE.md schema updated to include `Meeting Schedule`, `Next Meeting`, `TeamReach`.
