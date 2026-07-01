// Shared logic for the leader admin pages (Meetings / About / Outreach).
//
// All three pages include this one script. Every DOM access is null-safe, so a
// handler simply no-ops when its field isn't on the current page — that's how
// one script drives three different field subsets, and how each page's "Save"
// sends only the fields it actually has. Login/auth + the club picker live here
// once; a single sign-in (remembered in localStorage) covers all three pages,
// and the nav links carry ?slug so the chosen club follows you between them.

// ---- null-safe DOM helpers ----
const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);
const setVal = (id, v) => { const e = el(id); if (e) e.value = v; };
const getVal = (id) => { const e = el(id); return e ? e.value : ''; };
const setChecked = (id, v) => { const e = el(id); if (e) e.checked = v; };
const getChecked = (id) => { const e = el(id); return e ? e.checked : false; };
const hide = (id, hidden) => { const e = el(id); if (e) e.hidden = hidden; };
const on = (sel, evt, fn) => { const e = $(sel); if (e) e.addEventListener(evt, fn); };
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Profile text fields that map straight through to Airtable. Only those present
// on the current page are gathered on save (getVal returns '' for absent ones).
const STRING_FIELDS = [
  'Short Blurb', 'Long Description', 'Vibe / Demographics', 'What to Bring',
  'Meeting Frequency', 'Meeting Day', 'Meeting Schedule', 'Meeting Time', 'Meeting Location',
  'YouTube URLs', 'External Website', 'TeamReach',
  'Announcement', 'Announcement Expires',
];

// ---- club picker (type-to-filter combobox) ----
const nameToSlug = new Map();
const slugToName = new Map();
async function populateClubs() {
  const search = el('club-search');
  const list = el('club-list');
  if (!search || !list) return;
  try {
    const { clubs } = await ClubsAPI.getAllClubs();
    if (!clubs.length) { search.placeholder = 'No clubs yet'; search.disabled = true; return; }
    const sorted = clubs.slice().sort((a, b) => a.name.localeCompare(b.name));
    nameToSlug.clear();
    slugToName.clear();
    for (const c of sorted) { nameToSlug.set(c.name.toLowerCase(), c.slug); slugToName.set(c.slug, c.name); }
    list.innerHTML = sorted.map((c) => `<option value="${escAttr(c.name)}"></option>`).join('');
  } catch (err) {
    search.placeholder = `Error: ${err.message}`;
  }
}

// ---- remembered sign-ins (this device only) ----
const LS_LOGINS = 'hc_leader_logins';   // { slug: email }
const LS_LAST = 'hc_leader_last_slug';
function readLogins() { try { return JSON.parse(localStorage.getItem(LS_LOGINS)) || {}; } catch { return {}; } }
function rememberedEmail(slug) { return (slug && readLogins()[slug]) || ''; }
function rememberLogin(slug, email) {
  if (!slug || !email) return;
  const m = readLogins(); m[slug] = email;
  try { localStorage.setItem(LS_LOGINS, JSON.stringify(m)); localStorage.setItem(LS_LAST, slug); } catch {}
  refreshForgetButton();
}
function refreshForgetButton() { hide('forget-logins', Object.keys(readLogins()).length === 0); }
function selectClubBySlug(slug) {
  if (!slug) return false;
  setVal('slug', slug);
  updateNavSlug(slug);
  const name = slugToName.get(slug);
  // A hidden club reached via a ?slug= deep-link won't be in the active picker
  // list, so we won't know its display name — show a readable fallback derived
  // from the slug so the field isn't blank, and still let login proceed.
  setVal('club-search', name || slug.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()));
  return true;
}
function initSavedLogin() {
  refreshForgetButton();
  const params = new URLSearchParams(location.search);
  const targetSlug = (params.get('slug') || '').trim() || localStorage.getItem(LS_LAST) || '';
  if (!targetSlug || !selectClubBySlug(targetSlug)) return;
  const email = rememberedEmail(targetSlug);
  if (!email) return;
  setVal('submitter_email', email);
  attemptLogin();
}
on('#forget-logins', 'click', () => {
  try { localStorage.removeItem(LS_LOGINS); localStorage.removeItem(LS_LAST); } catch {}
  setVal('club-search', ''); setVal('slug', ''); setVal('submitter_email', '');
  collapseToLogin();
  setLoginStatus('success', '');
  refreshForgetButton();
});
// Exact name wins; else a unique prefix match (a few letters lands the club).
function resolveSlug() {
  const typed = getVal('club-search').trim().toLowerCase();
  let slug = nameToSlug.get(typed) || '';
  if (!slug && typed) {
    const matches = [...nameToSlug.entries()].filter(([name]) => name.startsWith(typed));
    if (matches.length === 1) slug = matches[0][1];
  }
  // Fall back to a slug already set from a ?slug= deep-link, so a HIDDEN club
  // (absent from the active picker list) can still log in via its direct URL.
  if (!slug) slug = getVal('slug') || '';
  setVal('slug', slug);
  updateNavSlug(slug);
  return slug;
}

