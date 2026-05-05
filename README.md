# Hilltop Clubs Directory

Searchable directory of the ~40 resident clubs at Hilltop at Inspiration (Aurora, CO).

Vanilla HTML/CSS/JS + Netlify Functions + Airtable. Deploys to **hilltop-clubs.org**.

See [CLAUDE.md](./CLAUDE.md) for conventions, the security invariants, and the Airtable schema.

## Local dev

```
npm install
netlify link               # one-time, link to the Netlify site
netlify env:pull            # pull AIRTABLE_* secrets locally
netlify dev                 # http://localhost:8888
```

## Deploy

GitHub `DenverRick/hilltop-clubs` → Netlify auto-deploy on push to `main`.

## Manual setup checklist (one-time)

1. Create the Airtable base "Hilltop Clubs Directory" with `Clubs` and `Categories` tables (schema in CLAUDE.md). Seed the 8 categories.
2. Create a scoped personal access token in Airtable, copy the base + table IDs.
3. Set Netlify env vars: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_CLUBS`, `AIRTABLE_TABLE_CATEGORIES`.
4. In Airtable, create a Form view on `Clubs` with the management-owned fields. Copy the embed URL into the `iframe` `src` in [admin-management.html](./admin-management.html).
5. Point `hilltop-clubs.org` at the Netlify site via DNS.
