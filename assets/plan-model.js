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

function swimSetLines(plan, template, dayKey, progression) {
  if (dayKey === 'mon') return [...plan.sets.monTechnique];
  if (dayKey === 'fri') return [...plan.sets.friMixed];
  if (dayKey === 'wed') {
    if (progression.wedStructureOverride) return [...progression.wedStructureOverride];
    const { warmup, cooldown } = plan.sets.wedMain;
    return [...warmup, `MAIN SET: ${progression.wedMainSet}`, ...cooldown];
  }
  return [];
}

const PLACEHOLDER = /\{(\w+)\}/g;

// Set lines in a week template carry {name} tokens filled from that week's
// progression row, which is what lets four GVT weeks share one template.
// An unknown token is left as written: a visible "{gvt}" on the page is a
// bug that reports itself, where "undefined" reads like prescribed text.
function fillPlaceholders(line, progression) {
  return line.replace(PLACEHOLDER, (token, name) =>
    progression[name] === undefined ? token : String(progression[name]));
}

function buildSession(plan, template, ctx) {
  const { blockId, week, dayKey, progression, isRecovery } = ctx;
  const s = {
    key: `${blockId}:${week}:${dayKey}:${template.discipline}`,
    discipline: template.discipline,
    title: template.title,
    optional: Boolean(template.optional),
    effort: template.effort,
    detail: [...(template.detail || [])],
    setLines: [],
    prescribed: { ...template.prescribed }
  };

  // Weekend long sessions read their duration from the progression table.
  if (template.prescribed.fromProgression) {
    s.prescribed.value = progression[template.prescribed.fromProgression];
    delete s.prescribed.fromProgression;
  }

  if (template.discipline === 'swim') {
    if (dayKey === 'wed') s.prescribed.value = progression.wedDistance;
    else if (isRecovery && plan.recovery.swimDeltaAppliesTo.includes(dayKey)) {
      s.prescribed.value += plan.recovery.swimDeltaMetres;
    }
    s.setLines = swimSetLines(plan, template, dayKey, progression);
  }

  if (template.setRef === 'strength') s.setLines = [...plan.sets.strength];

  // Templates carry their set lines literally; the skeleton derives swim sets
  // from the weekday instead, so this must not clobber that.
  if (template.setLines) {
    s.setLines = template.setLines.map(l => fillPlaceholders(l, progression));
  }

  if (isRecovery) {
    if (dayKey === 'tue') s.prescribed.value = plan.recovery.tue.durationMin;
    if (dayKey === 'thu') {
      s.prescribed.value = plan.recovery.thu.durationMin;
      if (plan.recovery.thu.dropStrides) {
        s.detail = s.detail.filter(line => !line.toLowerCase().includes('stride'));
      }
    }
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

  // A block either draws its week from the one global skeleton (the tri
  // blocks, whose shape never changes) or from a named template chosen by
  // the progression row (the strength block, whose shape alternates).
  const template = block.weekSource === 'weekTemplates'
    ? plan.weekTemplates[progression.template]
    : null;
  const source = template ? template.days : plan.skeleton;
  const dayTypes = (template && template.dayTypes) || plan.nutrition.dayTypes;

  // The recovery deltas describe the tri week specifically — skipStrength
  // would delete a whole lifting week. A template block carries its own
  // deload, so it opts out of the rules while keeping the label.
  const isRecovery = !template && progression.type === 'recovery';

  const days = DAY_KEYS.map((dayKey, i) => {
    // A template need not fill all seven days; the calendar still shows them.
    let templates = source[dayKey] || [];
    if (isRecovery && plan.recovery.skipStrength) {
      templates = templates.filter(t => t.discipline !== 'strength');
    }
    const typeKey = dayTypes[dayKey];
    return {
      dayKey,
      date: addDays(startDate, i),
      nutrition: plan.nutrition.types[typeKey],
      sessions: templates.map(t =>
        buildSession(plan, t, { blockId, week, dayKey, progression, isRecovery }))
    };
  });

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
