# 70.3 Training Tracker

**Live:** https://saroldhand.github.io/ironman-coach/

Static training site for an Ironman 70.3 on 2027-06-05. No build step, no dependencies.

## What is here

- `data/plan.json` — the plan. The only file to edit when training changes.
- `data/log.json` — what actually happened. Written by the nightly Strava sync.
- `assets/` — ES modules, loaded directly by the browser and importable by `node --test`.
- `scripts/sync-runbook.md` — what the nightly sync does.

## Calendar

| Block | Weeks | Start | End |
|---|---|---|---|
| Prep | 3 | 2026-08-24 | 2026-09-13 |
| Strength | 12 | 2026-09-14 | 2026-12-06 |
| Arc | 26 | 2026-12-07 | 2027-06-06 |

Prep, Strength and Arc each number weeks from 1, so week labels always name their block.

The Strength block is a lifting cycle: five mornings a week for weeks 1–8 (GVT),
then three for weeks 9–12 (powerbuilding) as cardio ramps back up. Its weeks come
from `weekTemplates` in `plan.json` rather than the global `skeleton`, because its
shape alternates week to week.

Arc is the build to the race: Base (weeks 1–8), Build (9–16), Race-specific (17–24)
and a two-week Taper that ends on race day. It also draws on `weekTemplates`, one per
phase plus race week, and each row of `progression.arc` carries that week's durations,
distances and session text. The reasoning behind the numbers is in
`docs/superpowers/specs/2026-10-05-arc-block-design.md`.

## Views

Four zoom levels, each linked to the ones either side of it:

| View | Hash | Shows |
|---|---|---|
| Day | `#/day/2026-10-06`, `#/today` | Every session prescribed that day, plus what Strava recorded |
| Week | `#/week/strength/6` | The seven days side by side |
| Month | `#/month/2026-10` | A calendar grid; one dot per session, coloured by discipline |
| Season | `#/season` | Every week of every block, with completion bars |

In the month grid the left gutter names each row's plan week and links to it;
each day cell links to its day. A malformed date in the hash falls back to today
rather than erroring.

## Local development

```bash
python -m http.server 8000   # then open http://localhost:8000
npm test                     # node --test, no install needed
```

## Syncing

The nightly Claude scheduled task follows `scripts/sync-runbook.md`. To sync manually,
ask Claude in this repo: "sync the last 7 days from Strava".
