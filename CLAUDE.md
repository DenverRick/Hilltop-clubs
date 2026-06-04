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
- `ANTHROPIC_API_KEY` — Anthropic Messages API key used by `leader-draft-email.js` to draft promo emails from each club's info. Cheap (Haiku model). If unset, the AI-draft button returns a 500 with a clear error.

## Airtable schema

**Clubs:** Name, Slug, Primary Category (single-select, 8 buckets), Leader Name(s), Leader Email, Short Blurb, Long Description, Tags (multi), Meeting Frequency, Meeting Day, Meeting Schedule, Meeting Time, Meeting Location, Next Meeting (date — drives the "Today/Tomorrow/Meets X" chip on cards), Member Count, Vibe / Demographics, YouTube URLs (one per line), Thumbnail Image (attachment), External Website, TeamReach, Active (checkbox), Last Updated (auto).

**Categories:** Name, Slug, Sort Order, Icon (emoji), Short Description.

The 8 categories: Sports & Fitness, Games & Cards, Arts & Crafts, Civic, Learning & Discussion, Social & Cultural, Service & Volunteer, Special Interests / Hobbies.

## Working with Rick

Rick is a "vibe coder" — prefer surgical edits, vanilla JS, explicit explanations of tradeoffs. Match the patterns in the Pickleball repo (`/Users/Miles/Documents/hilltop-pickleball-club`) when in doubt.

## Local dev

```
npm install
netlify dev      # serves at http://localhost:8888 with /api/* proxied
```

Set the env vars in `.env` (gitignored) for `netlify dev` to pick them up, or use `netlify link` + `netlify env:pull`.
