# 70.3 Training Tracker

Static training site for an Ironman 70.3 on 2027-06-05. No build step, no dependencies.

## What is here

- `data/plan.json` — the plan. The only file to edit when training changes.
- `data/log.json` — what actually happened. Written by the nightly Strava sync.
- `assets/` — ES modules, loaded directly by the browser and importable by `node --test`.
- `scripts/sync-runbook.md` — what the nightly sync does.

## Calendar

| Block | Weeks | Start | End |
|---|---|---|---|
| Prep | 8 | 2026-08-24 | 2026-10-18 |
| Bridge | 7 | 2026-10-19 | 2026-12-06 |
| Arc | 26 | 2026-12-07 | 2027-06-06 |

Prep and Arc both number weeks 1–8, so week labels always name their block.

## Local development

```bash
python -m http.server 8000   # then open http://localhost:8000
npm test                     # node --test, no install needed
```

## Syncing

The nightly Claude scheduled task follows `scripts/sync-runbook.md`. To sync manually,
ask Claude in this repo: "sync the last 7 days from Strava".
