# Strava sync runbook

Run by the Strava sync scheduled task, every night and whenever Sync is tapped
on the site, and on request ("sync the last 7 days").
Working directory: the repo root.

## Inputs

- Default target: **yesterday through today**, local dates. Today is included
  so a sync started from the site's button picks up a workout just finished;
  the next night's run syncs it again once the day is over.
- On request, an explicit date or an inclusive date range.
- A date that has not finished yet (today, or the end of a range) is synced
  without marking anything missed. Sessions you have not done yet stay blank.

## Steps

1. **Fetch the activities** with the Strava connector's `list_activities`:

   - `range_start`: `<from>T00:00:00`, `range_end`: `<to>T23:59:59`. Both are
     the athlete's local time, which is what decides an activity's date. Never
     use a UTC timestamp.
   - `first: 100`, and `ordering: "StartDateLocalAsc"`.
   - Leave `use_preferred_units` off, so distances are metres and times seconds.
   - While `has_next_page` is true, call again with `after: <end_cursor>` and
     keep every page.

2. **Save the response** to a scratch file: the `activities` array, or the whole
   response. Do not reshape it by hand; the script reads the connector's own
   fields (`sport_type`, `start_local`, `summary.moving_time`,
   `summary.distance`) and the Strava API's alike.

3. **Run the sync:**

   ```bash
   TZ=America/New_York node scripts/sync.mjs <from> <to> <scratch-activities.json>
   ```

   `TZ` makes "today" the athlete's today (Ohio), whatever clock the machine
   keeps. "Yesterday" is `TZ=America/New_York date -d yesterday +%F`.

   It matches every date's activities to that date's sessions, merges them
   into `data/log.json`, and writes a successful run to `data/sync-status.json`.
   The rules (thresholds, which Strava types count as which discipline, how a
   resync merges) live in `assets/log-model.js` and are tested. Do not restate
   or apply them by hand.

   What it does, so the output makes sense:
   - A date outside the site's blocks records nothing, and the status says why
     (`before-start` or `after-end`). That still counts as a successful sync.
   - A date in the History block (before Nov 9) has no sessions, so all its
     activities are kept as `extra`. The week and month bars count them.
   - Only a date before today can mark a session missed.
   - An activity that matches no session is kept as `extra`. Weekly totals count it.
   - Re-running a date changes nothing, and keeps any hand-written `note`.

4. **Commit and push** the two data files:

   ```bash
   git add data/log.json data/sync-status.json
   git commit -m "chore: sync Strava activities for <from>..<to>" -- data/log.json data/sync-status.json
   git push origin HEAD:main
   ```

   The site is served from `main`, so the data has to land there. The commit
   is path-scoped deliberately, not just the `git add`: this job runs
   unattended, and `git commit` with no pathspec commits the whole index. If
   anything else was left staged, it must never be swept into a sync commit
   and pushed under a misleading message. If the push is rejected because
   `main` moved, run `git pull --rebase origin main` and push again.

## If Strava is unreachable

The connector is signed in interactively and may be missing from a headless
run. If the Strava tools are not available, or `list_activities` fails:

```bash
node scripts/sync.mjs --failed strava-unreachable
```

then commit and push `data/sync-status.json` as in step 4.

- **Write no log entries.** A gap in data must never be recorded as a missed workout.
- The status keeps the last successful time, so the site shows its staleness banner.
- If the connector answers that the account is not eligible, use the reason
  `strava-not-eligible`. Strava's MCP needs an active subscription.
- Report the failure in the task output.

## If git push fails

Nothing is lost. Report it and stop; the next successful run recommits.
If a push fails several nights running, it is not a transient network
problem. Check for a diverged remote before unpushed commits pile up.
