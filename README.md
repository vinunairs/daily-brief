# Daily Brief

Ten minutes a day: six short news summaries (finance, tech, health; US and global), two reasoning workouts and two life-skill cards, plus a recall quiz on earlier stories. Built for Rishabh; designed so more learners (with different age bands) can be added later.

**Live site:** https://vinunairs.github.io/daily-brief/

## How it works

1. **5:40 a.m. ET — morning job** (a scheduled Claude task; prompt in `docs/daily-job.md`). For each active learner it:
   - evaluates yesterday: reading, quick-check accuracy by category, recall accuracy, time on cards, and scores "your take" answers on a 0–3 reasoning rubric (with bonus points for 2+);
   - updates the learner profile (strengths, building-up areas, interests, difficulty levels, trend);
   - writes a parent report and a short coach note;
   - researches the news and writes today's 10-card brief, tuned to the profile (70% balanced core, up to 30% interest-driven) and the learner's age band.
2. **Notification** — `supabase/functions/brief-push`, run hourly by `pg_cron` (`brief-push-hourly`, minute 5). Sends one notification at the learner's chosen hour once the brief exists, and skips it if they've already finished.
3. **The app** — sign in with the Test Prep Hub account. Read a card, answer the quick check, optionally write a take, tap Done. The recall quiz unlocks after 6 cards.

## Points

| Action | Points |
|---|---|
| Read a card (12+ seconds) | 3 (1 if faster) |
| Quick check right / wrong | 8 / 2 |
| Write "your take" | 5, plus up to 9 bonus next morning for strong reasoning |
| Recall quiz right / wrong | 10 / 2 |
| Finish all 10 cards | 20 |

A day counts toward the streak when 6+ cards are read. Answer choices are shuffled per question so the right answer isn't always in the same position.

## Data (Supabase project `psat-sprint`, shared accounts)

All tables are prefixed `brief_` and don't touch Test Prep Hub's data.

| Table | What | Who can read |
|---|---|---|
| `brief_learners` | who's enrolled, age band, learner profile | functions only |
| `brief_feeds` | one brief per learner per day | the learner |
| `brief_events` | reads, checks, takes, recall, bonuses | the learner (insert own) |
| `brief_coach_notes` | daily note for the learner | the learner |
| `brief_reports` | daily evaluation for the parent | admin only |
| `brief_push_subscriptions` | notification devices | the learner |

Functions: `brief_me()`, `brief_stats()`, `brief_admin_overview()` and `brief_admin_feed()` (admin only), `brief_streak_for()` (server only).

**Add a learner** (e.g. a younger child): they need a Test Prep Hub account, then
```sql
insert into brief_learners (user_id, display_name, band, grade)
values ('<their user id>', 'Name', 'explorer', '3');   -- explorer 3–5, builder 6–8, challenger 9–12
```
The morning job picks them up the next day.

## Parent view

Sign in with the admin account to see each learner's streak, points, 14-day activity, latest evaluation, accuracy by category, profile trends and recent "your take" answers, and to preview their brief.

## iPhone notifications

Open the site in Safari → Share → Add to Home Screen → open Daily Brief from the icon → sign in → ☰ → Turn on daily brief → Allow.

## Checks

```
python3 test/run.py     # headless browser run with Supabase stubbed: sign-in, full learner flow, parent view
```
