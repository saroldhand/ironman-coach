# Restyle: Scarlet & Paper with Rings — Design

**Date:** 2026-11-03
**Status:** Direction chosen by the athlete on 2026-11-03 from the mockups in the "70.3 Restyle Directions" canvas (artboard *A + C · practice start*).
**Scope:** the site's look only. Every page, link, number, rule and test-covered behaviour stays as it is.

---

## 1. Why

The site works, but the pastel palette and plain cards read as a prototype. The athlete asked for a lighter, polished, modern-app look built around a dark scarlet, "more than just a colour change", with features and functionality unchanged.

They also asked for the morning's **start time** to lead: *"Give me a time that my workout starts so I can treat it like I'm going to practice, like it's beyond my control."* The site already works out that time for every work morning (`schedule-model.morning`: start = ready-by minus the after-routine, travel, change and session). The restyle makes it the headline, with the alarm and lights-out supporting it.

## 2. The direction

Three directions were mocked up against today's look (A Scarlet & Paper, B Precision, C Race Day). The athlete chose **A**, taking from **C** the progress rings and the dark Tonight box.

| | |
|---|---|
| Ground | Warm paper `#FAF7F5`; white cards, 20 px radius, a soft two-layer shadow, no left-border stripes |
| Brand | Scarlet `#C8102E` for the brand, today, the next practice, the alarm and the week's total. Never for "missed": red would read as an error |
| Ink | `#1C1917`, muted `#6F6661` (5.6:1 on the ground), lines `#EDE7E3` / `#F1EBE7` |
| Disciplines | Swim teal `#1F6F8B`, bike ochre `#B7791F` (ink `#94600F`), run green `#2F7D52`, lift violet `#5B4B8A`. Retuned to sit beside red, and different in lightness as well as hue |
| Type | Inter (Google Fonts) 400–800, tabular numbers everywhere; tight negative tracking on large numerals |
| Icons | Inline stroke SVG, drawn from a small set in `assets/icons.js`: wave (swim), bike, runner, dumbbell (lift), moon, alarm, bag, sun, calendar, grid, chart, chevrons, check. No icon font, no dependency |
| Night card | The Tonight box is dark (`#1A1716`) with white numerals; everything else stays light |

## 3. Components

- **Header:** "70.3" wordmark in scarlet, a countdown pill ("214 days to go"), then Back and the breadcrumb trail, unchanged in behaviour. The view tabs (Day, Week, Month, Season) sit top right on a wide screen and become a **bottom tab bar** with icons on a phone. Same links, same `data-view` re-pointing.
- **Page head:** a scarlet eyebrow (block and week, or the date), a large title, a muted line under it, and the pager as round previous and next buttons, with the "This week / Today / This month" link as a pill between them. Their labels move to `aria-label` and `title`.
- **Week strip:** seven day chips above a week. Today is filled scarlet, and a dot shows the day's state: green when every session has a recorded activity, hollow when it is still to come or unknown.
- **Tonight (dark):** "PRACTICE STARTS 6:17 am" as the hero, with the session and venue under it. Then tiles: lights out, alarm (scarlet outline), leave, done, home and the ready-by time. Then what to eat, the kit to pack, any lunch session, and the link to the day. Days off, weekends and lifting-block days keep their existing wording.
- **The day's own morning card (light):** the same structure, titled *Practice* ("Starts 6:15 am"), on each work day's page.
- **Progress card:** four **rings** for time per discipline against the plan (against the typical week or month with no plan). Beside them, the total ("2.2 / 5.7 h") and a legend. Below, slim **distance bars** for swim, bike and run. The targets and labels are exactly as now: plan, `≈` estimate, or typical, and "—" when a finished period recorded nothing. A ring or bar past its target turns to the discipline's ink.
- **Day groups (week page):** one card per day. Its header gives the day, the practice start, the alarm or "off work", and a Today/Tomorrow badge. Its rows give each session with its discipline icon, title, summary, amount and status mark (done ✓, partial ½, missed ×, still to come ○). History weeks list each recorded activity instead.
- **Session cards (day page):** a discipline icon chip, title, tags (before work, lunch, optional, done/partial/missed) and amount, then effort, set lines, detail and the recorded line with its Strava link.
- **Month:** the progress card, then the calendar as rounded white cells. Today has a scarlet ring, recovery weeks a faint tint, dots in discipline colours, and the week gutter as pills.
- **Season:** rows as one card per block. The current week is tinted scarlet, the completion bar is green, and hours read "done/planned".
- **Banner:** amber, with an icon, for sync warnings.

## 4. What must not change

- Every route, link, pager target, breadcrumb, Back behaviour and level-tab target (`nav-model`, `app-state`).
- Every number: alarms, lights-out, start times, hours, targets, estimates, completion, units (miles for rides and runs, metres for swims).
- The data files, the schedule rules, the sync, and the Strava matching.
- The tests. The only changes are additions: `morning()` also returns `start`, and `weekSummary()` also gives each work morning's start and the week's earliest one. The week headline says "earliest start" instead of "earliest alarm", and the alarm stays on every day.

## 5. Building it

- `index.html`: Inter, `theme-color`, the header and tab bar with inline icons.
- `assets/icons.js`: icon paths as data, and one `icon(name)` that builds an SVG.
- `assets/app.css`: rewritten on the tokens above. Phone first, with a wide layout from 720 px (top tabs, a 720 px reading column, a 960 px grid).
- `assets/render.js`: the components above. The pure helpers (`summaryLine`, `fuelLines`, `disciplineBars`, `periodBars`, formatting) keep their contracts. New pure helpers (`weekRangeText`, `ringDash`, `shortTarget`) are tested.
- `assets/app.js`: the countdown wording only.

## 6. Checking it

- `npm test` green.
- Headless Chromium at 390 px and 1280 px, with the clock fixed, on:
  - Today, morning and evening;
  - a plan week, a history week and a recovery week;
  - a work day, a weekend day, a day off and race day;
  - a plan month and a history month;
  - the Season page.
- No console errors. Screenshots go to the athlete before anything merges.

## 7. Not now

- Dark mode.
- Installing as an app (manifest, icons, offline cache).
- Animated page transitions.
- A season chart.

Each fits on top of these tokens later.
