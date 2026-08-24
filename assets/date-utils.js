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
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

// The "YYYY-MM" a date falls in. Month identity is a string prefix, not a
// Date — no parsing needed, and no timezone can move it.
export function ymOf(iso) {
  return iso.slice(0, 7);
}

// Month arithmetic done in whole months, not in days: adding 30 days to a
// month is wrong twice a year, and adding a month to the 31st is undefined.
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  // Day 0 of the NEXT month is the last day of this one, which spares us
  // both the 30/31 table and the leap-year rule.
  return new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
}

// A month as Monday-first rows of seven. Cells outside the month are null
// rather than dates from the neighbouring months: a training day belongs to
// exactly one month grid, so no cell is ever rendered twice.
export function monthGrid(ym) {
  const lead = KEYS.indexOf(weekdayKey(`${ym}-01`));
  const total = daysInMonth(ym);
  const rows = [];

  for (let i = 0; i < lead + total; i++) {
    if (i % 7 === 0) rows.push([]);
    rows.at(-1).push(i < lead ? null : `${ym}-${String(i - lead + 1).padStart(2, '0')}`);
  }
  // Only the final row can come up short; pad it out so every row is seven.
  while (rows.at(-1).length < 7) rows.at(-1).push(null);

  return rows;
}
