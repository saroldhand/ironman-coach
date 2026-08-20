# Ironman 70.3 Training Site — Design

**Date:** 2026-08-20
**Status:** Approved (brainstorming complete, pre-implementation)

---

## 1. Purpose

A static site on GitHub Pages showing what training is scheduled for today and this week, with completed sessions filled in automatically from Strava by a nightly Claude scheduled task.

The site's job is the thing Strava does not hold: **what you are supposed to do**, written out in full — swim sets, effort targets, nutrition day type, fuel rules — and whether you did it. Strava remains the system of record for raw activity data. The site never duplicates Strava's analysis.

## 2. Constraints

- GitHub Pages is static. No server, no secrets, no runtime API calls to Strava.
- The Strava MCP connector runs inside Claude, not in the browser. The page can never call Strava directly.
- Strava MCP is not yet connected (open item in the training handoff). The site must ship and be useful with an empty log.
- No build step. Files pushed to `main` are the files served.

## 3. Calendar

Race: **Saturday 2027-06-05** (venue/registration TBD).

The written plan is a 26-week arc; the race is 41 weeks out. Training starts now, so the calendar is three blocks with independent week numbering:

| Block | Weeks | Start (Mon) | End (Sun) |
|---|---|---|---|
| **Prep** — the written base phase, weeks 1–8 | 8 | 2026-08-24 | 2026-10-18 |
| **Bridge** — extended aerobic base, not yet authored | 7 | 2026-10-19 | 2026-12-06 |
| **Arc** — the documented 26-week plan | 26 | 2026-12-07 | 2027-06-06 |

