// Tiny fetch wrapper around /api/* — exposed as window.ClubsAPI.

(function () {
  async function getJSON(path) {
    const res = await fetch(path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }
  async function postJSON(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }
  window.ClubsAPI = {
    getCategories: () => getJSON('/api/get-categories'),
    getClubsByCategory: (slug) => getJSON(`/api/get-clubs-by-category?slug=${encodeURIComponent(slug)}`),
    getAllClubs: () => getJSON('/api/get-clubs-by-category?all=1'),
    getClub: (slug) => getJSON(`/api/get-club?slug=${encodeURIComponent(slug)}`),
    getClubEvents: (slug) => getJSON(`/api/get-club-events?slug=${encodeURIComponent(slug)}`),
    getWeekEvents: () => getJSON('/api/get-week-events'),
    getMprToday: () => getJSON('/api/get-mpr-today'),
    getClubMailto: (slug) => getJSON(`/api/get-club-mailto?slug=${encodeURIComponent(slug)}`),
    leaderVerify: (payload) => postJSON('/api/leader-verify', payload),
    leaderUpdate: (payload) => postJSON('/api/leader-update', payload),
    leaderUploadThumbnail: (payload) => postJSON('/api/leader-upload-thumbnail', payload),
    leaderUploadFlyer: (payload) => postJSON('/api/leader-upload-flyer', payload),
    leaderRemoveImage: (payload) => postJSON('/api/leader-remove-image', payload),
    leaderDraftEmail: (payload) => postJSON('/api/leader-draft-email', payload),
  };
})();
