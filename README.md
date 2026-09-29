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
3. **The app** — sign in with the Test Prep Hub account. The home screen is a two-step checklist: **1. Review yesterday** (coach note, feedback and fact fixes, answers to their questions, mission check-in, Sunday week review) and **2. Today's brief** (story-style cards with bonus rounds, the daily game and the recall quiz). Each step shows progress and turns green with a ✓ when done; today's cards are folded under "See today's cards".

## What it's really for

The news is the vehicle. The core aims are **street smarts, enquiry skills (asking good questions), speaking skills, and confidence in group conversation**. Every day's brief includes:
- **🎤 Say it out loud:** explain one story in about 30 seconds. The phone transcribes it (speech-to-text) and the morning job scores it on point, reason and conciseness, with tips the next day. Where the browser can't transcribe, he types what he said.
- **❓ Question challenge:** write the one question he'd ask someone involved in a story, scored on being open, specific and probing. The best ones are answered the next day.
- **A conversation card with a real-world mission**, weighted toward group situations.
- **Street smarts** at least 4 days a week.

Before writing a card or grading an answer, the morning job does background reading beyond the article and uses established methods: the Question Formulation Technique and Socratic questioning, PREP for speaking, active listening for group conversation, and FTC/FBI scam guidance for street smarts. The parent report includes a line on each of the four aims every day.

## Likes and interests

Every card has **👍 More like this / 👎 Not for me** (he can change his mind). Liked cards show a 💖 on the home tiles. In the Parent view you can edit his **Interests** list (currently music: rock, orchestral, EDM and game music; drumming; Pokémon; Demon Slayer and anime) and see what he's liked. The morning job uses both as hooks and examples, about 30% of a brief, without dropping core topics.

## Topics, time and checks

- **Topics:** news rotates across about ten areas (money and the economy, tech, health, science and space, climate, world affairs, US government and civics, culture and sports business, Tampa Bay, Kerala/India), each at least twice a week. Tampa Bay stories appear 3–4 days a week and whenever there's big local news.
- **Time:** each brief has a target (12 minutes for the first two weeks, then 10). A timer counts down at the top, turns amber and nudges him to wrap up when the time's up, and pauses when he taps it, leaves the app, or goes idle for 3 minutes. Active time is recorded, and the parent view shows it for each day.
- **Time tracking:** the app records active seconds on each card (pauses, time away and idle time excluded) and every stretch of use with why it ended (break, left the app, idle, closed, finished). In the Parent view, "See his answers" has a **Time** panel: active minutes vs. the target, breaks, times he left the app or went idle, start-to-finish span, and seconds per card, flagging very fast cards (possible skimming) and very long ones (stuck or distracted). The overview shows average minutes a day this week. The morning job uses this to tell three things apart — the brief is too long (over target, few interruptions → shorter cards or +2 min, max 15), distraction (long span, many interruptions → target unchanged, a suggestion in the report), or rushing (fast reads, weak checks → flagged) — and lowers the target when he's quick and accurate.
- **Focus nudges:** if there's no touch, scroll or key press for 75 seconds on a card, the clock stops at the last activity and a "Still with me?" popup asks him to refocus (or take a proper break). The wording gets firmer on repeat drift-offs. Each nudge is recorded with how long he drifted and on which card; the Parent view counts them, and the morning job uses them to tell a confusing card (drifting on one card) from general distraction (drifting everywhere).
- **Checks are required:** he has to answer a card's quick check before moving on, so every card gives a signal of whether he understood it.

## Built for each person

