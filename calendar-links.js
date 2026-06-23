// Add-to-Calendar link builders, shared by the landing page (Today/Tomorrow
// widget) and the full club calendar page. Loaded as a plain script (not a
// module), so these become globals. Builds Google / Apple (.ics) / Outlook
// links client-side from an event's date + free-text time strings.

// Parse a free-text time like "12:30 PM" / "7:00pm" / "9 am" → {h, m} (24h).
function parseTime(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}
// Build a floating-local datetime stamp YYYYMMDDTHHMMSS for an event date
// (YYYY-MM-DD) + time string. Returns null if time can't be parsed.
function stampFor(dateStr, timeStr) {
  const t = parseTime(timeStr);
  if (!t) return null;
  const ymd = dateStr.replace(/-/g, '');
  const hh = String(t.h).padStart(2, '0');
  const mm = String(t.m).padStart(2, '0');
  return `${ymd}T${hh}${mm}00`;
}
function isoLocal(dateStr, timeStr) {
  const t = parseTime(timeStr);
  if (!t) return null;
  const hh = String(t.h).padStart(2, '0');
  const mm = String(t.m).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00`;
}
// Default end = start + 1h when no end time is given.
function defaultEndStamp(startStamp) {
  if (!startStamp) return null;
  const y = +startStamp.slice(0, 4), mo = +startStamp.slice(4, 6) - 1, d = +startStamp.slice(6, 8);
  const h = +startStamp.slice(9, 11), mi = +startStamp.slice(11, 13);
  const dt = new Date(y, mo, d, h + 1, mi);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}T${p(dt.getHours())}${p(dt.getMinutes())}00`;
}
function calendarLinks(ev) {
  const title = ev.eventName || ev.clubName || 'Hilltop club event';
  const startStamp = stampFor(ev.date, ev.startTime);
  if (!startStamp) return null; // can't build links without a start time
  const endStamp = stampFor(ev.date, ev.endTime) || defaultEndStamp(startStamp);
  const details = ev.note || `${ev.clubName} — see hilltopclubs.org/club/${ev.clubSlug}`;
  const loc = ev.location || 'Hilltop Clubhouse';

  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startStamp}/${endStamp}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(loc)}`;

  const startIso = isoLocal(ev.date, ev.startTime);
  const endIso = isoLocal(ev.date, ev.endTime) || startIso;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(title)}&startdt=${encodeURIComponent(startIso)}&enddt=${encodeURIComponent(endIso)}&location=${encodeURIComponent(loc)}&body=${encodeURIComponent(details)}&path=/calendar/action/compose&rru=addevent`;

  // Apple: a data: URI .ics download.
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hilltop Clubs//EN',
    'BEGIN:VEVENT',
    `DTSTART:${startStamp}`, `DTEND:${endStamp}`,
    `SUMMARY:${title.replace(/[,;]/g, '')}`,
    `LOCATION:${loc.replace(/[,;]/g, '')}`,
    `DESCRIPTION:${details.replace(/[,;\n]/g, ' ')}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\n');
  const apple = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;

  return { google, outlook, apple };
}
