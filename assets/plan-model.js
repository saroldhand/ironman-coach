import { daysBetween, weekdayKey, addDays } from './date-utils.js';

function phaseFor(block, week) {
  if (!block.phases) return null;
  const p = block.phases.find(p => week >= p.from && week <= p.to);
  return p ? p.label : null;
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
  // Derived from the earliest block, not blocks[0], so the result does not
  // depend on the order blocks happen to appear in plan.json.
  const earliest = plan.blocks.reduce((a, b) => (daysBetween(b.start, a.start) <= 0 ? a : b));
  return daysBetween(earliest.start, iso) < 0
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

  const isRecovery = progression.type === 'recovery';

  const days = DAY_KEYS.map((dayKey, i) => {
    let templates = plan.skeleton[dayKey];
    if (isRecovery && plan.recovery.skipStrength) {
      templates = templates.filter(t => t.discipline !== 'strength');
    }
    const typeKey = plan.nutrition.dayTypes[dayKey];
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
