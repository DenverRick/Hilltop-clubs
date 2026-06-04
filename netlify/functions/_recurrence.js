// Recurrence engine for MeetingSlots.
//
// Adapted from the Calendar app's src/calendar.js. Given a slot with a Day,
// Recurrence rule, and optional Recurrence Reference Date, returns the list
// of upcoming dates within a window.
//
// Recurrence rules supported:
//   - "Weekly"       — every occurrence of slot.day
//   - "1st"–"4th"    — that ordinal occurrence of slot.day in each month
//   - "Last"         — last occurrence of slot.day in each month
//   - "Every other"  — every 2 weeks, anchored to Recurrence Reference Date
//
// All date math is calendar-day; no timezone conversion (slot dates are
// floating local dates from the resident's perspective).

const DAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

// Parse YYYY-MM-DD to a Date in local time at midnight.
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Format a Date as YYYY-MM-DD.
function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// First day of next month.
function nextMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

// Returns the date of the Nth occurrence of `dayIndex` (0-6) in the given
// year/month. `n` is 1..4 for 1st..4th, or "last" for last.
// Returns null if Nth occurrence doesn't exist (e.g., 4th Thursday in a
// month with only 3).
function nthDayOfMonth(year, month0, dayIndex, n) {
  if (n === 'last') {
    // Walk backward from the last day of the month.
    const last = new Date(year, month0 + 1, 0); // day 0 of next month = last day of this month
    const offset = (last.getDay() - dayIndex + 7) % 7;
    return new Date(year, month0, last.getDate() - offset);
  }
  // First day of the month → step to the first matching weekday
  const first = new Date(year, month0, 1);
  const firstOffset = (dayIndex - first.getDay() + 7) % 7;
  const firstMatch = new Date(year, month0, 1 + firstOffset);
  const result = new Date(year, month0, firstMatch.getDate() + (n - 1) * 7);
  // Validate result is still in the same month
  if (result.getMonth() !== month0) return null;
  return result;
}

// Returns the next date >= start whose weekday is dayIndex.
function nextWeekday(start, dayIndex) {
  const offset = (dayIndex - start.getDay() + 7) % 7;
  return addDays(start, offset);
}

/**
 * Expand a MeetingSlot's recurrence into concrete dates within [windowStart, windowEnd].
 *
 * @param {object} slot - { day: 'Tuesday', recurrence: 'Weekly', referenceDate: '2026-05-12' }
 * @param {Date} windowStart - earliest date (inclusive)
 * @param {Date} windowEnd - latest date (inclusive)
 * @returns {Date[]} ascending list of dates
 */
export function expandRecurrence(slot, windowStart, windowEnd) {
  const dayIndex = DAY_INDEX[slot.day];
  if (dayIndex === undefined) return [];

  const recurrence = (slot.recurrence || '').trim();
  const out = [];

  if (recurrence === 'Weekly') {
    let d = nextWeekday(windowStart, dayIndex);
    while (d <= windowEnd) {
      out.push(d);
      d = addDays(d, 7);
    }
    return out;
  }

  if (recurrence === 'Last') {
    let monthCursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    while (monthCursor <= windowEnd) {
      const candidate = nthDayOfMonth(monthCursor.getFullYear(), monthCursor.getMonth(), dayIndex, 'last');
      if (candidate && candidate >= windowStart && candidate <= windowEnd) out.push(candidate);
      monthCursor = nextMonth(monthCursor);
    }
    return out;
  }

  const ordinalMatch = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 }[recurrence];
  if (ordinalMatch) {
    let monthCursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    while (monthCursor <= windowEnd) {
      const candidate = nthDayOfMonth(monthCursor.getFullYear(), monthCursor.getMonth(), dayIndex, ordinalMatch);
      if (candidate && candidate >= windowStart && candidate <= windowEnd) out.push(candidate);
      monthCursor = nextMonth(monthCursor);
    }
    return out;
  }

  if (recurrence === 'Every other') {
    const reference = parseDate(slot.referenceDate);
    if (!reference) return [];
    // Snap reference to the slot's weekday if it's off (defensive).
    const snapOffset = (dayIndex - reference.getDay() + 7) % 7;
    let anchor = addDays(reference, snapOffset);
    // Walk forward from anchor in 14-day steps until past windowStart.
    while (anchor < windowStart) {
      anchor = addDays(anchor, 14);
    }
    while (anchor <= windowEnd) {
      out.push(anchor);
      anchor = addDays(anchor, 14);
    }
    return out;
  }

  // Unknown recurrence type — return empty rather than guess.
  return [];
}

export { fmt, parseDate, addDays };
