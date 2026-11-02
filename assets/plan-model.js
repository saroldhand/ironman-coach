import { daysBetween, weekdayKey, addDays, monthGrid } from './date-utils.js';

function phaseFor(block, week) {
  if (!block.phases) return null;
  const p = block.phases.find(p => week >= p.from && week <= p.to);
  return p ? p.label : null;
}

// Blocks in chronological order, regardless of the order they appear in
// plan.json. ISO date strings compare correctly as strings, so this needs
// no date arithmetic.
export function blocksInOrder(plan) {
  return [...plan.blocks].sort((a, b) => a.start.localeCompare(b.start));
}

// The plan's first day. Derived from the earliest block rather than blocks[0],
// so nothing depends on the order blocks appear in plan.json.
export function planStart(plan) {
  return blocksInOrder(plan)[0].start;
}

// Previous and next plan week across block boundaries. Returns null at each
// end of the plan.
export function weekNav(plan, blockId, week) {
  const flat = [];
  for (const b of blocksInOrder(plan)) {
    for (let n = 1; n <= b.weeks; n++) flat.push({ blockId: b.id, week: n });
  }
  const i = flat.findIndex(x => x.blockId === blockId && x.week === week);
  return { prev: flat[i - 1] || null, next: flat[i + 1] || null };
}

