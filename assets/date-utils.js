// The only module in this codebase that constructs a Date.
// Everything is anchored at UTC noon so daylight-saving transitions
// can never shift a date across a day boundary.

const DAY_MS = 86400000;
const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function parseISO(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toISO(new Date(parseISO(iso).getTime() + n * DAY_MS));
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY_MS);
}

export function weekdayKey(iso) {
  // getUTCDay(): 0 = Sunday. Shift so Monday is index 0.
  return KEYS[(parseISO(iso).getUTCDay() + 6) % 7];
}

// Elapsed hours since a full ISO timestamp (not a calendar date).
// `now` is injectable so this is testable without freezing the clock.
export function hoursSince(isoTimestamp, now = Date.now()) {
  return (now - new Date(isoTimestamp).getTime()) / 3600000;
}

// The local calendar date. Deliberately NOT derived from toISO(), which is
// UTC-based: "what date is it here, now" is a different question from
// "what does this ISO string mean".
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
