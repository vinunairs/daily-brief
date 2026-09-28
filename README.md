# Daily Brief

Ten minutes a day: five short news summaries (finance, tech, health, world; US and global), two reasoning workouts and three growth cards built around the parent's goals (conversation practice, jargon and street smarts, self-check, interview, money and work skills), plus a recall quiz on earlier stories. Built for Rishabh; designed so more learners (with different age bands) can be added later.

**Live site:** https://vinunairs.github.io/daily-brief/

## How it works

1. **5:40 a.m. ET — morning job** (a scheduled Claude task; prompt in `docs/daily-job.md`). For each active learner it:
   - evaluates yesterday: reading, quick-check accuracy by category, recall accuracy, time on cards, and scores "your take" answers on a 0–3 reasoning rubric (with bonus points for 2+);
   - updates the learner profile (strengths, building-up areas, interests, difficulty levels, trend);
   - writes a parent report (a note on every answer, what his answers show about his knowledge, and a 1–2 week plan forward that the following briefs carry out) and a short coach note;
   - researches the news and writes today's 10-card brief, tuned to the profile (70% balanced core, up to 30% interest-driven) and the learner's age band.
2. **Notification** — `supabase/functions/brief-push`, run hourly by `pg_cron` (`brief-push-hourly`, minute 5). Sends one notification at the learner's chosen hour once the brief exists, and skips it if they've already finished.
3. **The app** — sign in with the Test Prep Hub account. Read a card, answer the quick check, optionally write a take, tap Done. The recall quiz unlocks after 6 cards.

## Growth goals

Each learner has a list of goals set by the parent (Parent view → Growth goals). The morning job builds every brief around them: each goal gets at least two cards a week, and newly added goals get extra attention.

- **Conversation cards** give natural lines to try and a small real-world **mission**. The next day's brief asks how it went (did it / partly / not yet), and honest answers earn points either way.
- **Jargon** and **street smarts** cards alternate: business, tech, workplace and everyday terms; scams, pressure, fine print.
- **Self-check** cards include a reflection question; his answers appear in the parent view.
- Every news card has a **"bring it up with friends"** line.

## Points

| Action | Points |
|---|---|
| Read a card (12+ seconds) | 3 (1 if faster) |
| Quick check right / wrong | 8 / 2 |
| Write "your take" | 5, plus up to 9 bonus next morning for strong reasoning |
| Private reflection | 5 |
| Mission check-in: did it / partly / not yet | 10 / 6 / 2 |
| Recall quiz right / wrong | 10 / 2 |
| Finish all 10 cards | 20 |

A day counts toward the streak when 6+ cards are read. Answer choices are shuffled per question so the right answer isn't always in the same position.

## Data (Supabase project `psat-sprint`, shared accounts)

All tables are prefixed `brief_` and don't touch Test Prep Hub's data.

| Table | What | Who can read |
|---|---|---|
| `brief_learners` | who's enrolled, age band, growth goals, learner profile | functions only |
| `brief_feeds` | one brief per learner per day | the learner |
| `brief_events` | reads, checks, takes, recall, bonuses | the learner (insert own) |
| `brief_coach_notes` | daily note for the learner | the learner |
| `brief_reports` | daily evaluation for the parent | admin only |
| `brief_push_subscriptions` | notification devices | the learner |

Functions: `brief_me()`, `brief_stats()`, `brief_admin_overview()`, `brief_admin_feed()` and `brief_admin_set_goals()` (admin only), `brief_streak_for()` (server only).

**Add a learner** (e.g. a younger child): they need a Test Prep Hub account, then
```sql
insert into brief_learners (user_id, display_name, band, grade)
values ('<their user id>', 'Name', 'explorer', '3');   -- explorer 3–5, builder 6–8, challenger 9–12
```
The morning job picks them up the next day.

## Parent view

Sign in with the admin account to open **See his answers** (each day's brief with every answer he gave, a coach note on each, the knowledge assessment and the plan forward), edit each learner's growth goals and see their streak, points, 14-day activity, latest evaluation, accuracy by category, profile trends and recent "your take" answers, missions tried, and to preview their brief.

## iPhone notifications

Open the site in Safari → Share → Add to Home Screen → open Daily Brief from the icon → sign in → ☰ → Turn on daily brief → Allow.

## Checks

```
python3 test/run.py     # headless browser run with Supabase stubbed: sign-in, full learner flow, parent view
```
