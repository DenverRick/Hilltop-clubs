// Tiny fetch wrapper around /api/* — exposed as window.ClubsAPI.

(function () {
  // Parse a response strictly as JSON. If the body isn't JSON (e.g. the resident
  // gate served an HTML login page after a session expiry, which fetch follows
  // transparently), do NOT silently return an empty object — that's how a save
  // that never persisted could report success. Throw a clear, actionable error.
  async function parseJSON(res) {
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = null; }
    if (data === null) {
      if (res.status === 401 || /<html|<!doctype/i.test(text)) {
        throw new Error('Your resident session has expired. Reload the page and sign in again.');
      }
      throw new Error(`Unexpected response from the server (status ${res.status}).`);
    }
    if (res.status === 429) {
      throw new Error('The directory is busy right now. Please wait a few seconds and refresh the page.');
    }
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }
  async function getJSON(path) {
    return parseJSON(await fetch(path));
  }
  async function postJSON(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseJSON(res);
  }
  window.ClubsAPI = {
    getCategories: () => getJSON('/api/get-categories'),
    getClubsByCategory: (slug) => getJSON(`/api/get-clubs-by-category?slug=${encodeURIComponent(slug)}`),
    getAllClubs: () => getJSON('/api/get-clubs-by-category?all=1'),
    getClub: (slug) => getJSON(`/api/get-club?slug=${encodeURIComponent(slug)}`),
    getClubEvents: (slug) => getJSON(`/api/get-club-events?slug=${encodeURIComponent(slug)}`),
    getWeekEvents: () => getJSON('/api/get-week-events'),
    getCalendarEvents: (weeks) => getJSON('/api/get-calendar-events' + (weeks ? `?weeks=${encodeURIComponent(weeks)}` : '')),
    getNewsletter: () => getJSON('/api/get-newsletter'),
    getSeniorGeeksNext: () => getJSON('/api/get-senior-geeks-next'),
    getClubMailto: (slug) => getJSON(`/api/get-club-mailto?slug=${encodeURIComponent(slug)}`),
    leaderVerify: (payload) => postJSON('/api/leader-verify', payload),
    leaderUpdate: (payload) => postJSON('/api/leader-update', payload),
    leaderUploadThumbnail: (payload) => postJSON('/api/leader-upload-thumbnail', payload),
    leaderUploadFlyer: (payload) => postJSON('/api/leader-upload-flyer', payload),
    leaderRemoveImage: (payload) => postJSON('/api/leader-remove-image', payload),
    leaderDraftEmail: (payload) => postJSON('/api/leader-draft-email', payload),
    leaderRsvpSetup: (payload) => postJSON('/api/leader-rsvp-setup', payload),
    leaderEvents: (payload) => postJSON('/api/leader-events', payload),
  };
})();
