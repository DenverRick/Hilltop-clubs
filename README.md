# Hilltop Clubs Directory

Searchable directory of the ~40 resident clubs at Hilltop at Inspiration (Aurora, CO).

Vanilla HTML/CSS/JS + Netlify Functions + Airtable. Deploys to **hilltopclubs.org**.

See [CLAUDE.md](./CLAUDE.md) for conventions, the security invariants, and the Airtable schema.

## Sister project: weekly events calendar

The landing page surfaces a "Clubs meeting this week" section, sourced from a sister app — the resident weekly calendar at [DenverRick/hilltop-weekly-calendar](https://github.com/DenverRick/hilltop-weekly-calendar). Both apps read the same Airtable base; the calendar owns the recurring `MeetingSlots` table, this app owns the `Clubs` table.

The calendar deep-links back to `hilltopclubs.org/club/{slug}` from its event cards. **The `Slug` field on Clubs is therefore a cross-repo URL contract** — renaming a slug here breaks the calendar's deployed links until it re-renders. Flag any slug renames so the calendar can be checked.

## Local dev

```
npm install
netlify link               # one-time, link to the Netlify site
netlify env:pull            # pull AIRTABLE_* secrets locally
netlify dev                 # http://localhost:8888
```

Loose club photos / hero images / flyers staged locally before being attached to Airtable go in `working-photos/` (gitignored). Only `clubhouse-hero.png` is committed at the repo root — it's the landing-page hero referenced from `styles.css`.

## Deploy

GitHub `DenverRick/hilltop-clubs` → Netlify auto-deploy on push to `main`.

## Manual setup checklist (one-time)

1. Create the Airtable base "Hilltop Clubs Directory" with `Clubs` and `Categories` tables (schema in CLAUDE.md). Seed the 8 categories.
2. Create a scoped personal access token in Airtable, copy the base + table IDs.
3. Set Netlify env vars: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_CLUBS`, `AIRTABLE_TABLE_CATEGORIES`.
4. In Airtable, create a Form view on `Clubs` with the management-owned fields. Copy the embed URL into the `iframe` `src` in [admin-management.html](./admin-management.html).
5. Point `hilltopclubs.org` at the Netlify site via DNS.
