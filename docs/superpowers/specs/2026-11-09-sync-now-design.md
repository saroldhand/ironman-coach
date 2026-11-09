# Sync now — design

2026-11-09. A button on the site that syncs Strava on demand, so a workout is
on the plan a couple of minutes after it is saved instead of the next morning.

## Constraint

The sync is a Claude scheduled task that reads Strava through the Strava
connector and pushes `data/log.json` and `data/sync-status.json` to `main`. The
site is static (GitHub Pages) and holds no secrets.

The task has an API trigger (`POST …/v1/claude_code/routines/<id>/fire`, bearer
token per task), but it cannot be called from a page: a CORS preflight to it
answers 405 with no `Access-Control-Allow-*` headers, and a plain POST carries
none either. GitHub's REST API does answer browsers, so it is the relay.

## Flow

1. **Tap.** The round button in the header. With no GitHub token saved on the
   device, a sheet asks for one first (and offers the Claude app's Run now as
   the no-token route).
2. **Dispatch.** `POST /repos/saroldhand/ironman-coach/actions/workflows/sync-now.yml/dispatches`
   with `{ref: "main"}`, using the token from this browser's `localStorage`.
3. **Relay.** The workflow posts to the task's fire URL with the
   `SYNC_FIRE_TOKEN` repository secret, no payload. Its concurrency group keeps
   two taps from starting racing syncs.
4. **Sync.** The task syncs **yesterday through today**: the nightly run and a
   tap run the same steps. A day not yet over marks nothing missed, and the
   next night syncs it again. Entries merge by Strava id, so repeats are safe.
   If two runs push at once, the later one redoes its sync on top of the newer
   data instead of hand-merging JSON.
5. **Land.** The page polls `data/sync-status.json` every 8 s (cache-busted)
   until `lastRun` changes, then reloads the log and redraws in place, keeping
   the scroll position.

## What the athlete sees

A status line under the header (sticky, `role=status`):

| State | Line |
| --- | --- |
| Dispatching | spinner · Starting the Strava sync… |
| Waiting | spinner · Syncing from Strava. This usually takes a minute or two. |
| Landed | check · Synced from Strava: 1 new workout. (walks and hikes not counted; hides after 10 s) |
| Landed, Strava failed | warn · The sync ran but could not read Strava (reason). Nothing was changed. |
| Token refused (401/403/404) | the token is forgotten and the sheet reopens with the reason |
| Workflow failed | warn · …failed on GitHub… with a Details link to the run |
| Six minutes, nothing | warn · …may still be running: reload in a few minutes. |

While a sync runs the button spins and is disabled.

## Security

- The GitHub token is a fine-grained token for this one repo with Actions
  read and write only. It lives in the browser that uses it, never in the
  repo. The page loads no third-party script that could read it.
- The fire token lives only in GitHub Actions secrets. The task's prompt
  ignores any payload, so a leaked fire token can start a sync and nothing
  else.
- Limits: the fire API allows 30 runs an hour per task, shared with Run now.

## Alternatives not taken

- **Strava's API directly from a GitHub Action.** Faster and no Claude usage,
  but it needs a Strava API app, a rotating refresh token written back to
  secrets, and a second Strava reader beside the connector.
- **A link to Run now only.** No setup, but two apps and two taps. Kept as the
  fallback in the sheet.

## Testing

`tests/app-state.test.js` covers the request, the reading of a refused
dispatch, which workflow run belongs to a tap, when a sync has landed, and the
result line. The page flow is checked in a browser with GitHub and the status
file mocked.