Arc phases (from the handoff's 6-month table):

| Phase | Arc weeks | Dates |
|---|---|---|
| Base | 1–8 | 2026-12-07 → 2027-01-31 |
| Build | 9–16 | 2027-02-01 → 2027-03-28 |
| Race-specific | 17–22 | 2027-03-29 → 2027-05-09 |
| Taper | 23–26 | 2027-05-10 → 2027-06-06 |

Race day = Arc week 26, Saturday.

Because two blocks both number weeks 1–8, **every week label in the UI carries its block name**: `Prep W3 · Wed`, `Arc W3 · Wed`. A bare "week 3" is never displayed.

## 4. Architecture

Vanilla static site, no framework, no build, no dependencies.

```
ironman-coach/
  index.html
  assets/app.js            ES module, importable by node for tests
  assets/app.css
  data/plan.json           hand-authored from the two context .md files
  data/log.json            written by the nightly sync
  data/sync-status.json    written by the nightly sync
  scripts/sync-runbook.md  instructions the scheduled task follows
  tests/*.test.js          node --test, zero deps
  70.3-base-phase-weeks-1-8.md          existing, kept
  70.3-training-context-handoff.md      existing, kept
```

GitHub Pages serves `main` at repo root.

### 4.1 plan.json — a generator, not 41 expanded weeks

The weekly skeleton never changes; only weekend long sessions and recovery-week overrides move. So the plan is stored once and a week is resolved at runtime.

```
plan.json
├─ race        { date: "2027-06-05", name: "TBD" }
├─ blocks      [ { id, label, start, weeks } × 3 ]
├─ skeleton    mon..sun → session templates
├─ progression prep[1..8] → { ride, run, type: "build"|"recovery" }
├─ recovery    overrides applied when week type is "recovery"
├─ swimSets    monTechnique, wedMain (+ per-week main set), friMixed
└─ nutrition   dayTypes (big/moderate/low) + fuel rules by session duration
```

Session template shape: `{ discipline, title, duration, effort, detail[], optional? }`.

Recovery overrides (weeks 4 and 8 of Prep): Tuesday bike → 40 min; each swim −500m; Thursday run → 30 min, no strides; strength skipped; weekend long sessions per the progression table.

Bridge and Arc weeks have no authored progression yet. `resolveWeek()` returns an explicit placeholder for them. **Nothing unauthored is ever rendered as if it were a prescribed session.**

### 4.2 log.json

```
{ entries: [ {
    date: "2026-08-26",
    planKey: "prep:1:wed",
    status: "done" | "partial" | "missed" | "extra",
    strava: { id, type, movingTime, distance, avgHr, url },
    note: ""
} ] }
```

`extra` = a Strava activity with no matching planned session. Unmatched activities are recorded, never dropped.

### 4.3 sync-status.json

```
{ lastRun: "2026-08-26T05:00:12-05:00",
  lastSuccess: "2026-08-26T05:00:12-05:00",
  ok: true, reason: null, activitiesFound: 2 }
```

## 5. Views

1. **Today** (default) — block/week/day label, the day's session(s) written out in full (swim sets rep by rep, effort target, cadence/HR cues), nutrition day type and fuel rule, plus what Strava recorded and the resulting status.
2. **Week** — Mon–Sun grid, one cell per day: discipline, planned duration, status dot. Today highlighted. Prev/next navigation across block boundaries.
3. **Season** — 41-week strip across the three blocks, recovery weeks marked, per-week completion, countdown to race day. Completion = sessions with status `done` or `partial`, divided by planned non-optional sessions for that week. Weeks that have not started show no figure rather than 0%.

Nutrition appears on the Today view as reference only — the day type and its fuel rule, read from `plan.json`. Nothing about nutrition is logged or tracked (see §10).

## 6. Nightly sync

A Claude scheduled task fires at **05:00 local** and follows `scripts/sync-runbook.md`:

1. Target date = yesterday. Accepts an explicit date range for backfill.
2. Query Strava MCP for that date's activities. Use `start_date_local`; never derive the date from a UTC timestamp.
3. Resolve the planned day from `plan.json`, using the same rules as the site.
4. Match by discipline: Swim→swim, Ride→bike, Run→run. Wednesday's brick expects two activities; both match.
5. Assign status by comparing against the session's **prescribed metric**: swims compare distance, bike and run compare moving time. `done` at ≥85% of prescribed, `partial` at 40–85%, `missed` when a session was planned and nothing was found, `extra` when an activity has no planned slot.
   - Optional sessions (Friday strength, the Monday swim's rest alternative) are never marked `missed`. They are `done` or absent.
   - `missed` is only assigned for dates that have fully elapsed.
6. Merge into `log.json`, **idempotent by Strava activity id** — re-running a date never duplicates an entry.
7. Write `sync-status.json`, then `git commit && git push`. Pages redeploys in about a minute.

The task must be able to run manually in any Claude session ("sync last 7 days") using the same runbook.

## 7. Failure modes

The governing rule: **a broken sync must never look like a rest day.** Missing data and a missed workout are distinct states and render differently.

| Failure | Behavior |
|---|---|
| Strava MCP unavailable in a headless run (interactive auth) | Write no log entries. `sync-status: { ok: false, reason: "strava-unreachable" }`, commit anyway. Site shows an amber banner. |
| `log.json` fails to load in the browser | Render the plan regardless. Banner notes the log is unavailable. The plan view never depends on the log. |
| `lastSuccess` older than 36h | Amber "data may be stale — last synced X" on every view. |
| Cron did not run for several days | Backfill on request via the runbook's date range. |
| `git push` fails | Nothing is lost; the next run recommits. The task output reports the failure. |
| Machine asleep at fire time | Same as above — the next successful run backfills. |

## 8. Date handling

All dates are `YYYY-MM-DD` strings and are compared as strings. A single `daysBetween()` helper does arithmetic, internally anchoring at UTC noon. No other `Date` arithmetic exists in the codebase. Week boundaries are Monday-start throughout.

## 9. Testing

`node --test`, no dependencies, no build. `assets/app.js` stays an importable ES module so pure functions are directly testable. Tests are written before the implementation of each function.

- `resolveWeek()` — recovery overrides applied for Prep weeks 4 and 8; Bridge and Arc return placeholders, not fabricated sessions
- `dayForDate()` — block boundaries 2026-10-18→2026-10-19 and 2026-12-06→2026-12-07; race day resolves to Arc W26 Saturday
- `matchActivity()` — brick day matches two activities; unmatched becomes `extra`; a duplicate Strava id does not create a second entry
- `statusFor()` — the 85% and 40% thresholds at exact boundary values; swims judged on distance and bike/run on moving time; optional sessions never `missed`

Rendering is verified by looking at it, not by tests.

## 10. Out of scope for v1

- Nutrition logging, weight tracking, subjective energy/sleep entry
- Any in-browser editing or `localStorage` state
- Strava OAuth from the browser (impossible on Pages)
- Authoring Bridge and Arc week content — added as those blocks approach

## 11. Open items this creates

- Connect the Strava MCP connector (blocks the sync, not the site)
- Create the GitHub repo and enable Pages on `main`
- Confirm git push authentication works unattended on this machine
- Author Bridge week progression before 2026-10-19