export function dayForDate(plan, iso) {
  for (const block of plan.blocks) {
    const offset = daysBetween(block.start, iso);
    if (offset < 0 || offset >= block.weeks * 7) continue;

    const week = Math.floor(offset / 7) + 1;
    const progression = (plan.progression[block.id] || []).find(w => w.week === week);

    return {
      inPlan: true,
      blockId: block.id,
      blockLabel: block.label,
      week,
      weekType: block.authored && progression ? progression.type : 'unauthored',
      dayKey: weekdayKey(iso),
      date: iso,
      phaseLabel: phaseFor(block, week),
      authored: Boolean(block.authored && progression)
    };
  }

  // No block contains this date. Which side of the plan is it on?
  const start = planStart(plan);
  return daysBetween(start, iso) < 0
    ? { inPlan: false, reason: 'before-start' }
    : { inPlan: false, reason: 'after-end' };
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const PLACEHOLDER = /\{(\w+)\}/g;

// Text in a week template carries {name} tokens filled from that week's
// progression row, which is what lets one Arc template serve easy, test and
// interval weeks alike.
// An unknown token is left as written: a visible "{wedMain}" on the page is a
// bug that reports itself, where "undefined" reads like prescribed text.
function fillPlaceholders(line, progression) {
  return line.replace(PLACEHOLDER, (token, name) =>
    progression[name] === undefined ? token : String(progression[name]));
}

// Where and when a session happens is a fact about the athlete's week, not
// about any one template: the Monday swim is before work at the pool in every
// phase. So it lives once, in plan.schedule.routine, keyed by weekday and
// discipline, and a template opts in with `routine: true`. A session can
// still say otherwise for itself - an away day sets `when: "anytime"` - and an
// explicit empty kit list wins over the routine's.
function placeSession(template, routineDay) {
  const r = (routineDay && routineDay[template.discipline]) || {};
  const pick = key => (key in template ? template[key] : r[key]);
  return {
    when: pick('when') || 'anytime',
    venue: pick('venue') || null,
    kit: pick('kit') || []
  };
}

function buildSession(template, ctx) {
  const { blockId, week, dayKey, progression, routineDay } = ctx;
  // Every word a session shows can carry a token, not only its set lines: the
  // title and effort are what change between an easy week and a test week.
  const fill = text => (typeof text === 'string' ? fillPlaceholders(text, progression) : text);
  const s = {
    key: `${blockId}:${week}:${dayKey}:${template.discipline}`,
    discipline: template.discipline,
    title: fill(template.title),
    optional: Boolean(template.optional),
    effort: fill(template.effort),
    detail: (template.detail || []).map(fill),
    setLines: (template.setLines || []).map(fill),
    prescribed: { ...template.prescribed },
    ...placeSession(template, routineDay)
  };

  // Amounts that change week to week are read from the progression row.
  if (template.prescribed.fromProgression) {
    s.prescribed.value = progression[template.prescribed.fromProgression];
    delete s.prescribed.fromProgression;
  }

  return s;
}

export function resolveWeek(plan, blockId, week) {
  const block = plan.blocks.find(b => b.id === blockId);
  const progression = (plan.progression[blockId] || []).find(w => w.week === week);
  const startDate = addDays(block.start, (week - 1) * 7);

  if (!block.authored || !progression) {
    return {
      blockId, blockLabel: block.label, week,
      type: 'unauthored', authored: false, startDate, days: [],
      note: block.note
    };
  }

  // Each week is a named template filled from its progression row: one
  // template serves every week of a phase, and a one-off week (the
  // Thanksgiving trip, race week) gets its own. A recovery week is lighter
  // because its row says so, not because of any rule applied here.
  const weekTemplate = plan.weekTemplates[progression.template];
  // Fuelling merges key by key where dayTypes replaces wholesale: a template
  // that only raises the long-ride carb rate still needs the global rules for
  // short sessions and recovery.
  const fuel = { ...plan.nutrition.fuel, ...(weekTemplate.fuel || {}) };

  const routine = weekTemplate.routine && plan.schedule ? plan.schedule.routine : null;

  const days = DAY_KEYS.map((dayKey, i) => ({
    dayKey,
    date: addDays(startDate, i),
    nutrition: plan.nutrition.types[weekTemplate.dayTypes[dayKey]],
    fuel,
    // A template need not fill all seven days; the calendar still shows them.
    sessions: (weekTemplate.days[dayKey] || []).map(t =>
      buildSession(t, { blockId, week, dayKey, progression,
                        routineDay: routine ? routine[dayKey] : null }))
  }));

  return {
    blockId, blockLabel: block.label, week,
    type: progression.type, authored: true, startDate, days
  };
}

// A month laid out for the calendar view: Monday-first rows of seven, each
// row carrying the plan week it covers so the grid can label its gutter.
// Pure — it knows nothing about what was logged, which is the render layer's
// job to overlay.
export function monthRows(plan, ym) {
  // Resolving a week rebuilds every session in it, and seven cells in a row
  // ask for the same week. Resolve each one once per month.
  const weeks = new Map();
  const resolved = (blockId, week) => {
    const k = `${blockId}:${week}`;
    if (!weeks.has(k)) weeks.set(k, resolveWeek(plan, blockId, week));
    return weeks.get(k);
  };

  const cellFor = iso => {
    const day = dayForDate(plan, iso);
    if (!day.inPlan) return { date: iso, inPlan: false, sessions: [] };

    const week = resolved(day.blockId, day.week);
    const resolvedDay = week.days.find(d => d.dayKey === day.dayKey);

    return {
      date: iso,
      inPlan: true,
      blockId: day.blockId,
      blockLabel: day.blockLabel,
      week: day.week,
      weekType: day.weekType,
      authored: day.authored,
      sessions: (resolvedDay ? resolvedDay.sessions : []).map(s => ({
        key: s.key, discipline: s.discipline, optional: s.optional
      }))
    };
  };

  return monthGrid(ym).map(row => {
    const cells = row.map(iso => (iso ? cellFor(iso) : null));
    // The week label comes from the row's first planned day. Blocks start on
    // Mondays, so a calendar row holds at most one plan week — but a row that
    // straddles a block edge still gets the label of the week it opens with.
    const first = cells.find(c => c && c.inPlan);
    return {
      week: first
        ? { blockId: first.blockId, blockLabel: first.blockLabel, week: first.week,
            type: first.weekType }
        : null,
      cells
    };
  });
}
