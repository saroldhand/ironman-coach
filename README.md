# 70.3 Training Tracker

**Live:** https://saroldhand.github.io/ironman-coach/

Static training site for IRONMAN 70.3 Hawaii on 2027-06-05. No build step, no dependencies.

## What is here

- `data/plan.json` — the plan. The only file to edit when training changes.
- `data/log.json` — what actually happened. Written by the nightly Strava sync.
- `assets/` — ES modules, loaded directly by the browser and importable by `node --test`.
  The look lives in `app.css` (design tokens at the top: warm paper, white cards,
  one scarlet `#C8102E`, a colour per discipline) and the icons in `icons.js`
  (stroke SVG as data). The design is `docs/superpowers/specs/2026-11-03-restyle-design.md`.
- `scripts/sync-runbook.md` — what the nightly sync does; `scripts/sync.mjs` does it.

## Calendar

| Block | Weeks | Start | End |
|---|---|---|---|
| History | 14 | 2026-08-03 | 2026-11-08 |
| Bridge | 4 | 2026-11-09 | 2026-12-06 |
| Arc | 26 | 2026-12-07 | 2027-06-06 |

The plan starts on Monday 9 November 2026. Its first designs (a three-week prep
block and an eight-week lifting block) were cut from the site on 2026-11-02 and
stay in `docs/superpowers/` as history. The weeks before the plan are a
**History** block (`"history": true`): nothing is prescribed, and each week, day
and month shows only what Strava recorded, back-filled from the first recorded
activity on 2026-08-03.

Each block numbers its weeks from 1, so week labels always name their block.
Every week is a named template in `weekTemplates`, filled from that week's row
in `progression`: one template per phase, plus one-off weeks for the
Thanksgiving trip and race week. A recovery week is lighter because its row's
numbers are, not because of a rule.

The Bridge is four weeks back into triathlon: the Arc's week at lower volume, all
Zone 2, three swims a week, with the Thanksgiving trip written into weeks 3 and 4.

Arc is the build to the race: Base (weeks 1–8), Build (9–16), Race-specific (17–24)
and a two-week Taper that ends on race day. Each row of `progression.arc` carries
that week's durations, distances and session text. The reasoning behind the numbers is in
`docs/superpowers/specs/2026-10-05-arc-block-design.md`, as amended by
`docs/superpowers/specs/2026-11-02-bridge-and-mornings-design.md`.

## Training to the clock

Most sessions happen before work, so the site works out each morning from
`plan.schedule`: when you have to be ready (7:45 to leave for the office, 8:15 at
the desk at home), how far the pool is and when it opens, and 8 hours of sleep.
From those it gives the alarm, lights-out the night before, the timeline from
leaving to ready, whether to eat first, and the kit to lay out (`plan.kit`).

`schedule.routine` says where each weekday session happens (Monday swim and
strength before work at the pool, the Monday run at lunch, Tuesday on the
trainer at home, and so on). Templates opt in with `routine: true`.
`schedule.daysOff` lists holidays and travel, which get no alarm. The arithmetic
is in `assets/schedule-model.js`, and the data tests hold every work morning in
the plan to the athlete's hours: never in the pool before it opens, never an
alarm before 5:30.

## Views

Four zoom levels: Season › Month › Week › Day.

| View | Hash | Shows |
|---|---|---|
| Day | `#/day/2026-11-17`, `#/today` | Every session prescribed that day, plus what Strava recorded. A work day opens with its alarm, lights-out and kit; today also has a *Tonight* card for tomorrow, which leads the page after midday. |
| Week | `#/week/bridge/2` | The seven days side by side, with the week's hours and each morning's alarm. Once the week starts, *Done this week* sets the time and distance Strava recorded against the plan, per discipline. |
| Month | `#/month/2026-10` | A calendar grid; one dot per session, coloured by discipline |
| Season | `#/season`, `#/season/arc/21` | Every week of every block, with hours (done/planned once anything is recorded) and completion bars; opened on a week, it scrolls to it |

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

### What was done

The week and month pages show a time bar and a distance bar for swim, bike and
run, and a time bar for lifting. They count every training activity in
`data/log.json` dated inside the period, matched to a session or not. Walks and
hikes stay in the log but are never counted or listed; HIIT and CrossFit count
as lifting. A bar fills toward a target, and its label says which:

- the plan, where the period has one: planned time, planned swim metres;
- for ride and run distance in a planned period, the planned time at your
  usual speed (all recorded distance over all moving time), marked `≈`;
- with no plan, your typical week or month: the median of the periods in which
  you did that discipline, so one big touring week does not flatten the rest.

Every plan week and plan month shows its bars from the start, empty against
its planned totals, and they fill as the nightly sync records workouts: a
period still under way reads as progress so far, from zero. Only a period that
is over and recorded nothing shows dashes, not zeros: no data is not rest.

The Claude scheduled task follows `scripts/sync-runbook.md` every night: it fetches
yesterday's and today's activities with the Strava connector's `list_activities` and hands them to
`node scripts/sync.mjs <from> <to> <activities.json>`, which matches them to the
plan and writes `data/log.json` and `data/sync-status.json`. To sync manually, ask
Claude in this repo: "sync the last 7 days from Strava". The Strava connector must
be connected in that session.

### Sync now

The round button at the top right of every page runs the Strava sync now, so a
workout is on the plan a minute or two after Strava has it. A static page cannot
start the Claude scheduled task itself (its fire endpoint takes no calls from a
browser), so the button asks GitHub to run `.github/workflows/sync-now.yml`, and
that fires the task. The task syncs yesterday and today and pushes to `main` as
it does every night. The page watches `data/sync-status.json` and redraws when
the run lands.

One-time setup:

1. **Give the workflow the task's token.** At claude.ai/code/routines, open
   *Nightly Strava sync — 70.3 training site*, open the menu next to its name
   and choose **Edit**. In the **Trigger** row click **+**, choose **API**, then
   **Generate token**, and copy it: it is shown once. Check that the **Fire URL**
   shown there matches `FIRE_URL` in `.github/workflows/sync-now.yml`. Then, in
   this repo on GitHub: **Settings → Secrets and variables → Actions → New
   repository secret**, named `SYNC_FIRE_TOKEN`.
2. **Make a GitHub token for the button.** GitHub **Settings → Developer
   settings → Personal access tokens → Fine-grained tokens → Generate new
   token**. Name it "70.3 Sync button", set it to expire after race day, choose
   **Only select repositories → ironman-coach**, and under **Repository
   permissions** set **Actions** to **Read and write**. Nothing else.
3. **Tap Sync on the site** on each phone or computer you use, paste the token
   and tap **Save and sync**. It is kept in that browser's storage only, never
   in the repo, and it can do nothing but run and read this repo's workflows.

If GitHub turns the token down (expired, revoked), the button asks for a new
one. On a device with no token, open the task at claude.ai/code/routines and
tap **Run now**: it is the same sync.