// ---- nav: carry the chosen club between pages ----
function updateNavSlug(slug) {
  document.querySelectorAll('a.leader-nav-link').forEach((a) => {
    const base = a.getAttribute('data-path');
    if (!base) return;
    a.href = slug ? `${base}?slug=${encodeURIComponent(slug)}` : base;
  });
}

// ---- club values: pre-populate the form fields present on this page ----
function clearFormFields() {
  for (const id of ['Short Blurb', 'Long Description', 'Vibe / Demographics', 'What to Bring', 'Tags',
    'Meeting Frequency', 'Meeting Day', 'Meeting Schedule', 'Meeting Time',
    'Meeting Location', 'Member Count', 'YouTube URLs',
    'External Website', 'TeamReach', 'Announcement', 'Announcement Expires']) {
    setVal(id, '');
  }
  setChecked('Hide Events', false);
  evmClubDefaults = { name: '', day: '', time: '', location: '' };
  hide('announcement-status', true);
  hide('remove-announcement', true);
  setMediaPreview('thumbnail', '', 'Current banner:');
  setMediaPreview('flyer', '', 'Current flyer:');
  setVal('draft-context', '');
}
async function loadCurrentValues(slug) {
  if (!slug) { clearFormFields(); return; }
  // Only the About/Events/Outreach pages have club-detail fields to populate.
  // Pages like RSVP/Help have none — skip the fetch so a failed getClub can't
  // flash "Couldn't load current values" into their status boxes.
  if (!el('Short Blurb') && !el('Meeting Day') && !el('Announcement')) return;
  setStatus('success', 'Loading current values…');
  try {
    const { club } = await ClubsAPI.getClub(slug);
    setVal('Short Blurb', club.blurb || '');
    setVal('Long Description', club.description || '');
    setVal('Vibe / Demographics', club.vibe || '');
    setVal('What to Bring', club.whatToBring || '');
    setVal('Tags', (club.tags || []).join(', '));
    setVal('Meeting Frequency', club.meetingFrequency || '');
    setVal('Meeting Day', club.meetingDay || '');
    setVal('Meeting Schedule', club.meetingSchedule || '');
    setVal('Meeting Time', club.meetingTime || '');
    setVal('Meeting Location', club.meetingLocation || '');
    setVal('Member Count', club.memberCount ?? '');
    // Remember the club's saved meeting info to pre-fill a new recurring event.
    evmClubDefaults = {
      name: club.name || '',
      day: club.meetingDay || '',
      time: club.meetingTime || '',
      location: club.meetingLocation || '',
    };
    setVal('YouTube URLs', (club.youtubeUrls || []).join('\n'));
    // Airtable accepts schemeless URLs but the HTML5 url input doesn't — prefix
    // https:// so the field validates on save.
    const rawWebsite = (club.website || '').trim();
    setVal('External Website', rawWebsite && !/^https?:\/\//i.test(rawWebsite) ? `https://${rawWebsite}` : rawWebsite);
    setVal('TeamReach', club.teamReach || '');
    setVal('Announcement', club.announcement || '');
    setVal('Announcement Expires', club.announcementExpires || '');
    const annStatus = el('announcement-status');
    if (annStatus) {
      if (club.announcement) {
        annStatus.hidden = false;
        hide('remove-announcement', false);
        if (club.announcementActive) {
          annStatus.style.color = 'var(--success, #2a7d4f)';
          annStatus.textContent = '✅ Currently visible to members.';
        } else {
          annStatus.style.color = 'var(--danger, #b91c1c)';
          annStatus.textContent = '⛔ Expired — not showing to members.';
        }
      } else {
        annStatus.hidden = true;
        hide('remove-announcement', true);
      }
    }
    setChecked('Hide Events', !!club.hideEvents);
    setMediaPreview('thumbnail', club.thumbnail, 'Current banner:');
    setMediaPreview('flyer', club.promoFlyer, 'Current flyer:');
    hide('status', true);
    hide('status-top', true);
  } catch (err) {
    setStatus('error', `Couldn't load current values: ${err.message}`);
  }
}

// ---- login gate ----
function setLoginStatus(kind, message) {
  const e = el('login-status');
  if (!e) return;
  if (!message) { e.hidden = true; return; }
  e.hidden = false; e.className = `form-status ${kind}`; e.textContent = message;
}
function collapseToLogin() { hide('edit-section', true); hide('login-card', false); }
function revealEditSection(clubName) {
  const banner = el('edit-banner-text');
  if (banner) banner.textContent = clubName ? `Editing: ${clubName}` : 'Editing your club';
  hide('login-card', true);
  hide('edit-section', false);
}
async function attemptLogin() {
  const slug = resolveSlug();
  const submitter_email = getVal('submitter_email').trim();
  if (!slug) { setLoginStatus('error', 'Pick your club from the list first.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitter_email)) {
    setLoginStatus('error', 'Enter a valid email address.');
    return;
  }
  const btn = el('login-btn');
  if (btn) btn.disabled = true;
  setLoginStatus('success', 'Checking…');
  try {
    const res = await ClubsAPI.leaderVerify({ slug, submitter_email });
    setLoginStatus('success', '');
    await loadCurrentValues(slug);
    revealEditSection(res.name);
    rememberLogin(slug, submitter_email);
    if (el('evm-form')) { evmResetForm(); evmLoad(); }
    if (el('rsvp-emails')) rsvpRefresh();   // RSVP page: block is expanded, no toggle to lazy-load it
  } catch (err) {
    setLoginStatus('error', err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
on('#login-btn', 'click', attemptLogin);
on('#club-search', 'input', () => {
  const slug = resolveSlug();
  collapseToLogin();
  const email = rememberedEmail(slug);
  if (email) setVal('submitter_email', email);
});
on('#submitter_email', 'change', collapseToLogin);
on('#switch-club', 'click', () => {
  setVal('club-search', ''); setVal('slug', ''); setVal('submitter_email', '');
  updateNavSlug('');
  collapseToLogin();
  setLoginStatus('success', '');
  if (el('evm-form')) { evmResetForm(); const list = el('evm-list'); if (list) list.innerHTML = '<div class="field-hint">Log in to load your events.</div>'; }
});

// ---- image previews (About page) ----
function setMediaPreview(which, url, label) {
  const wrap = el(`${which}-preview`);
  const img = el(`${which}-preview-img`);
  if (!wrap || !img) return;
  const lbl = wrap.querySelector('.current-media-label');
  if (lbl) lbl.textContent = label;
  if (url) { img.src = url; wrap.hidden = false; }
  else { img.removeAttribute('src'); wrap.hidden = true; }
}
function showLocalPreview(which, file) {
  if (!file) return;
  setMediaPreview(which, URL.createObjectURL(file), 'New (uploading…):');
}
on('#thumbnail-file', 'change', (e) => showLocalPreview('thumbnail', e.target.files[0]));
on('#flyer-file', 'change', (e) => showLocalPreview('flyer', e.target.files[0]));

// ---- email field UX ----
on('#submitter_email', 'blur', () => {
  const input = el('submitter_email'); const hint = el('email-hint');
  if (!input || !hint) return;
  const v = input.value.trim();
  if (!v) { hint.hidden = true; input.removeAttribute('aria-invalid'); return; }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    hint.hidden = true; input.removeAttribute('aria-invalid');
  } else {
    hint.hidden = false;
    hint.textContent = '⚠️ That doesn\'t look like a valid email address — please check it.';
    hint.style.color = 'var(--danger)';
    input.setAttribute('aria-invalid', 'true');
  }
});
on('#submitter_email', 'input', () => {
  const hint = el('email-hint'); const input = el('submitter_email');
  if (hint && !hint.hidden) { hint.hidden = true; if (input) input.removeAttribute('aria-invalid'); }
});
on('#toggle-email-visibility', 'click', () => {
  const input = el('submitter_email'); const toggle = el('toggle-email-visibility');
  if (!input || !toggle) return;
  const masked = input.type === 'password';
  input.type = masked ? 'email' : 'password';
  toggle.textContent = masked ? 'Hide' : 'Show';
  toggle.setAttribute('aria-label', masked ? 'Hide email' : 'Show email');
  toggle.setAttribute('aria-pressed', String(masked));
  input.focus();
});

// ---- save status (mirrored to top + bottom) ----
function setStatus(kind, message) {
  for (const id of ['status', 'status-top']) {
    const e = el(id);
    if (!e) continue;
    e.hidden = false; e.className = `form-status ${kind}`; e.textContent = message;
  }
}

// ---- image uploads (About page) ----
function setThumbStatus(kind, message) { const e = el('thumbnail-status'); if (e) { e.hidden = false; e.className = `form-status ${kind}`; e.textContent = message; } }
function setFlyerStatus(kind, message) { const e = el('flyer-status'); if (e) { e.hidden = false; e.className = `form-status ${kind}`; e.textContent = message; } }
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
async function handleUpload(which, file) {
  const setStatusFn = which === 'flyer' ? setFlyerStatus : setThumbStatus;
  const apiFn = which === 'flyer' ? 'leaderUploadFlyer' : 'leaderUploadThumbnail';
  const slug = getVal('slug').trim();
  const submitter_email = getVal('submitter_email').trim();
  if (!slug || !submitter_email) { setStatusFn('error', 'Pick your club and enter your email above before uploading.'); return false; }
  if (file.size > 5 * 1024 * 1024) { setStatusFn('error', `${which === 'flyer' ? 'Flyer' : 'Image'} is over 5 MB. Try a smaller version.`); return false; }
  setStatusFn('success', 'Uploading…');
  try {
    const fileBase64 = await readFileAsBase64(file);
    await ClubsAPI[apiFn]({ slug, submitter_email, filename: file.name, contentType: file.type, fileBase64 });
    setStatusFn('success', `${which === 'flyer' ? 'Flyer' : 'Image'} uploaded — it will appear on your club ${which === 'flyer' ? 'page' : 'card'} within a minute.`);
  } catch (err) { setStatusFn('error', err.message); }
}
on('#thumbnail-file', 'change', async (ev) => { const f = ev.target.files?.[0]; if (!f) return; const ok = await handleUpload('thumbnail', f); if (ok === false) ev.target.value = ''; });
on('#flyer-file', 'change', async (ev) => { const f = ev.target.files?.[0]; if (!f) return; const ok = await handleUpload('flyer', f); if (ok === false) ev.target.value = ''; });

async function removeMedia(which) {
  const setStatusFn = which === 'flyer' ? setFlyerStatus : setThumbStatus;
  const noun = which === 'flyer' ? 'promo flyer' : 'banner image';
  const slug = getVal('slug').trim();
  const submitter_email = getVal('submitter_email').trim();
  if (!slug || !submitter_email) { setStatusFn('error', 'Pick your club and enter your email above first.'); return; }
  if (!confirm(`Remove your ${noun}? You can upload a new one anytime.`)) return;
  setStatusFn('success', 'Removing…');
  try {
    await ClubsAPI.leaderRemoveImage({ slug, submitter_email, target: which });
    setMediaPreview(which, '', which === 'flyer' ? 'Current flyer:' : 'Current banner:');
    setStatusFn('success', `${which === 'flyer' ? 'Flyer' : 'Banner'} removed — your page updates within a minute.`);
  } catch (err) { setStatusFn('error', err.message); }
}
on('#thumbnail-remove', 'click', () => removeMedia('thumbnail'));
on('#flyer-remove', 'click', () => removeMedia('flyer'));

// ---- AI promo email drafter (Outreach page) ----
function setDraftStatus(kind, message) { const e = el('draft-status'); if (e) { e.hidden = false; e.className = `form-status ${kind}`; e.textContent = message; } }
on('#draft-email-btn', 'click', async () => {
  const slug = getVal('slug').trim();
  const submitter_email = getVal('submitter_email').trim();
  if (!slug || !submitter_email) { setDraftStatus('error', 'Pick your club and enter your email above first.'); return; }
  hide('draft-output', true);
  const btn = el('draft-email-btn'); if (btn) btn.disabled = true;
  setDraftStatus('success', 'Drafting… (takes a few seconds)');
  try {
    const { subject, body } = await ClubsAPI.leaderDraftEmail({ slug, submitter_email, context: getVal('draft-context').trim() });
    setVal('draft-subject', subject || '');
    setVal('draft-body', body || '');
    hide('draft-output', false);
    hide('draft-status', true);
  } catch (err) {
    setDraftStatus('error', err.message);
  } finally { if (btn) btn.disabled = false; }
});
on('#draft-open-mail', 'click', () => {
  window.location.href = `mailto:?subject=${encodeURIComponent(getVal('draft-subject'))}&body=${encodeURIComponent(getVal('draft-body'))}`;
});
on('#draft-copy', 'click', async () => {
  const text = `Subject: ${getVal('draft-subject')}\n\n${getVal('draft-body')}`;
  try {
    await navigator.clipboard.writeText(text);
    const btn = el('draft-copy'); if (btn) { const o = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = o; }, 2000); }
  } catch { setDraftStatus('error', 'Could not copy. Select the text above manually.'); }
});

// ---- profile save (any page; sends only the fields present here) ----
on('#leader-form', 'submit', async (ev) => {
  ev.preventDefault();
  const slug = getVal('slug').trim();
  const submitter_email = getVal('submitter_email').trim();
  if (!slug || !submitter_email) { setStatus('error', 'Pick a club and enter your email.'); return; }

  const fields = {};
  for (const id of STRING_FIELDS) {
    if (!el(id)) continue;          // field not on this page
    const v = getVal(id).trim();
    if (v) fields[id] = v;
  }
  if (el('Tags')) {
    const tagsRaw = getVal('Tags').trim();
    if (tagsRaw) fields['Tags'] = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (el('Member Count')) {
    const mc = getVal('Member Count').trim();
    if (mc) fields['Member Count'] = Number(mc);
  }
  if (el('Hide Events')) fields['Hide Events'] = getChecked('Hide Events');

  if (Object.keys(fields).length === 0) { setStatus('error', 'Fill in at least one field to update.'); return; }

  setStatus('success', 'Saving…');
  try {
    await ClubsAPI.leaderUpdate({ slug, submitter_email, fields });
    setStatus('success', 'Saved! Your changes are live.');
  } catch (err) { setStatus('error', err.message); }
});

// ---- remove announcement (Outreach page) ----
on('#remove-announcement', 'click', async () => {
  const slug = getVal('slug').trim();
  const submitter_email = getVal('submitter_email').trim();
  if (!slug || !submitter_email) return;
  setStatus('success', 'Removing announcement…');
  try {
    await ClubsAPI.leaderUpdate({ slug, submitter_email, fields: { 'Announcement': '', 'Announcement Expires': null } });
    setVal('Announcement', ''); setVal('Announcement Expires', '');
    hide('announcement-status', true);
    hide('remove-announcement', true);
    setStatus('success', 'Announcement removed.');
  } catch (err) { setStatus('error', err.message); }
});

// ---- cancel buttons ----
function onCancel() { window.location.href = '/'; }
on('#cancel-top', 'click', onCancel);
on('#cancel-edit-top', 'click', onCancel);
on('#cancel-bottom', 'click', onCancel);

// ---- RSVP setup (Outreach page) ----
const rsvpDetails = document.querySelector('details.rsvp-setup');
let rsvpLoaded = false;
let rsvpMemberCount = 0;   // last-known count from the RSVP app; drives the "already imported" line + email-button help
function setRsvpStatus(id, kind, message) {
  const e = el(id);
  if (!e) return;
  if (!message) { e.hidden = true; return; }
  e.hidden = false; e.className = `form-status ${kind}`; e.textContent = message;
}
function rsvpRender(data) {
  if (data.dashboardUrl) {
    const link = el('rsvp-dashboard-link');
    if (link) { link.href = data.dashboardUrl; link.hidden = false; }
  }
  // The RSVP app reports how many members it already has (but never the list
  // itself — privacy). Show the count so a returning leader knows they're set
  // up, and so the empty paste box doesn't read as "no members yet."
  rsvpMemberCount = Number(data.memberCount) || 0;
  const countEl = el('rsvp-member-count');
  if (countEl) {
    if (rsvpMemberCount > 0) {
      countEl.hidden = false;
      countEl.className = 'form-status success';
      countEl.textContent =
        `✅ ${rsvpMemberCount} member${rsvpMemberCount === 1 ? '' : 's'} already imported. ` +
        `Add more below only when you have new people — duplicates are skipped automatically.`;
    } else {
      countEl.hidden = true;
    }
  }
}
async function rsvpRefresh() {
  const slug = getVal('slug').trim();
  const submitter_email = getVal('submitter_email').trim();
  if (!slug || !submitter_email) return;
  setRsvpStatus('rsvp-status', 'success', 'Loading…');
  try {
    rsvpRender(await ClubsAPI.leaderRsvpSetup({ slug, submitter_email, action: 'status' }));
    setRsvpStatus('rsvp-status', 'success', '');
  } catch (err) { setRsvpStatus('rsvp-status', 'error', err.message); }
}
if (rsvpDetails) {
  rsvpDetails.addEventListener('toggle', () => { if (rsvpDetails.open && !rsvpLoaded) { rsvpLoaded = true; rsvpRefresh(); } });
}
function rsvpReset() {
  rsvpLoaded = false;
  rsvpMemberCount = 0;
  hide('rsvp-member-count', true);
  if (rsvpDetails) rsvpDetails.open = false;
}
on('#club-search', 'input', rsvpReset);
on('#switch-club', 'click', rsvpReset);
// Send whatever is in the paste box to the RSVP app. Shared by the "Import
// members" button AND the spreadsheet upload (so uploading is one step). Import
// is idempotent server-side (de-dupes, validates), so re-running is safe.
async function runRsvpImport() {
  const slug = getVal('slug').trim();
  const submitter_email = getVal('submitter_email').trim();
  const emails = getVal('rsvp-emails').trim();
  if (!slug || !submitter_email) { setRsvpStatus('rsvp-import-status', 'error', 'Log in first.'); return; }
  if (!emails) { setRsvpStatus('rsvp-import-status', 'error', 'Paste some email addresses first.'); return; }
  const btn = el('rsvp-import-btn'); if (btn) btn.disabled = true;
  setRsvpStatus('rsvp-import-status', 'success', 'Importing…');
  try {
    const r = await ClubsAPI.leaderRsvpSetup({ slug, submitter_email, action: 'import', emails });
    const parts = [`Added ${r.added}`];
    if (r.skippedDuplicates) parts.push(`skipped ${r.skippedDuplicates} already on the list`);
    if (r.invalid) parts.push(`${r.invalid} not valid`);
    setRsvpStatus('rsvp-import-status', 'success', parts.join(' · ') + '.');
    // Keep the pasted list in the box so "Email members about RSVP" can BCC it.
    rsvpRefresh();
  } catch (err) { setRsvpStatus('rsvp-import-status', 'error', err.message); }
  finally { if (btn) btn.disabled = false; }
}
on('#rsvp-import-btn', 'click', runRsvpImport);

// ---- spreadsheet upload: parse .xlsx/.csv in the browser, then auto-import ----
// SheetJS is ~900 KB, so it's vendored at /xlsx.full.min.js and loaded only on
// first use. The file populates #rsvp-emails and then imports automatically via
// runRsvpImport() — leaders kept forgetting the separate "Import members" click,
// so their rosters never reached the RSVP app.
let xlsxLoading = null;
function loadXlsxOnce() {
  if (window.XLSX) return Promise.resolve();
  if (xlsxLoading) return xlsxLoading;
  xlsxLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = () => { xlsxLoading = null; reject(new Error('Could not load the spreadsheet reader. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return xlsxLoading;
}
const RSVP_FILE_EMAIL_RE = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g;
function emailsFromWorkbook(wb) {
  const seen = new Set();
  for (const name of wb.SheetNames) {
    const text = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    for (const m of text.match(RSVP_FILE_EMAIL_RE) || []) {
      const e = m.trim().toLowerCase();
      if (e) seen.add(e);
    }
  }
  return [...seen];
}
on('#rsvp-file-btn', 'click', () => { const f = el('rsvp-file'); if (f) f.click(); });
on('#rsvp-file', 'change', async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  setRsvpStatus('rsvp-import-status', 'success', `Reading ${file.name}…`);
  try {
    await loadXlsxOnce();
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const emails = emailsFromWorkbook(wb);
    if (!emails.length) {
      setRsvpStatus('rsvp-import-status', 'error', `No email addresses found in ${file.name}.`);
      return;
    }
    const box = el('rsvp-emails');
    if (box) box.value = emails.join('\n');
    await runRsvpImport();   // one step — no second click needed (import is idempotent)
  } catch (err) {
    setRsvpStatus('rsvp-import-status', 'error', err.message || 'Could not read that file.');
  } finally {
    ev.target.value = '';   // let the same file be re-selected
  }
});

// (The member intro/how-to emails moved to the RSVP dashboard — this page is
// now just for adding members.)

// ---- club-run meeting events (Meetings page) ----
let evmEvents = [], evmOverrides = [];
let evmClubDefaults = { name: '', day: '', time: '', location: '' };
const EVM_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function evmStatus(kind, msg) {
  const e = el('evm-status');
  if (!e) return;
  if (!msg) { e.hidden = true; return; }
  e.hidden = false; e.className = `form-status ${kind}`; e.textContent = msg;
}
function evmScheduleText(ev) {
  if (ev['Event Type'] === 'One-off') return `One-off · ${ev['Event Date'] || '(no date)'}`;
  const r = ev['Recurrence'] || '', day = ev['Day'] || '';
  if (r === 'Weekly') return `Every ${day}`;
  if (r === 'Every other') return `Every other ${day}`;
  if (r) return `${r} ${day} of the month`;
  return day || '(no schedule)';
}
function evmTimeText(ev) {
  const s = ev['Start Time'] || '', e = ev['End Time'] || '';
  return s ? (e ? `${s}–${e}` : s) : '';
}
function renderEvmList() {
  const wrap = el('evm-list');
  if (!wrap) return;
  if (!evmEvents.length) { wrap.innerHTML = '<div class="field-hint">No meetings yet. Add your first one below.</div>'; return; }
  wrap.innerHTML = evmEvents.map((ev) => {
    const cancels = evmOverrides
      .filter((o) => o.eventId === ev.id && o['Override Type'] === 'Cancel')
      .map((o) => o['Date']).filter(Boolean);
    const meta = `${evmScheduleText(ev)}${evmTimeText(ev) ? ' · ' + evmTimeText(ev) : ''}${ev['Location'] ? ' · ' + ev['Location'] : ''}`;
    return `<div class="evm-item" data-id="${ev.id}">
      <div class="evm-item-main">
        <div class="evm-item-name">${escAttr(ev['Event Name'] || '')}</div>
        <div class="evm-item-meta">${escAttr(meta)}</div>
        ${cancels.length ? `<div class="evm-item-cancels">Cancelled: ${cancels.map(escAttr).join(', ')}</div>` : ''}
      </div>
      <div class="evm-item-actions">
        <button class="btn btn-secondary btn-small" data-act="edit" type="button">Edit</button>
        ${ev['Event Type'] !== 'One-off' ? '<button class="btn btn-secondary btn-small" data-act="cancel-date" type="button">Cancel a date</button>' : ''}
        <button class="btn btn-secondary btn-small evm-del" data-act="delete" type="button">Delete</button>
      </div>
    </div>`;
  }).join('');
}
async function evmLoad() {
  if (!el('evm-list')) return;
  const slug = getVal('slug').trim(), submitter_email = getVal('submitter_email').trim();
  if (!slug || !submitter_email) return;
  el('evm-list').innerHTML = '<div class="field-hint">Loading…</div>';
  try {
    const r = await ClubsAPI.leaderEvents({ slug, submitter_email, action: 'list' });
    evmEvents = r.events || []; evmOverrides = r.overrides || [];
    renderEvmList();
  } catch (err) {
    el('evm-list').innerHTML = `<div class="form-status error">${escAttr(err.message)}</div>`;
  }
}
function evmRefDateToggle() {
  hide('evm-refdate-label', !(getVal('evm-type') === 'Recurring' && getVal('evm-recurrence') === 'Every other'));
}
function evmTypeToggle() {
  if (!el('evm-type')) return;
  const recurring = getVal('evm-type') === 'Recurring';
  hide('evm-recurring-fields', !recurring);
  hide('evm-oneoff-fields', recurring);
  // Clear whichever side is now hidden so each mode carries only its fields —
  // e.g. picking One-off clears the recurring fields.
  if (recurring) { setVal('evm-date', ''); }
  else { setVal('evm-day', ''); setVal('evm-recurrence', ''); setVal('evm-refdate', ''); }
  evmRefDateToggle();
}
function evmResetForm() {
  if (!el('evm-form')) return;
  setVal('evm-edit-id', '');
  for (const id of ['evm-name', 'evm-day', 'evm-recurrence', 'evm-refdate', 'evm-date', 'evm-start', 'evm-end', 'evm-location', 'evm-note']) setVal(id, '');
  setVal('evm-type', 'Recurring');
  // Pre-fill recurring fields from the club's saved meeting info (Day only if it
  // maps to a weekday option). One-off clears these.
  setVal('evm-name', evmClubDefaults.name || '');
  setVal('evm-recurrence', 'Weekly');
  setVal('evm-day', EVM_WEEKDAYS.includes(evmClubDefaults.day) ? evmClubDefaults.day : '');
  setVal('evm-start', evmClubDefaults.time || '');
  setVal('evm-location', evmClubDefaults.location || '');
  const title = el('evm-form-title'); if (title) title.textContent = 'Add a meeting or event';
  const save = el('evm-save'); if (save) save.textContent = 'Add event';
  hide('evm-cancel-edit', true);
  evmTypeToggle();
}
function evmFillForm(ev) {
  setVal('evm-edit-id', ev.id);
  setVal('evm-type', ev['Event Type'] || 'Recurring');
  setVal('evm-name', ev['Event Name'] || '');
  setVal('evm-day', ev['Day'] || '');
  setVal('evm-recurrence', ev['Recurrence'] || '');
  setVal('evm-refdate', ev['Recurrence Reference Date'] || '');
  setVal('evm-date', ev['Event Date'] || '');
  setVal('evm-start', ev['Start Time'] || '');
  setVal('evm-end', ev['End Time'] || '');
  setVal('evm-location', ev['Location'] || '');
  setVal('evm-note', ev['Default Note'] || '');
  const title = el('evm-form-title'); if (title) title.textContent = 'Edit event';
  const save = el('evm-save'); if (save) save.textContent = 'Save changes';
  hide('evm-cancel-edit', false);
  evmTypeToggle();
  const form = el('evm-form'); if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
on('#evm-type', 'change', evmTypeToggle);
on('#evm-recurrence', 'change', evmRefDateToggle);
on('#evm-cancel-edit', 'click', evmResetForm);
on('#evm-list', 'click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.evm-item').getAttribute('data-id');
  const ev = evmEvents.find((x) => x.id === id);
  if (!ev) return;
  const slug = getVal('slug').trim(), submitter_email = getVal('submitter_email').trim();
  const act = btn.getAttribute('data-act');
  if (act === 'edit') { evmFillForm(ev); return; }
  if (act === 'delete') {
    if (!confirm(`Delete "${ev['Event Name']}"? It will stop showing on the calendar.`)) return;
    evmStatus('success', 'Deleting…');
    try { await ClubsAPI.leaderEvents({ slug, submitter_email, action: 'delete', id }); evmStatus('success', ''); await evmLoad(); }
    catch (err) { evmStatus('error', err.message); }
  }
  if (act === 'cancel-date') {
    const date = prompt('Cancel this meeting on which date? (YYYY-MM-DD)');
    if (!date) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { evmStatus('error', 'Please use the format YYYY-MM-DD.'); return; }
    evmStatus('success', 'Saving…');
    try {
      await ClubsAPI.leaderEvents({ slug, submitter_email, action: 'override', eventId: id, fields: { Date: date, 'Override Type': 'Cancel', Name: `Cancel ${ev['Event Name']} ${date}` } });
      evmStatus('success', ''); await evmLoad();
    } catch (err) { evmStatus('error', err.message); }
  }
});
on('#evm-save', 'click', async () => {
  const slug = getVal('slug').trim(), submitter_email = getVal('submitter_email').trim();
  if (!slug || !submitter_email) { evmStatus('error', 'Log in first.'); return; }
  const type = getVal('evm-type');
  const fields = {
    'Event Name': getVal('evm-name').trim(),
    'Event Type': type,
    'Start Time': getVal('evm-start').trim(),
    'End Time': getVal('evm-end').trim(),
    'Location': getVal('evm-location').trim(),
    'Default Note': getVal('evm-note').trim(),
  };
  if (type === 'Recurring') {
    fields['Day'] = getVal('evm-day');
    fields['Recurrence'] = getVal('evm-recurrence');
    if (getVal('evm-recurrence') === 'Every other') fields['Recurrence Reference Date'] = getVal('evm-refdate');
  } else {
    fields['Event Date'] = getVal('evm-date');
  }
  const editId = getVal('evm-edit-id');
  const save = el('evm-save'); if (save) save.disabled = true;
  evmStatus('success', editId ? 'Saving…' : 'Adding…');
  try {
    if (editId) await ClubsAPI.leaderEvents({ slug, submitter_email, action: 'update', id: editId, fields });
    else await ClubsAPI.leaderEvents({ slug, submitter_email, action: 'create', fields });
    evmStatus('success', 'Saved.');
    evmResetForm();
    await evmLoad();
  } catch (err) { evmStatus('error', err.message); }
  finally { if (save) save.disabled = false; }
});

// ---- go ----
populateClubs().then(initSavedLogin);
