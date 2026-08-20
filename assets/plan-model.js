import { daysBetween, weekdayKey } from './date-utils.js';

function phaseFor(block, week) {
  if (!block.phases) return null;
  const p = block.phases.find(p => week >= p.from && week <= p.to);
  return p ? p.label : null;
}

export function dayForDate(plan, iso) {
  const first = plan.blocks[0];
  if (daysBetween(first.start, iso) < 0) return { inPlan: false, reason: 'before-start' };

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

  return { inPlan: false, reason: 'after-end' };
}
