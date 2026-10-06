# 70.3 Training Tracker

**Live:** https://saroldhand.github.io/ironman-coach/

Static training site for IRONMAN 70.3 Hawaii on 2027-06-05. No build step, no dependencies.

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

Four zoom levels: Season › Month › Week › Day.

| View | Hash | Shows |
|---|---|---|
| Day | `#/day/2026-10-06`, `#/today` | Every session prescribed that day, plus what Strava recorded |
| Week | `#/week/strength/6` | The seven days side by side |
| Month | `#/month/2026-10` | A calendar grid; one dot per session, coloured by discipline |
| Season | `#/season`, `#/season/arc/21` | Every week of every block, with completion bars; opened on a week, it scrolls to it |

In the month grid the left gutter names each row's plan week and links to it;
each day cell links to its day. A malformed date in the hash falls back to today
rather than erroring, and a week that does not exist shows this week.

### Getting around

Every page has the same four ways to move:

- **Back** returns to the previous page, at the scroll position you left it.
  On a page opened cold, from a bookmark or a shared link, it goes up one level
  instead, so it never leaves the site.
- **The trail** beside it, `Season › May 2027 › Arc W21 › Sat 1 May`, names where
  you are, and each step links back up. On a phone the Season step is left to the
  Season tab, which goes to the same place.
- **The pager** steps to the neighbours at the same level, and back to today,
  this week or this month from anywhere else.
- **The level tabs** keep the date you are looking at. From a day in May, Week
  opens that day's week and Season opens scrolled to it. 70.3 goes to today.

Back and the trail sit in the sticky header, so they stay on screen however far
down a page you are. The logic lives in `assets/nav-model.js`.

## Local development

```bash
python -m http.server 8000   # then open http://localhost:8000
npm test                     # node --test, no install needed
```

## Syncing

The nightly Claude scheduled task follows `scripts/sync-runbook.md`. To sync manually,
ask Claude in this repo: "sync the last 7 days from Strava".