- **Calibration:** each learner has their own setup (`profile.calib`): number of cards (6–14), article length, how many written answers, and a time target. The morning job starts from Vinu's instructions (Rishabh: 8 cards, short 55–75-word articles, a written answer on every news card; Prayaga: 10 cards and room to grow to 14) and steps one thing up or down at a time, at most every 2–3 days, from their accuracy, time, written scores and focus. The Parent view shows the current setup and why.
- **🎁 Bonus rounds:** 2–3 short breaks between cards drawn from each person's interests (trivia, surprising facts, jokes for the younger ones, this-or-that). Fact-checked, text only.
- **🎮 Daily mini-game (60 seconds):** rotates between Real or fake? (spot the made-up headline), Higher or lower (numbers from the news and their interests), Word match (today's words) and Emoji decode (which story?). First play each day earns points; replays are for fun.
- The morning job reads its instructions from `docs/daily-job.md` in this repo each run, so a push updates it.

## Feedback to the learner

- **Instantly:** quick checks and the recall quiz show right/wrong with an explanation. While typing a take or a question, or after recording a spoken answer, a checklist ticks off structure (point up front, a reason, the other side; open, specific, digs deeper; length and fillers) with a hint for anything missing, so he can improve it before saving.
- **Next morning ("📝 Your feedback" on the home screen):** for each take, spoken answer and question, the morning job writes his score out of 3, what worked, **fact fixes** (what he said vs. the correct fact or figure, with a source), one thing to try next time, and a stronger version of his own answer. Misconceptions behind repeated wrong checks get a fact-check item too. "Got it" earns 2 points and tells the job he read it.
- **Sundays ("🗓 Your week in review"):** one skill that improved (with evidence), next week's focus, and the facts he got wrong that week, stated correctly.
- Reflections never get feedback. The Parent view's "See his answers" shows the feedback he got each day and whether he read it.

## Help for a beginner

Every news card has a **Catch me up** backstory, key words he can tap to see what they mean, and an **I don't get it** button that shows a simpler version and lets him ask a question. The next morning's brief answers his questions (the "You asked" box on the home screen), and each tap or question is a signal the evaluation uses. For his first 21 briefs, the first card each day is a **Foundations** card explaining one core concept behind that day's news (inflation, the Fed, tariffs, AI models, vaccines and so on).

## Growth goals

Each learner has a list of goals set by the parent (Parent view → Growth goals). The morning job builds every brief around them: each goal gets at least two cards a week, and newly added goals get extra attention.

- **Conversation cards** give natural lines to try and a small real-world **mission**. The next day's brief asks how it went (did it / partly / not yet), and honest answers earn points either way.
- **Jargon** and **street smarts** cards alternate: business, tech, workplace and everyday terms; scams, pressure, fine print.
- **Self-check** cards include a reflection question; his answers appear in the parent view.
- Every news card has a **"bring it up with friends"** line.

## Levels

Rookie (0) → Reader (150) → Informed (400) → Sharp (800) → Insider (1,400) → Analyst (2,200) → Strategist (3,300) → Visionary (4,800) → Legend (7,000). A full day is worth roughly 100–130 points.

## Points

| Action | Points |
|---|---|
| Read a card (12+ seconds) | 3 (1 if faster) |
| Quick check right / wrong | 8 / 2 |
| Write "your take" | 5, plus up to 9 bonus next morning for strong reasoning |
| Private reflection | 5 |
| Mission check-in: did it / partly / not yet | 10 / 6 / 2 |
| Recall quiz right / wrong | 10 / 2 |
| "I don't get it" / asking a question | 1 / 3 |
| Say it out loud / question challenge | 6 / 4, plus up to 9 bonus each for a strong one |
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

Functions: `brief_me()`, `brief_stats()`, `brief_admin_overview()`, `brief_admin_feed()`, `brief_admin_day()`, `brief_admin_set_goals()` and `brief_admin_set_interests()` (admin only), `brief_streak_for()` (server only).

**Add a person** from the Parent view (name, email, age). If the email already has an account it's reused; otherwise the `brief-admin` function creates a single-use invite code (the signup trigger requires one) and emails an invitation, and they pick a password when they open it. Age sets the reading level: 10 and under → explorer, 11–13 → builder, 14–18 → challenger, 19+ → adult. Age can be changed, and anyone can be paused, from their card. The morning job picks new people up the next day.

**Adults' privacy:** for adults other than the admin, the Parent view shows only activity numbers; their answers, evaluations and likes stay private to them.

**Sign-in:** Daily Brief keeps its own sign-in (storage key `daily-brief-auth`), separate from Test Prep Hub's, even though both are on the same domain. An admin who is also a learner opens their own brief by default and switches with ☰ → Parent view.

## Parent view

Sign in with the admin account to open **See his answers** (each day's brief with every answer he gave, a coach note on each, the knowledge assessment and the plan forward), edit each learner's growth goals and see their streak, points, 14-day activity, latest evaluation, accuracy by category, profile trends and recent "your take" answers, missions tried, and to preview their brief.

## iPhone notifications

Open the site in Safari → Share → Add to Home Screen → open Daily Brief from the icon → sign in → ☰ → Turn on daily brief → Allow.

## Checks

```
python3 test/run.py     # headless browser run with Supabase stubbed: sign-in, full learner flow, parent view
```
