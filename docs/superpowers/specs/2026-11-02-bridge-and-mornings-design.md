# The Bridge, and Training to the Clock — Design

**Date:** 2026-11-02
**Status:** Agreed with the athlete 2026-11-02 (§9). Encoded in `plan.json`.
**Amends:** `2026-08-24-strength-block-design.md` (Strength is cut to 8 weeks; powerbuilding is dropped) and `2026-10-05-arc-block-design.md` §4, §5, §7, §8 and §9 (the week's shape, the swims, strength and the low day). Everything else in the Arc design stands: dates, phases, tests, recovery weeks, the taper, race week, Hawaii.

---

## 1. Why

The GVT block has drifted, and the athlete is happy with their strength. Strength isn't the limiter for this race, and they don't want to put on weight. So powerbuilding (Strength W9–12, Nov 9 – Dec 6) is dropped, and those four weeks go back to triathlon.

The athlete's main goal for these weeks is **getting into the time commitment**. Most training happens before work, so the plan has to say ahead of time when to be up, when to be in bed, and what to lay out the night before. The site now answers those three questions for every work day.

## 2. Calendar

| Block | Weeks | Start | End | |
|---|---|---|---|---|
| Prep | 3 | 2026-08-24 | 2026-09-13 | done |
| Strength | **8** (was 12) | 2026-09-14 | **2026-11-08** | GVT only |
| **Bridge** *(new)* | 4 | **2026-11-09** | 2026-12-06 | back into triathlon |
| Arc | 26 | 2026-12-07 | 2027-06-06 | dates unchanged |

**Later the same day:** the athlete asked for everything before Nov 9 to be cut from the site, so Prep and Strength are gone and the plan starts at Bridge W1. With Prep went the engine's "skeleton" week and its recovery-week rules, which nothing else used: every week is now a template filled from its progression row. A day before the plan still shows tonight's card, so Sunday Nov 8 sets up Monday's first alarm.

The Bridge takes powerbuilding's job of getting the athlete ready for Arc W1, using swimming, cycling and running instead of three lifting days. In effect, Base grows from 8 weeks to 12. Arc week numbers, recovery weeks, tests and milestones don't move.

The alternative was stretching the Arc to 30 weeks. That would renumber every Arc week to deliver the same training, so it was rejected.

## 3. The athlete's clock

| | |
|---|---|
| Sleep | 8 hours |
| Mon, Fri | Working from home: at the desk by **8:15** |
| Tue, Wed, Thu | At the office: leave home at **7:45** |
| Pool and gym | Same building, ~10 min away. **The pool opens at 6:00.** |
| After a session | Home to shower and eat (~30 min), even on office days. Showering at work is possible but avoided. |
| Lunch | Possible on Mon and Fri (home days). Running suits it best. |

Assumed, and set in `plan.schedule`: 15 min from alarm to out the door with the bag packed the night before, 5 min to change before the pool and 10 after, and 2:15 per 100 m in the pool including rest.

## 4. The week

| | Before work | Lunch | Weekend |
|---|---|---|---|
| **Mon** | Pool and gym: technique swim, then strength | Easy run | |
| **Tue** | Bike on the trainer at home | | |
| **Wed** | Pool: the quality swim, **45 min in the water at most** | | |
| **Thu** | Run from the door | | |
| **Fri** | Pool: the long swim | | |
| **Sat** | | | Long ride, with a brick run from Arc Build |
| **Sun** | | | Long run |

What changed from the Arc design's week:

- **Wednesday's short run moves to Monday lunch.** A swim plus a run before an office day would need a 4:40 alarm at Arc peak. On Monday it's an easy jog the day after the long run, with two run-free days before Thursday. Saturday bricks take over running on tired legs from Build on.
- **Friday lunch stays free.** A run there would mean running four days in a row once Saturday bricks start. The athlete offered Friday as an option; the call was to keep one week shape from November to June.
- **Wednesday is capped at 2,000 m.** The pool opens at 6 and the athlete leaves at 7:45, so ~50 minutes in the water is the most Wednesday can hold, and 45 leaves margin. Wednesday keeps the quality work: CSS tests and CSS or race-effort sets, after a shorter frame (300 easy, 4×50 build, 4×50 drill, main, 200 easy = main + 900).
- **Friday becomes the long swim.** It's a home day, so up to ~80 minutes fit before 8:15. The long non-stop swims and both 1,900 m milestones live here, including W22's race-effort 1,900, which moves from Wednesday (May 5) to Friday (May 7).
- **The Monday technique swim is no longer optional.** It's capped at 1,500 m so the swim and strength fit between 6:00 and 8:15. It's done in the same trip as strength, and swim frequency is still the cheapest speed available.
- **Wednesday becomes the low-calorie day, not Monday.** Monday now has three sessions; Wednesday has only a swim.

## 5. The Bridge, Nov 9 – Dec 6

The week has the Arc's shape at lower volume. Everything is Zone 2; the only faster work is strides and spin-ups. There are no tests; those wait for Arc W1. There are three swims a week.

| Wk | Week of | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Hours |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Nov 9 | Swim 1,500 · str 35′ · lunch run 15′ | Bike 45′ | Swim 1,800 | Run 30′ | Swim 1,800 | Ride 1:15 | Run 35′ | 5.9 |
| 2 | Nov 16 | 1,500 · 35′ · 15′ | 60′ + spin-ups | 2,000 | 35′ + strides | 2,000 | 1:30 | 45′ | 6.7 |
| *3* | *Nov 23* | *1,500 · 30′ · 15′* | *45′* | *1,800* | *✈ 30′ easy (Thanksgiving)* | *✈ off* | *✈ off* | *✈ 40′* | *3.9* |
| 4 | Nov 30 | ✈ run 20′ + bodyweight 20′ | ✈ travel, off | 2,000 | 40′ + strides | 2,000 | 1:45 | 50′ | 5.4 |

- **Away Thu Nov 26 – Tue Dec 1.** W3 is the light week anyway (`recovery`). Away days are runs and bodyweight work only; a pool or gym where the athlete is staying is a bonus.
- **Running builds by frequency, then minutes:** 80 → 95 → 85 → 110, then Arc W1's 115. The athlete confirmed they've kept running, so they're good with these numbers.
- **Three templates:** `bridge` (W1–2), `bridgeAway` (W3) and `bridgeBack` (W4). Away days are written into the template, and each away session sets `when: "anytime"` and the travel kit.
- **Trainer.** The athlete doesn't have one yet. Until it arrives, Tuesday is a gym bike, where 45 minutes is the most that fits before 7:45, and Saturday is outdoors only in daylight. Order around Nov 20, set it up Dec 2–5, ride it first on Sat Dec 5, and test FTP on it in Arc W1 (Tue Dec 8).

## 6. Arc amendments

### Swims

Wednesday is capped at 2,000 m; Friday carries the long work. Weekly swim volume holds, because the Monday swim now counts: W19 is 1,500 + 1,900 + 2,900 = 6,300 m, against the old 5,300 m core plus an optional 2,000.

| Wk | Wed before | Wed now | Fri before | Fri now | Mon lunch run | Strength |
|---|---|---|---|---|---|---|
| 1 | 2,000 | 1,700 · **CSS test** | 2,000 | 2,000 · 9 × 100 steady | 20′ | 45′ → 35′ |
| 2 | 2,000 | 1,900 · 10 × 100 @ CSS+8 | 2,000 | 2,000 · 3 × 300 steady | 25′ | 45′ → 35′ |
| 3 | 2,200 | 1,900 · 5 × 200 @ CSS+8 | 2,200 | 2,200 · 600 + 500 steady | 25′ | 45′ → 35′ |
| 4 | 1,800 | 1,500 · 6 × 100 steady | 1,800 | 1,800 · 7 × 100 easy-steady | 20′ | 30′ → 25′ |
| 5 | 2,200 | 1,900 · 10 × 100 @ CSS+5 | 2,200 | 2,200 · 700 + 400 steady | 25′ | 45′ → 35′ |
| 6 | 2,400 | 1,900 · 4 × 250 @ CSS+8 | 2,400 | 2,500 · 800 non-stop, then 6 × 100 steady | 30′ | 45′ → 35′ |
| 7 | 2,400 | 1,900 · 2 × 500 @ CSS+8 | 2,400 | 2,600 · 1,000 non-stop, then 5 × 100 steady | 30′ | 45′ → 35′ |
| 8 | 1,800 | 1,500 · 6 × 100 steady | 1,800 | 1,800 · 7 × 100 easy-steady | 20′ | 30′ → 25′ |
| 9 | 2,000 | 1,700 · **CSS test** | 2,400 | 2,400 · 1,000 non-stop, then 3 × 100 steady | 25′ | 30′ → 25′ |
| 10 | 2,400 | 1,900 · 10 × 100 @ CSS | 2,300 | 2,500 · 2 × 700 steady | 30′ | 40′ → 35′ |
| 11 | 2,600 | 1,900 · 4 × 200 @ CSS+3, 4 × 50 fast | 2,300 | 2,500 · 1,200 non-stop, then 2 × 100 fast | 30′ | 40′ → 35′ |
| 12 | 2,000 | 1,700 · 8 × 100 steady | 1,800 | 1,800 · 7 × 100 easy-steady | 20′ | 30′ → 25′ |
| 13 | 2,600 | 1,900 · 3 × 300 @ CSS+3, 2 × 50 fast | 2,500 | 2,600 · 1,400 non-stop, then 2 × 50 fast | 30′ | 40′ → 35′ |
| 14 | 2,800 | 2,000 · 2 × 500 @ CSS+5, 2 × 50 fast | 2,700 | 2,800 · 1,600 non-stop, then 2 × 50 fast | 30′ | 40′ → 35′ |
| 15 | 2,800 | 2,000 · 11 × 100 @ CSS | 3,000 | 3,000 · **1,900 non-stop** | 30′ | 40′ → 35′ |
| 16 | 2,000 | 1,700 · 8 × 100 steady | 1,800 | 1,800 · 7 × 100 easy-steady | 20′ | 30′ → 25′ |
| 17 | 2,000 | 1,700 · **CSS test** | 2,300 | 2,300 · 6 × 200 steady with sighting | 25′ | 30′ → 25′ |
| 18 | 2,800 | 1,900 · 4 × 200 @ RE with sighting, 4 × 50 fast | 2,700 | 2,700 · 2 × 800 @ RE | 30′ | 30′ |
| 19 | 3,000 | 1,900 · 3 × 300 @ RE with sighting, 2 × 50 fast | 2,300 | 2,900 · 1,500 non-stop @ RE, 6 × 50 fast | 30′ | 30′ |
| 20 | 2,000 | 1,700 · 8 × 100 steady | 1,800 | 1,800 · 7 × 100 easy-steady | 20′ | 30′ → 25′ |
| 21 | 3,000 | 1,900 · 5 × 200 @ RE with sighting | 2,400 | 2,900 · 3 × 600 @ RE, or 45′ open water | 30′ | 30′ |
| 22 | 3,100 | 1,900 · 10 × 100 @ RE with sighting | 2,400 | 3,000 · **1,900 non-stop @ RE** | 30′ | 30′ |
| 23 | 2,600 | 2,000 · 3 × 300 @ RE, 4 × 50 fast | 2,000 | 2,000 · 9 × 100 easy-steady | 25′ | 30′ |
| 24 | 2,400 | 1,900 · 5 × 200 @ RE | 2,400 | 2,400 · 1,300 non-stop, or open water | 25′ | 30′ |

W25 (taper): the Wednesday swim is 1,700 m with the new frame, and the 20′ run moves to Monday lunch. W26 (race week, in Hawaii) is unchanged and keeps its Wednesday swim-and-run, since there's no work that week.

### Strength

The athlete is happy with their strength, and it isn't the limiter. Heavy, low-volume lifting holds strength without adding size.

- **Monday, ~35′ in Base and Build, 30′ in Race-specific; 25′ in recovery and test weeks.** It was 45′/40′/30′.
- **Bench press is out.** One heavy lower-body lift (squat or trap-bar deadlift 3×5 @ RPE 7, 3×4 in Build) comes first. Then work that keeps the athlete injury-free for running and swimming: single-leg RDL, pull-ups, split squats or step-ups, straight- and bent-knee calf raises, and Pallof press or Copenhagen plank.
- Race-specific and taper sessions are unchanged apart from their place in the day.

### Nutrition: 175 → 165 lb

The athlete weighs ~175 lb and wants to be at ~165, losing it slowly while still fuelling the training. The deficit already in the plan gets there at about ½ lb a week:

| By | Weight | How |
|---|---|---|
| Jan 31 (end of Base) | ~169 | Bridge and Base: a mild deficit on easy days |
| Mar 28 (end of Build) | ~166 | A deficit only on easy days; quality days at maintenance |
| April onward | ~165, held | Race-specific and the taper at maintenance |

- **Go by the weekly average, not the daily number.** If the athlete loses more than ~1 lb a week, or sessions feel flat, they eat more, starting with carbs around training.
- **The deficit comes from meals away from training**, never from fuel during a session or the meal after a long one.
- **Eating before work:** under an hour and easy, water or a small snack. An hour or more, or a quality day: 30–50 g of carbs before leaving.
- The low day moves from Monday to Wednesday in the Bridge, Base and Build. The weight note shows on low and moderate days.

## 7. The site

### Data

- `plan.schedule` holds the clock in §3, plus:
  - `routine`: weekday → discipline → `{ when, venue, kit }`. It's written once, because where a session happens is a fact about the athlete's week, not about any one template. A template opts in with `routine: true`, and a session can override any field (away days set `when: "anytime"`).
  - `daysOff`: the Thanksgiving trip, Christmas Day and New Year's Day. On these days no alarm is set.
- `plan.kit` holds named kit lists: pool bag, gym, trainer, run (with a headlamp while it's dark), long ride, brick, long run and away.
- `nutrition.fuel.beforeShort`/`beforeLong`, and `nutrition.weight`.

### Engine (`assets/schedule-model.js`, pure, tested)

- **Session minutes.** Durations are used as written; swims are timed at the schedule's pace.
- **The morning, worked backwards from the ready-by time:** home to shower and eat → out of the venue → finished → started → arrived → left → alarm (rounded down to 5 minutes) → lights out (the alarm minus 8 hours). Two sessions in one trip add a 5-minute changeover. If the plan would need the pool before it opens, the result says by how much (`earlyBy`), and the page says the morning doesn't fit.
- **Kit:** the day's kit lists, each named once, in the order the day uses them.
- **Eat first?** Carbs if the morning is an hour or more, or a quality day; otherwise water or a snack.
- **Tonight:** tomorrow's plan. **Week summary:** hours and the earliest alarm.

### Pages

- **Day:** a *Before work* card at the top with the alarm in large type, lights-out the night before, the timeline from leaving to ready, whether to eat first, and the kit to lay out. Weekends show the kit; days off say so. Each session card carries a *before work* or *lunch* tag.
- **Today:** a *Tonight* card for tomorrow, showing the alarm, lights-out, sessions, food and kit, with a link to tomorrow's page. After midday it leads the page; in the morning it sits at the bottom.
- **Week:** the week's hours and earliest alarm under the title, and each day's alarm under its date.
- **Season:** hours for every week, so the whole arc of the time commitment is visible at once.

### What the clock looks like

| Week | Hours | Mon | Tue | Wed | Thu | Fri |
|---|---|---|---|---|---|---|
| Bridge W1 | 5.9 h | 5:40 | 6:15 | 5:40 | 6:30 | 6:10 |
| Bridge W2 | 6.7 h | 5:40 | 6:00 | 5:40 | 6:25 | 6:10 |
| Bridge W3 ↓ | 3.9 h | 5:45 | 6:15 | 5:40 | off | off |
| Bridge W4 | 5.4 h | off | off | 5:40 | 6:20 | 6:10 |
| Arc W1 | 7.5 h | 5:40 | 6:00 | 5:45 | 6:20 | 6:10 |
| Arc W7 | 10.0 h | 5:40 | 5:30 | 5:40 | 6:10 | 5:55 |
| Arc W15 | 11.7 h | 5:40 | 5:30 | 5:40 | 6:00 | 5:45 |
| Arc W19 | 12.0 h | 5:45 | 5:30 | 5:40 | 6:00 | 5:50 |
| Arc W22 | 11.9 h | 5:45 | 5:30 | 5:40 | 6:00 | 5:45 |
| Arc W25 | 7.1 h | 5:55 | 6:00 | 5:45 | 6:15 | 6:10 |

Every work morning in the plan falls between **5:30 and 6:30**. The earliest is the 90′ Tuesday rides in Build and Race-specific, which make Monday nights the earliest bedtime, at 9:30. Peak weeks are ~12 h, now that the Monday swim counts; the athlete confirmed ~12.4 h in October.

### Tests that guard it

- Every work morning from Bridge W1 to Arc W25 fits: it never needs the pool before 6:00, and no alarm is set before 5:30.
- Each work morning happens in one place.
- No Wednesday swim is over 2,000 m.
- Every session on a work day is placed before work or at lunch, unless the date is a day off.
- Monday has a run and Wednesday doesn't; Monday is never the low day.
- Every kit and venue the plan names exists, and every day off is a weekday inside the plan.
- Bridge running is 80/95/85/110 minutes and hands off to Arc W1 within 15%.
- The unit tests in `tests/schedule-model.test.js` work the alarm arithmetic by hand.

## 8. Out of scope

- **A phone calendar feed** (sessions and alarms in the phone's calendar). The athlete wants it eventually, not now. It would be an `.ics` built from the same model.
- **Tracking weight on the site.**
- **Showing today's actual sunrise** for the "while it's dark" kit line.

## 9. Agreed with the athlete — 2026-11-02

1. **Start the triathlon block on Monday Nov 9.** Strength is good and not the limiter, and the athlete doesn't want to add weight.
2. **Running:** they've kept running, so the Bridge numbers stand.
3. **Main goal: the time commitment.** Most sessions are before work; the plan has to say what's coming so gear and sleep can be planned.
4. **Weight:** ~175 lb now, comfortable at ~165. Lose it slowly while still fuelling workouts.
5. **Strength:** one ~35′ session, no bench. Agreed.
6. **No trainer yet.** Away Thu Nov 26 – Tue Dec 1 for Thanksgiving.
7. **8 h sleep.** Leave at 7:45 for the office; at the desk by 8:15 on Mon/Fri at home. Pool and gym are in one place and the pool opens at 6. They'd rather shower at home than at work.
8. **Lunch runs work on Mon and Fri.** Monday it is; Friday stays free (§4).
9. **The alarm times (5:30–6:30) work.**
10. **Phone calendar:** keep the idea, not now.
