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
  const name = slugToName.get(slug);
  if (!name) return false;
  setVal('club-search', name);
  setVal('slug', slug);
  updateNavSlug(slug);
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
let clubLeaderName = '';   // from Airtable; used to sign off the member RSVP emails
async function loadCurrentValues(slug) {
  if (!slug) { clearFormFields(); return; }
  setStatus('success', 'Loading current values…');
  try {
    const { club } = await ClubsAPI.getClub(slug);
    clubLeaderName = club.leaderName || '';
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
function setRsvpStatus(id, kind, message) {
  const e = el(id);
  if (!e) return;
  if (!message) { e.hidden = true; return; }
  e.hidden = false; e.className = `form-status ${kind}`; e.textContent = message;
}
function rsvpRender(data) {
  if (data.dashboardUrl) {
    hide('rsvp-dashboard-block', false);
    const link = el('rsvp-dashboard-link'); if (link) link.href = data.dashboardUrl;
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
function rsvpReset() { rsvpLoaded = false; if (rsvpDetails) rsvpDetails.open = false; }
on('#club-search', 'input', rsvpReset);
on('#switch-club', 'click', rsvpReset);
on('#rsvp-import-btn', 'click', async () => {
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
});
// Draft a member email in the leader's OWN mail app. To = the leader (a copy in
// their inbox); BCC = the pasted members (hidden from each other). The RSVP app
// returns no member list, so the textarea is the source. Club name + sign-off
// are filled from Airtable (clubLeaderName, set in loadCurrentValues).
function draftMemberEmail(buildSubject, buildBody) {
  const submitter_email = getVal('submitter_email').trim();
  const bcc = getVal('rsvp-emails').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).join(',');
  if (!bcc) {
    setRsvpStatus('rsvp-import-status', 'error', "Paste your members' emails above first, then click this to draft the email.");
    return;
  }
  const clubName = slugToName.get(getVal('slug')) || 'our club';
  const signoff = clubLeaderName || '[Your name]';
  const subject = buildSubject({ clubName, signoff });
  const body = buildBody({ clubName, signoff });
  window.location.href =
    `mailto:${encodeURIComponent(submitter_email)}?bcc=${encodeURIComponent(bcc)}` +
    `&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
// The one-time "we're starting RSVP" announcement.
on('#rsvp-email-members-btn', 'click', () => draftMemberEmail(
  ({ clubName }) => `Introducing one-tap RSVP for ${clubName}`,
  ({ clubName, signoff }) => `Hi ${clubName} members,

We're trying something new to make RSVPs easier. Instead of replying to an email or responding on TeamReach, you'll get a personal link that lets you RSVP in one tap — and I can see the headcount update in real time.

Here's what to expect:

You'll receive an email from HilltopClubs2026@gmail.com with the subject line "${clubName} — RSVP for [event]." It may land in your spam folder the first time. If it does, please open it and click "Not Spam" — that tells Gmail it's safe, and future emails will go straight to your inbox.

The email will have a link just for you. One click to say you're coming, one click if you can't make it. That's it — no login, no account, no app to install.

I'll send the RSVP link in the next day or two. Keep an eye out for it, and check spam if you don't see it.

Thanks —
${signoff}`));
// The short evergreen "how to handle RSVP" note — good now or for new members.
on('#rsvp-howto-btn', 'click', () => draftMemberEmail(
  ({ clubName }) => `How RSVP works for ${clubName}`,
  ({ clubName, signoff }) => `Hi ${clubName} members,

For our events you'll get an email from HilltopClubs2026@gmail.com with a link that's just for you. Tap it, then tap "I'm coming" or "Can't make it" — no password, no app. Changed your mind? Open the email again and tap the other one.

First time, check your spam folder and click "Not Spam" so future ones reach your inbox.

Thanks —
${signoff}`));

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
