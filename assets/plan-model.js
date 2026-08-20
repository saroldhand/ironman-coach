import { daysBetween, weekdayKey } from './date-utils.js';

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
