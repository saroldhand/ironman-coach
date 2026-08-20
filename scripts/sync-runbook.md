# Strava sync runbook

Run by the nightly scheduled task, and manually on request ("sync last 7 days").
Working directory: the repo root.

## Inputs

- Default target: **yesterday**, local date.
- On request, an explicit date or inclusive date range.
- A date that has not finished yet (today, or the tail of a range) is synced
  without marking anything missed — sessions you have not done yet stay blank.

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
     import { todayISO } from "./assets/date-utils.js";
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
     // Only a day that is fully over can be judged "missed". Syncing today, or
     // the in-progress end of a backfill range, must leave unperformed sessions
     // blank — unknown is not the same as skipped. ISO dates compare as strings.
     const elapsed = date < todayISO();
     const entries = matchDay(resolvedDay, activities, { elapsed });

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
     "ok": true, "reason": null, "activitiesFound": <count> }
   ```

5. **Commit and push:**

   ```bash
   git add data/log.json data/sync-status.json
   git commit -m "chore: sync Strava activities for <date>"
   git push
   ```

## If the date is not in the plan

`dayForDate` returns `inPlan: false` for any date before the plan starts or after
it ends, and the script prints a `skipped` line and writes no entries. This is the
normal, permanent state every night after the race.

Still write and commit `data/sync-status.json` with `"ok": true` and the skip
reason, and set `lastSuccess` to now. The sync did its job — there was simply
nothing to record. Leaving `lastSuccess` stale here would make the site raise a
"data may be stale" banner every night for a plan that has legitimately finished.

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
If a push fails repeatedly across several nights, it is not a transient network
problem — check for a diverged remote before unpushed commits pile up.
