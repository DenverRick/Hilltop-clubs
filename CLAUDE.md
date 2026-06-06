# Hilltop Clubs Directory — Repo Conventions

A small searchable directory of the ~40 resident clubs at Hilltop at Inspiration. Sister project to Hilltop Pickleball; same stack and conventions.

## Stack

- **Frontend:** Vanilla HTML/CSS/JS. No frameworks, no build step, no npm in the browser bundle.
- **Backend:** Netlify Functions (Node, ESM, esbuild bundler) proxying Airtable.
- **Data:** Airtable base "Hilltop Clubs Directory", tables `Clubs` + `Categories`.
- **Email:** Residents' own mail clients via `mailto:` — no Resend/SendGrid integration.
- **Hosting:** Netlify, deploys from GitHub `DenverRick/Hilltop-clubs`. Custom domain `hilltopclubs.org` (Cloudflare-registered, DNS-only — apex A record `75.2.60.5`, www CNAME to `hilltop-clubs.netlify.app`). Let's Encrypt cert auto-managed by Netlify.

## Critical invariants

1. **Never expose `Leader Email` to the browser.** The only function that reads it on the way out is `get-club-mailto.js`, and it embeds it into a `mailto:` URL on explicit click. `get-clubs-by-category.js` and `get-club.js` MUST run every record through `stripSensitive()` from `_airtable.js`. If you add a new read function, route it through the same helper.
2. **All Airtable access via Netlify functions.** The Airtable token never appears in HTML or in `api-client.js`.
3. **Leader updates are gated by email-match.** `leader-update.js` compares the submitter's email to the row's `Leader Email` server-side. The function only patches an allowlisted set of fields. On mismatch it returns a generic 403 — don't leak whether the club or the email was the wrong part.
4. **Vanilla JS only.** No React, no build step. Pages are self-contained HTML files that load `/styles.css` and `/api-client.js`.
5. **Dates: always compute "today" in `America/Denver`, never server-local.** Netlify Functions run on **UTC**, so `new Date()` in the evening Mountain time has already rolled to tomorrow — which silently shows the wrong day's events. Any function that needs the current date (Today/Tomorrow widget, upcoming-meetings windows, etc.) must derive it via `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' })` (gives `YYYY-MM-DD`), not from the server clock. Reuse `todayDenver()` in `_events.js`.
6. **Whole site is gated behind a shared resident password.** The edge function `netlify/edge-functions/gate.js` (`path = "/*"`) runs before every request and 302-redirects unauthenticated visitors to `/login`. It gates **both** the HTML pages **and** `/api/*` content functions — gating HTML alone would leave meeting times/locations readable via a direct API call. `resident-login.js` checks `RESIDENT_PASSWORD` and sets an HMAC cookie (`hc_resident`, 90-day) that the gate recomputes and verifies. Allow-listed (no auth): `/login`, `/api/resident-login`, `/robots.txt`, and static assets. This is separate from the leader email-match auth (invariant #3), which still gates writes. If you add a route that must be public, add it to `isPublicPath()` in `gate.js`.

## Layout

```
index.html              Landing — 8 category cards + global search
category.html           Reads ?slug=… → clubs in that category
club.html               Reads ?slug=… → club detail + interest button
admin-management.html   Embedded Airtable form (paste embed src into iframe)
admin-leader.html       Leader update form, email-match auth
api-client.js           window.ClubsAPI wrapper
styles.css              Shared styles. 18px base font for older audience.
netlify.toml            Pretty URLs + /api/* → /.netlify/functions/*
netlify/functions/
  _airtable.js          Shared helpers: env(), airtableFetch(), stripSensitive()
  get-categories.js
  get-clubs-by-category.js   Also serves ?all=1 for landing-page search
  get-club.js
  get-club-mailto.js
  get-mpr-today.js           Today's MPR-room events for the landing page; reads the SEPARATE "Hilltop Clubhouse" base
  leader-update.js
  leader-upload-thumbnail.js
```

## Required env vars (Netlify dashboard)

- `AIRTABLE_TOKEN` — personal access token. Read+write on the Clubs base (`AIRTABLE_BASE_ID`); also needs `data.records:read` on the **"Hilltop Clubhouse"** base (`appNJgCpn3NJCRC8U`) for `get-mpr-today.js`.
- `AIRTABLE_BASE_ID` — `appXXXX…`
- `AIRTABLE_TABLE_CLUBS` — `tblXXXX…`
- `AIRTABLE_TABLE_CATEGORIES` — `tblXXXX…`
- `MPR_BASE_ID` — optional override for the Clubhouse base read by `get-mpr-today.js` (defaults to `appNJgCpn3NJCRC8U`)
- `ANTHROPIC_API_KEY` — Anthropic Messages API key used by `leader-draft-email.js` to draft promo emails from each club's info + an optional leader-supplied "what's this about" note. Uses Sonnet (`claude-sonnet-4-5`) for less-generic copy; low-volume leader action so cost is negligible. If unset, the AI-draft button returns a 500 with a clear error.
- `RESIDENT_PASSWORD` — shared community password for the whole-site resident gate (invariant #6). Read by `resident-login.js` (Node) and `gate.js` (edge). Same string the sibling calendar app uses — the two are NOT federated, they just check the same value. Must be available to **both** Functions and Edge Functions (default scope covers both). If unset, the gate fails closed (everyone is bounced to `/login` and login returns 500).

## Airtable schema

**Clubs:** Name, Slug, Primary Category (single-select, 8 buckets), Leader Name(s), Leader Email, Short Blurb, Long Description, Tags (multi), Meeting Frequency, Meeting Day, Meeting Schedule, Meeting Time, Meeting Location, Next Meeting (date — drives the "Today/Tomorrow/Meets X" chip on cards), Member Count, Vibe / Demographics, YouTube URLs (one per line), Thumbnail Image (attachment), External Website, TeamReach, Active (checkbox), Last Updated (auto).

**Categories:** Name, Slug, Sort Order, Icon (emoji), Short Description.

The 8 categories: Sports & Fitness, Games & Cards, Arts & Crafts, Civic, Learning & Discussion, Social & Cultural, Service & Volunteer, Special Interests / Hobbies.

## "Add to Home Screen" instructions (resident-facing copy)

Reuse these verbatim whenever telling residents how to put hilltopclubs.org on
their phone home screen (the icon is the Hilltop Clubs app icon — `apple-touch-icon.png`).
The **iPhone Safari** steps are device-verified (2026-06, Rick's iPhone); note
the menu lives at the **bottom-right** in current Safari. **Chrome on iPhone**
borrows Apple's share sheet, so its flow looks like Safari's. **Chrome on
Android is different** — no share sheet / no "Open as Web App" slider; it uses
the three-dot menu's "Add to Home screen". Don't copy the iOS steps for Android.

**iPhone / iPad — Safari:**
1. Open https://hilltopclubs.org in Safari.
2. Tap the three-dot menu (bottom right).
3. Tap the Share button (the square with an up arrow).
4. Select "View More".
5. Scroll down and tap "Add to Home Screen".
6. Tap "Add" (top right). Leave the "Open as Web App" slider ON.
7. The Hilltop Clubs icon appears on the home screen.

**iPhone / iPad — Chrome** (Chrome on iOS uses the iOS share sheet):
1. Open https://hilltopclubs.org in Chrome.
2. Tap the Share button (the square with an up arrow).
3. Select "View More".
4. Scroll down and tap "Add to Home Screen".
5. Tap "Add" (top right). Leave the "Open as Web App" slider ON.

**Android — Chrome** (DIFFERENT — no iOS share sheet, no Web App slider):
1. Open https://hilltopclubs.org in Chrome.
2. Tap the three-dot menu (⋮, top right).
3. Tap "Add to Home screen" (or "Install app").
4. Tap "Add" / "Install".

Then just tap the Hilltop Clubs icon any time to open the directory.

## Working with Rick

Rick is a "vibe coder" — prefer surgical edits, vanilla JS, explicit explanations of tradeoffs. Match the patterns in the Pickleball repo (`/Users/Miles/Documents/hilltop-pickleball-club`) when in doubt.

## Local dev

```
npm install
netlify dev      # serves at http://localhost:8888 with /api/* proxied
```

Set the env vars in `.env` (gitignored) for `netlify dev` to pick them up, or use `netlify link` + `netlify env:pull`.
