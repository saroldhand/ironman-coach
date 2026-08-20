# Strava sync runbook

Run by the nightly scheduled task, and manually on request ("sync last 7 days").
Working directory: the repo root.

## Inputs

- Default target: **yesterday**, local date.
- On request, an explicit date or inclusive date range.

## Steps

1. **Query Strava MCP** for activities on the target date. Use each activity's
   `start_date_local` to decide which date it belongs to. Never use a UTC timestamp.

2. **Write the raw activities** to a scratch file as a JSON array, one entry per activity,
   keeping at least `id`, `type`, `name`, `moving_time`, `distance`, `average_heartrate`,
   `start_date_local`.

3. **Run the matching and merging code** — do not restate its rules by hand. The
   thresholds, discipline mapping, and merge identity all live in tested modules, and a
   prose copy of them will drift:

   ```bash
   node --input-type=module -e '
     import { readFileSync, writeFileSync } from "node:fs";
     import { resolveWeek, dayForDate } from "./assets/plan-model.js";
     import { matchDay, mergeEntries } from "./assets/log-model.js";

     const [date, actPath] = process.argv.slice(1);
     const plan = JSON.parse(readFileSync("data/plan.json"));
     const log  = JSON.parse(readFileSync("data/log.json"));
     const activities = JSON.parse(readFileSync(actPath));

     const day = dayForDate(plan, date);
     if (!day.inPlan || !day.authored) {
       console.log(JSON.stringify({ skipped: true, reason: day.reason ?? "unauthored" }));
       process.exit(0);
     }

     const week = resolveWeek(plan, day.blockId, day.week);
     const resolvedDay = week.days.find(d => d.dayKey === day.dayKey);
     const entries = matchDay(resolvedDay, activities, { elapsed: true });

     log.entries = mergeEntries(log.entries, entries);
     writeFileSync("data/log.json", JSON.stringify(log, null, 2) + "\n");
     console.log(JSON.stringify({ added: entries.length }));
   ' "<date>" "<scratch-activities.json>"
   ```

   Optional sessions with no activity produce no entry. Unmatched activities become
   `status: "extra"` entries — the code never discards one. Re-running a date is
   idempotent and preserves any hand-written `note`.

4. **Write `data/sync-status.json`:**

   ```json
   { "lastRun": "<ISO timestamp>", "lastSuccess": "<ISO timestamp or previous value>",
     "ok": true, "reason": null, "activitiesFound": 2 }
   ```

5. **Commit and push:**

   ```bash
   git add data/log.json data/sync-status.json
   git commit -m "chore: sync Strava activities for <date>"
   git push
   ```

## If Strava is unreachable

The connector is interactively authenticated and may be absent in a headless run.
If the Strava MCP tools are not available, or a call fails:

- **Write no log entries.** A gap in data must never be recorded as a missed workout.
- Write `data/sync-status.json` with `"ok": false` and `"reason": "strava-unreachable"`,
  leaving `lastSuccess` at its previous value.
- Commit and push that status file anyway, so the site can show the staleness banner.
- Report the failure in the task output.

## If git push fails

Nothing is lost. Report it and stop — the next successful run recommits.
