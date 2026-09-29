/* Daily Brief — ten minutes a day of news, reasoning and life skills.
   Shares accounts with Test Prep Hub (same Supabase project). All Daily Brief data lives in brief_* tables.
   Each learner gets their own feed per day (brief_feeds), written by the morning job, which also reads
   yesterday's activity (brief_events) to tune the next feed. */
(function () {
  "use strict";
  const SUPABASE_URL = "https://frdcgfafsumdqjbjdhmf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_S-5a43bXpPvd_aDsrcp44A_D8TQTAOw"; // public key; access is protected by row-level security
  const APP_KEY = "BJ9VTfUnx7ubJrlV-oaQfCQhWtBco1uCGjH6eDVPkTbEpjGNz_Jdveg8OK74hGSBRQfznUUXiOQ3dLhmWuQwowU"; // web push public key
  const SITE = location.origin + location.pathname;
  const TZ = "America/New_York";
  const QUIZ_UNLOCK = 6; // cards read before the recall quiz opens
  const PTS = { readLong: 3, readShort: 1, right: 8, wrong: 2, opinion: 5, reflect: 5, recallRight: 10, recallWrong: 2, complete: 20, mission: [2, 6, 10], confused: 1, ask: 3, speak: 6, question: 4, feedback: 2 };
  const CAT = { basics: "Foundations", local: "Tampa Bay", science: "Science", climate: "Climate", civics: "US & Civics", culture: "Culture & Sports", finance: "Finance", tech: "Tech", health: "Health", world: "World", reasoning: "Reasoning", skills: "Life skills", social: "People skills" };
  const KIND = { estimation: "Estimate it", flaw: "Spot the flaw", logic: "Logic", pattern: "Pattern", triage: "Triage", interview: "Interview", money: "Money", workplace: "Work smarts", communication: "Communication", decision: "Decisions",
    conversation: "Conversation", jargon: "Jargon", street: "Street smarts", self: "Self-check" };
  const SOCIAL = new Set(["conversation", "communication"]);

  const $app = document.getElementById("app");
  const $sheet = document.getElementById("sheet");
  const $toast = document.getElementById("toast");
  const $menu = document.getElementById("menuBtn");

  if (!window.supabase || !window.supabase.createClient) { $app.textContent = "Couldn't load. Check your connection and reopen."; return; }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    // Own storage key: Daily Brief keeps its own sign-in instead of sharing Test Prep Hub's on the same domain.
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "daily-brief-auth" }
  });
  // Arriving from an invitation email: ask them to choose a password first.
  const FROM_INVITE = /type=invite/.test(location.hash);

  /* ---------- helpers ---------- */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const localDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const prettyDate = (iso, opts) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", Object.assign({ weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }, opts || {}));
  const hourLabel = (h) => (h % 12 || 12) + ":00 " + (h < 12 ? "am" : "pm");
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || TZ;
  const friendly = (e) => { const m = String((e && e.message) || e || ""); return /fetch|network/i.test(m) ? "No connection. Try again." : m || "Something went wrong."; };
  let toastT = null;
  function toast(msg, plus) {
    $toast.textContent = msg; $toast.className = "toast show" + (plus ? " plus" : "");
    clearTimeout(toastT); toastT = setTimeout(() => ($toast.className = "toast" + (plus ? " plus" : "")), 1900);
  }
  const chevron = () => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "20"); s.setAttribute("height", "20"); s.setAttribute("class", "chev"); s.setAttribute("aria-hidden", "true"); s.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'; return s; };
  function greeting() { const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date())); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
  // Stable shuffle of answer choices per question, so the right answer isn't always in the same spot.
  function order(n, seed) {
    let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    const idx = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; const j = h % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx;
  }
  // Renders a multiple-choice block. `opts` are the original options; `a` the original correct index.
  function choices(box, key, opts, a, ev, onPick) {
    const ord = order(opts.length, key);
    ord.forEach((orig, pos) => {
      let cls = "opt";
      if (ev) { if (orig === a) cls += " right"; else if (orig === ev.choice) cls += " wrong"; else cls += " dim"; }
      box.append(el("button", { class: cls, disabled: !!ev || !!S.preview, onclick: () => onPick(orig) }, String.fromCharCode(65 + pos) + ". " + opts[orig]));
    });
    return String.fromCharCode(65 + ord.indexOf(a));
  }

  /* ---------- state ---------- */
  const S = { user: null, me: null, feed: null, events: new Map(), stats: null, note: null, view: "home", idx: 0, dir: 1, opened: {}, preview: null, celebrated: false };
  const evKey = (card, kind) => card + ":" + kind;
  const has = (card, kind) => S.events.has(evKey(card, kind));
  const readCount = () => (S.feed ? S.feed.cards.filter((c) => has(c.id, "read")).length : 0);

  /* ---------- boot / routing ---------- */
  let routing = false;
  async function route() {
    if (routing) return; routing = true;
    try {
      const { data: { session } } = await sb.auth.getSession();
      S.user = session ? session.user : null;
      $menu.hidden = !S.user;
      if (!S.user) return renderSignIn();
      if (FROM_INVITE && !S.passwordSet) return renderNewPassword(true);
      const { data: me, error } = await sb.rpc("brief_me");
      if (error) throw error;
      S.me = me || {};
      if (S.me.admin && (S.parentMode || !(S.me.learner && S.me.learner.active))) return await renderParent();
      if (S.me.learner && S.me.learner.active) return await renderLearner();
      renderNoAccess();
    } catch (e) {
      $app.replaceChildren(el("div", { class: "card pad" }, el("p", { text: "Couldn't load your brief. " + friendly(e) }), el("button", { class: "btn", onclick: () => route() }, "Try again")));
    } finally { routing = false; }
  }
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") return renderNewPassword();
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") route();
  });

  /* ---------- sign in ---------- */
  function renderSignIn() {
    const email = el("input", { type: "email", autocomplete: "username", required: true, id: "em" });
    const pw = el("input", { type: "password", autocomplete: "current-password", required: true, id: "pw" });
    const msg = el("p", { class: "err", role: "alert" });
    const btn = el("button", { class: "btn primary block", type: "submit" }, "Sign in");
    const form = el("form", { class: "auth", onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = ""; btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
      btn.disabled = false;
      if (error) msg.textContent = /invalid/i.test(error.message) ? "That email and password don't match." : friendly(error);
    } },
      el("h1", { text: "Ten minutes. Every day." }),
      el("p", { class: "muted", text: "The news that matters, a reasoning workout and a life skill, picked for you each morning. Sign in with your family account." }),
      el("label", { class: "f", for: "em" }, "Email", email),
      el("label", { class: "f", for: "pw" }, "Password", pw),
      btn, msg,
      el("button", { type: "button", class: "linkbtn", onclick: async () => {
        if (!email.value.trim()) { msg.textContent = "Type your email first, then tap Forgot password."; return; }
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: SITE });
        msg.textContent = error ? friendly(error) : "Check your email for a reset link.";
      } }, "Forgot password?"));
    $app.replaceChildren(form);
  }
  function renderNewPassword(welcome) {
    const pw = el("input", { type: "password", autocomplete: "new-password", minlength: "8", required: true, id: "npw" });
    const msg = el("p", { class: "err", role: "alert" });
    $app.replaceChildren(el("form", { class: "auth", onsubmit: async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: pw.value });
      if (error) msg.textContent = friendly(error); else { S.passwordSet = true; history.replaceState(null, "", location.pathname); toast(welcome ? "Welcome to Daily Brief!" : "Password updated"); route(); }
    } }, el("h1", { text: welcome ? "Welcome! Pick a password" : "Set a new password" }),
      welcome ? el("p", { class: "muted", text: "You'll use your email and this password to sign in to Daily Brief." }) : null,
      el("label", { class: "f", for: "npw" }, "New password (8+ characters)", pw), el("button", { class: "btn primary block", type: "submit" }, "Save password"), msg));
  }
  function renderNoAccess() {
    $app.replaceChildren(el("div", { class: "auth" }, el("h1", { text: "Almost there" }),
      el("p", { text: "Your account works, but Daily Brief hasn't been turned on for it yet. Ask your parent to add you." }),
      el("button", { class: "btn", onclick: signOut }, "Sign out")));
  }
  async function signOut() { closeSheet(); await sb.auth.signOut(); }

  /* ---------- learner ---------- */
  async function renderLearner() {
    const today = localDate();
    const [feedR, statsR, noteR] = await Promise.all([
      sb.from("brief_feeds").select("feed_date, cards, quiz, headline, extras").lte("feed_date", today).order("feed_date", { ascending: false }).limit(1).maybeSingle(),
      sb.rpc("brief_stats"),
      sb.from("brief_coach_notes").select("note, note_date").order("note_date", { ascending: false }).limit(1).maybeSingle()
    ]);
    if (feedR.error) throw feedR.error;
    S.feed = feedR.data; S.stats = statsR.data || { total: 0, week: 0, today: 0, streak: 0 }; S.note = noteR.data;
    S.events = new Map(); S.preview = null;
    if (S.feed) {
      const { data: evs } = await sb.from("brief_events").select("card_id, kind, correct, choice, answer, points, ms").eq("feed_date", S.feed.feed_date);
      for (const e of evs || []) S.events.set(evKey(e.card_id, e.kind), e);
    }
    if (!S.view) S.view = "home";
    paintLearner();
  }

  /* ---------- learner: home + story-style deck ---------- */
  const LEVELS = [[0, "Rookie"], [150, "Reader"], [400, "Informed"], [800, "Sharp"], [1400, "Insider"], [2200, "Analyst"], [3300, "Strategist"], [4800, "Visionary"], [7000, "Legend"]];
  function level(total) {
    let i = 0; while (i < LEVELS.length - 1 && total >= LEVELS[i + 1][0]) i++;
    const lo = LEVELS[i][0], hi = i < LEVELS.length - 1 ? LEVELS[i + 1][0] : lo + 3000;
    return { n: i + 1, name: LEVELS[i][1], pct: Math.min(100, Math.round((100 * (total - lo)) / (hi - lo))), toNext: hi - total, next: LEVELS[i + 1] ? LEVELS[i + 1][1] : null };
  }
  const EMOJI = { basics: "📚", local: "⚡", science: "🔭", climate: "🌱", civics: "🏛️", culture: "🎭", finance: "💰", tech: "🤖", health: "🧬", world: "🌍", Kerala: "🌴", India: "🇮🇳", estimation: "🔢", flaw: "🔍", logic: "🧠", pattern: "📈", triage: "⏱️",
    conversation: "💬", jargon: "📖", street: "🛡️", self: "🪞", interview: "🎤", money: "💵", workplace: "💼", decision: "⚖️", communication: "🗣️" };
  function tagFor(c) {
    const cat = catOf(c);
    const label = c.type === "news" || c.type === "basics" ? CAT[cat] : KIND[c.kind] || CAT[cat];
    return el("span", { class: "tag " + cat, text: label });
  }
  function catOf(c) { return c.type === "basics" ? "basics" : c.type === "news" ? (CAT[c.cat] ? c.cat : "world") : c.type === "reasoning" ? "reasoning" : SOCIAL.has(c.kind) ? "social" : "skills"; }
  function emojiOf(c) { return c.type === "news" ? EMOJI[c.region] || EMOJI[c.cat] || "📰" : EMOJI[c.kind] || "✨"; }
  const deckItems = () => [...S.feed.cards.map((c) => ({ t: "card", c })), ...(S.feed.quiz && S.feed.quiz.length ? [{ t: "quiz" }] : []), { t: "finish" }];
  const allDone = () => readCount() >= S.feed.cards.length && (S.feed.quiz || []).every((q) => has(q.id, "recall"));

  function paintLearner(keepScroll) {
    document.body.classList.toggle("in-deck", S.view === "deck");
    if (S.view === "deck" && S.feed) return paintDeck(keepScroll);
    paintHome();
  }

  function ring(n, total) {
    const r = 34, c = 2 * Math.PI * r, p = total ? n / total : 0;
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 80 80"); s.setAttribute("class", "ring"); s.setAttribute("aria-hidden", "true");
    s.innerHTML = `<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7A45"/><stop offset="1" stop-color="#FF2E83"/></linearGradient></defs>
      <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="8"/>
      <circle cx="40" cy="40" r="${r}" fill="none" stroke="url(#rg)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 40 40)" class="ring-fill"/>`;
    return s;
  }

  function paintHome() {
    const today = localDate();
    const name = (S.me.learner && S.me.learner.name) || "";
    const nodes = [];
    const lv = level(S.stats.total || 0);
    if (!S.feed) {
      nodes.push(el("section", { class: "hero2" }, el("div", { class: "date", text: prettyDate(today) }), el("h1", { text: greeting() + (name ? ", " + name : "") })),
        el("div", { class: "card pad" }, el("div", { class: "loading", style: "justify-content:flex-start;padding:0 0 8px" }, el("span"), "Your first brief is being put together…"),
          el("div", { class: "muted small", text: "This page checks every minute and opens it as soon as it's ready. After that, a new brief arrives every morning." })));
      clearTimeout(S.waitT);
      if (!S.preview) S.waitT = setTimeout(() => { if (!S.feed && S.view === "home") route(); }, 60000);
      return $app.replaceChildren(...nodes.filter((x) => x != null));
    }
    const n = readCount(), total = S.feed.cards.length;
    const started = n > 0, done = allDone();
    const nextIdx = Math.max(0, S.feed.cards.findIndex((c) => !has(c.id, "read")));
    const ctaText = done ? "Review today's brief" : started ? (n >= total ? "Finish the recall quiz" : "Continue · card " + (nextIdx + 1) + " of " + total) : "Start today's brief";
    const ctaIdx = done ? 0 : n >= total ? total : nextIdx;
    nodes.push(el("section", { class: "hero2" },
      el("div", { class: "date", text: prettyDate(today) }),
      el("h1", { text: greeting() + (name ? ", " + name : "") }),
      el("div", { class: "hud" },
        el("div", { class: "ringbox" }, ring(n, total), el("div", { class: "ringtxt" }, el("b", { text: n }), el("span", { text: "of " + total }))),
        el("div", { class: "hudstats" },
          el("div", { class: "flame" + (S.stats.streak > 0 ? " lit" : "") }, el("span", { class: "fl", text: "🔥" }), el("b", { text: S.stats.streak || 0 }), el("span", { text: "day streak" })),
          el("div", { class: "lvl" }, el("div", { class: "lvlrow" }, el("span", { class: "badge", text: "Lv " + lv.n }), el("b", { text: lv.name }), el("span", { class: "pts-pill", id: "ptsPill", text: (S.stats.today || 0) + " pts today" })),
            el("div", { class: "xp" }, el("i", { style: "width:" + lv.pct + "%" })),
            el("span", { class: "muted small", text: lv.next ? lv.toNext + " pts to " + lv.next : "Top level!" })))),
      el("button", { class: "cta", onclick: () => openDeck(S.preview ? 0 : ctaIdx) }, el("span", { text: S.preview ? "Open the brief" : ctaText }), el("span", { class: "arr", text: "→" })),
      el("div", { class: "cta-sub muted small", text: done ? "All done for today. Nice work." : "⏱ " + Math.round(targetMs() / 60000) + "-min brief · " + (total - n) + " cards left" + (usedMs() > 30000 ? " · " + fmt(usedMs()) + " used" : "") })));
    if (S.feed.feed_date !== today && !S.preview) nodes.push(el("div", { class: "stale", text: "Today's brief isn't ready yet, so here's the latest one (" + prettyDate(S.feed.feed_date, { weekday: "short", month: "short" }) + ")." }));
    if (S.note && S.note.note) nodes.push(el("div", { class: "coach2" }, el("div", { class: "av", text: "🧭" }), el("div", {}, el("b", { text: "Coach" }), el("p", { text: S.note.note }))));
    nodes.push(weekView());
    nodes.push(feedbackView());
    nodes.push(answersView());
    nodes.push(missionView());
    nodes.push(el("div", { class: "section-h" }, el("h3", { text: "Today's lineup" }), el("span", { class: "muted small", text: n + "/" + total + " read" })));
    nodes.push(el("div", { class: "tiles" }, S.feed.cards.map((c, i) => {
      const read = has(c.id, "read");
      return el("button", { class: "tile g-" + catOf(c) + (read ? " read" : ""), onclick: () => openDeck(i) },
        el("span", { class: "te", text: emojiOf(c) }), el("span", { class: "tk", text: (c.type === "news" || c.type === "basics") ? CAT[catOf(c)] : KIND[c.kind] || CAT[catOf(c)] }),
        el("span", { class: "tt", text: c.title }), read ? el("span", { class: "tick", text: "✓" }) : null,
        (S.events.get(evKey(c.id, "like")) || {}).choice > 0 ? el("span", { class: "heart", text: "💖" }) : null);
    })));
    const qz = S.feed.quiz || [];
    if (qz.length) {
      const unlocked = n >= Math.min(QUIZ_UNLOCK, total) || S.preview;
      const qd = qz.filter((q) => has(q.id, "recall")).length;
      nodes.push(el("button", { class: "tile wide g-quiz" + (unlocked ? "" : " locked"), onclick: () => (unlocked ? openDeck(total) : toast("Read " + QUIZ_UNLOCK + " cards to unlock")) },
        el("span", { class: "te", text: unlocked ? "🏆" : "🔒" }), el("span", { class: "tk", text: "Recall quiz · +" + PTS.recallRight + " each" }),
        el("span", { class: "tt", text: unlocked ? qd + " of " + qz.length + " answered" : "Unlocks after " + QUIZ_UNLOCK + " cards" })));
    }
    const days = (S.stats.days || []).slice(-7);
    if (days.length) nodes.push(el("div", { class: "week" }, el("div", { class: "eyebrow", text: "Your week" }), el("div", { class: "wk" }, days.map((d) => el("div", { class: "wd" + (d.read >= 6 ? " on" : d.pts ? " some" : "") + (d.d === today ? " today" : "") },
      el("i", {}), el("span", { text: new Date(d.d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" }) }))))));
    if (S.preview) nodes.unshift(el("div", { class: "preview-banner" }, el("span", { text: "Preview of " + S.preview.name + "'s brief for " + prettyDate(S.feed.feed_date, { weekday: "short", month: "short" }) + ". Nothing is recorded." }), el("button", { class: "btn ghost", onclick: () => { S.preview = null; S.me.learner = null; route(); } }, "Back")));
    $app.replaceChildren(...nodes.filter((x) => x != null));
  }

  function openDeck(i) {
    S.view = "deck"; S.painted = null; S.idx = Math.max(0, Math.min(i, deckItems().length - 1));
    paintLearner(); window.scrollTo(0, 0);
  }
  function closeDeck() { timerStop("close"); S.view = "home"; paintLearner(); window.scrollTo(0, 0); }

  let slideScroll = 0;
  function paintDeck(keepScroll) {
    const items = deckItems(), it = items[S.idx], total = S.feed.cards.length;
    const prevSlide = document.querySelector(".slide");
    if (keepScroll && prevSlide) slideScroll = prevSlide.scrollTop;
    const segs = el("div", { class: "segs" }, items.filter((x) => x.t !== "finish").map((x, i) => el("i", { class: (i === S.idx ? "cur " : "") + ((x.t === "card" && has(x.c.id, "read")) || (x.t === "quiz" && (S.feed.quiz || []).every((q) => has(q.id, "recall"))) ? "done" : "") })));
    const top = el("div", { class: "deck-top" }, segs, el("div", { class: "deck-row" },
      el("button", { class: "iconbtn ghosty", "aria-label": "Close", onclick: closeDeck }, "✕"),
      el("span", { class: "pos", text: it.t === "card" ? S.idx + 1 + " / " + total : it.t === "quiz" ? "Recall quiz" : "Done" }),
      it.t !== "finish" && !S.preview ? el("button", { class: "timer", id: "timerPill", "aria-label": "Pause timer", onclick: () => timerPause(true) }, el("span", { class: "tt" }), el("span", { class: "pz", text: "❚❚" })) : null,
      el("span", { class: "pts-pill", id: "ptsPill", text: "⚡ " + (S.stats.today || 0) })));
    let slide;
    if (it.t === "card") slide = cardSlide(it.c);
    else if (it.t === "quiz") slide = quizSlide();
    else slide = finishSlide();
    const bar = el("div", { class: "deck-bar" });
    bar.append(el("button", { class: "nav", "aria-label": "Previous", disabled: S.idx === 0, onclick: () => go(-1) }, "‹"));
    if (it.t === "card") {
      const c = it.c, done = has(c.id, "read"), checked = !c.check || has(c.id, "check");
      if (S.preview || done) bar.append(el("button", { class: "btn signal grow", onclick: () => go(1) }, "Next →"));
      else if (checked) bar.append(el("button", { class: "btn signal grow", onclick: () => markRead(c) }, "Done · next →"));
      else bar.append(el("button", { class: "btn grow needcheck", onclick: nudgeCheck }, "Answer the quick check to continue ↑"));
    } else if (it.t === "quiz") {
      bar.append(el("button", { class: "btn signal grow", onclick: () => go(1) }, "Finish →"));
    } else bar.append(el("button", { class: "btn signal grow", onclick: closeDeck }, "Back to home"));
    if (S.painted === S.idx) slide.classList.remove("from-left", "from-right");
    S.painted = S.idx;
    const deck = el("div", { class: "deck" }, top, slide, bar);
    $app.replaceChildren(deck);
    if (S.preview) top.prepend(el("div", { class: "preview-banner" }, el("span", { text: "Preview · nothing is recorded" }), el("button", { class: "btn ghost", onclick: () => { S.preview = null; S.view = "home"; S.me.learner = null; document.body.classList.remove("in-deck"); route(); } }, "Exit")));
    slide.scrollTop = keepScroll ? slideScroll : 0;
    swipe(slide);
    if (it.t === "finish") { timerStop("finish"); C.id = null; }
    else { timerStart(); if (it.t === "card") cardEnter(it.c.id); else { cardLeave(); C.id = null; } }
    if (it.t === "finish" && allDone() && !S.celebrated) { S.celebrated = true; confetti(); }
  }

  function nudgeCheck() {
    const box = document.querySelector(".slide .check");
    if (box) { box.scrollIntoView({ behavior: "smooth", block: "center" }); box.classList.remove("nudge"); void box.offsetWidth; box.classList.add("nudge"); }
    toast("Answer the quick check first. It shows you understood.");
  }

  /* ---------- session timer (a guide, not a hard stop; pauses on breaks and when he leaves the app) ---------- */
  const T = { since: null, iv: null, paused: false, warned: false, lastAct: Date.now() };
  const fmt = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  function targetMs() { return ((S.feed && S.feed.extras && S.feed.extras.target_minutes) || 10) * 60000; }
  function usedMs() { let t = 0; for (const e of S.events.values()) if (e.kind === "time") t += e.ms || 0; return t + (T.since ? Date.now() - T.since : 0); }
  function timerStart() {
    if (S.preview || T.paused || !S.feed) return;
    if (!T.since) { T.since = Date.now(); T.lastAct = Date.now(); }
    if (C.id && !C.since) C.since = T.since;
    if (!T.iv) T.iv = setInterval(timerTick, 1000);
    timerTick();
  }
  // Each active stretch is saved with why it ended (pause, away = left the app, idle, close, finish), its start time,
  // and the card on screen, so the parent view and the morning job can see breaks and distractions.
  async function timerFlush(endAt, why) {
    if (!T.since) return;
    const start = T.since, end = endAt || Date.now();
    const seg = Math.min(end - start, 3600000); T.since = null;
    cardLeave(end);
    if (seg > 3000 && S.user && S.feed && !S.preview)
      await record({ card_id: "seg-" + Date.now(), kind: "time", ms: Math.round(seg), points: 0, answer: JSON.stringify({ why: why || "close", start: new Date(start).toISOString(), card: C.id }) });
  }
  function timerStop(why) { clearInterval(T.iv); T.iv = null; timerFlush(null, why || "close"); }

  /* Per-card active time (pauses, time away and idle time excluded). */
  const C = { id: null, since: null, acc: {} };
  const cKey = () => "brief-cardtime-" + (S.feed ? S.feed.feed_date : "");
  try { Object.assign(C.acc, JSON.parse(localStorage.getItem("brief-cardtime-" + localDate()) || "{}")); } catch (e) { }
  function cardLeave(endAt) {
    if (C.id && C.since) { C.acc[C.id] = (C.acc[C.id] || 0) + Math.max(0, (endAt || Date.now()) - C.since); try { localStorage.setItem(cKey(), JSON.stringify(C.acc)); } catch (e) { } }
    C.since = null;
  }
  function cardEnter(id) { if (C.id === id) { if (!C.since && T.since) C.since = Date.now(); return; } cardLeave(); C.id = id; C.since = T.since ? Date.now() : null; }
  function cardActive(id) { return (C.acc[id] || 0) + (C.id === id && C.since ? Date.now() - C.since : 0); }
  function timerTick() {
    const pill = document.getElementById("timerPill");
    if (T.since && Date.now() - T.lastAct > 180000) { const idleFrom = T.lastAct; clearInterval(T.iv); T.iv = null; timerFlush(idleFrom, "idle"); timerPause(false, "Looks like you stepped away, so we paused the timer."); return; }
    if (!pill) return;
    const left = targetMs() - usedMs();
    pill.classList.toggle("over", left < 0);
    pill.querySelector(".tt").textContent = "⏱ " + (left >= 0 ? fmt(left) : "+" + fmt(-left));
    if (left < 0 && !T.warned) { T.warned = true; toast("That's your " + Math.round(targetMs() / 60000) + " minutes. Wrap up when you're ready."); }
  }
  function timerPause(manual, why) {
    clearInterval(T.iv); T.iv = null; timerFlush(null, "pause"); T.paused = true;
    const ov = el("div", { class: "pausebox", role: "dialog", "aria-modal": "true", "aria-label": "Paused" },
      el("div", { class: "pz-in" }, el("div", { class: "big", text: "☕" }), el("h3", { text: "Paused" }),
        el("p", { text: (why ? why + " " : "Take a break. ") + "Your timer is stopped at " + fmt(usedMs()) + " of " + Math.round(targetMs() / 60000) + " minutes." }),
        el("button", { class: "btn signal block", onclick: () => { ov.remove(); T.paused = false; T.lastAct = Date.now(); timerStart(); } }, "Resume")));
    document.body.append(ov);
  }
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => document.addEventListener(ev, () => (T.lastAct = Date.now()), { capture: true, passive: true }));

  function go(d) {
    const items = deckItems();
    const ni = S.idx + d;
    if (ni < 0 || ni >= items.length) return;
    if (items[ni].t === "quiz" && readCount() < Math.min(QUIZ_UNLOCK, S.feed.cards.length) && !S.preview) { toast("Read " + QUIZ_UNLOCK + " cards to unlock the quiz"); return; }
    S.idx = ni; S.dir = d; paintLearner();
  }

  function swipe(node) {
    let x0 = null, y0 = null;
    node.addEventListener("touchstart", (e) => { if (e.target.closest("textarea,input,button,a")) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    node.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) { const it = deckItems()[S.idx]; if (it.t === "card" && !has(it.c.id, "read") && !S.preview) { if (it.c.check && !has(it.c.id, "check")) nudgeCheck(); else markRead(it.c); } else go(1); }
      else go(-1);
    }, { passive: true });
  }

  function cardSlide(c) {
    if (!S.opened[c.id]) S.opened[c.id] = Date.now();
    const cat = catOf(c);
    const head = el("header", { class: "shead g-" + cat },
      el("div", { class: "meta" }, el("span", { class: "chip", text: (c.type === "news" || c.type === "basics") ? CAT[cat] : KIND[c.kind] || CAT[cat] }), c.region ? el("span", { class: "chip ghost", text: c.region }) : null),
      el("div", { class: "big", text: emojiOf(c) }),
      el("h2", { text: c.title }));
    const inner = el("div", { class: "inner" });
    inner.append(bodyWithWords(c));
    if (c.context) inner.append(el("details", { class: "catchup" }, el("summary", {}, "🧭 Catch me up: what's the backstory?"), el("p", { text: c.context })));
    if (c.why) inner.append(el("div", { class: "why" }, el("b", { text: "Why it matters" }), c.why));
    inner.append(helpView(c));
    if (Array.isArray(c.terms) && c.terms.length) inner.append(el("dl", { class: "terms" }, c.terms.map((t) => [el("dt", { text: t.term }), el("dd", {}, t.means, t.example ? el("span", { class: "ex", text: "e.g. " + t.example }) : null)])));
    if (Array.isArray(c.lines) && c.lines.length) inner.append(el("div", { class: "lines" }, el("b", { text: "Try saying" }), el("ul", {}, c.lines.map((l) => el("li", { text: l })))));
    if (c.say) inner.append(el("div", { class: "say" }, el("b", { text: "💬 Bring it up with friends" }), c.say));
    if (c.check) inner.append(checkView(c));
    if (c.tip) inner.append(el("div", { class: "tip" }, el("b", { text: "Tip: " }), c.tip));
    if (c.mission) inner.append(el("div", { class: "mission" }, el("b", { text: "🎯 Today's mission" }), c.mission, el("span", { class: "muted small", text: "Tomorrow's brief will ask how it went. Honest answers earn points too." })));
    if (c.reflect) inner.append(reflectView(c));
    if (c.speak) inner.append(speakView(c));
    if (c.curious) inner.append(curiousView(c));
    if (c.talk) inner.append(talkView(c));
    if (c.source && c.source.url) inner.append(el("div", { class: "source" }, "Source: ", el("a", { href: c.source.url, target: "_blank", rel: "noopener" }, c.source.name || "Read more"), " ↗"));
    if (!S.preview) inner.append(reactView(c));
    if (has(c.id, "read")) {
      const earned = ["read", "check", "opinion", "reflect"].reduce((t, k) => t + ((S.events.get(evKey(c.id, k)) || {}).points || 0), 0);
      inner.append(el("p", { class: "muted small", text: "✓ Read · +" + earned + " points from this card" }));
    }
    return el("article", { class: "slide" + (S.dir < 0 ? " from-left" : " from-right"), id: "c-" + c.id }, head, inner);
  }

  // Story text with tappable key words; tapping shows the meaning right under the paragraph.
  function bodyWithWords(c) {
    const wrap = el("div", { class: "bodywrap" });
    const body = el("div", { class: "body" });
    const def = el("div", { class: "defbox", hidden: true });
    const words = (Array.isArray(c.words) ? c.words : []).filter((w) => w && w.term && w.means);
    const text = c.body || "", low = text.toLowerCase();
    const hits = [];
    for (const w of words) { const i = low.indexOf(w.term.toLowerCase()); if (i >= 0 && !hits.some((h) => i < h.i + h.n && h.i < i + w.term.length)) hits.push({ i, n: w.term.length, w }); }
    hits.sort((a, b) => a.i - b.i);
    let at = 0;
    for (const h of hits) {
      body.append(text.slice(at, h.i));
      body.append(el("button", { class: "word", type: "button", onclick: (e) => {
        const on = e.currentTarget.classList.toggle("on");
        body.querySelectorAll(".word.on").forEach((b) => b !== e.currentTarget && b.classList.remove("on"));
        def.hidden = !on; def.replaceChildren(el("b", { text: h.w.term }), " — " + h.w.means);
      } }, text.slice(h.i, h.i + h.n)));
      at = h.i + h.n;
    }
    body.append(text.slice(at));
    wrap.append(body, def);
    if (hits.length) wrap.append(el("div", { class: "muted small", text: "Tap an underlined word to see what it means." }));
    return wrap;
  }

  // "I don't get it": shows a simpler version and lets him ask a question, answered in the next brief.
  function helpView(c) {
    const conf = S.events.get(evKey(c.id, "confused")), ask = S.events.get(evKey(c.id, "ask"));
    const box = el("div", { class: "help" });
    if (!conf && !S.preview) {
      box.append(el("button", { class: "btn ghost helpbtn", onclick: async () => {
        if (await record({ card_id: c.id, kind: "confused", points: PTS.confused })) { gain(PTS.confused, "Good call asking"); paintLearner(true); }
      } }, "🤔 I don't get it"));
      return box;
    }
    if (c.simple) box.append(el("div", { class: "simple" }, el("b", { text: "In simpler words" }), c.simple));
    if (S.preview) return box;
    if (ask) { box.append(el("div", { class: "asked" }, el("b", { text: "Your question" }), el("q", { text: ask.answer }), el("span", { class: "muted small", text: "You'll get an answer in tomorrow's brief. +" + ask.points }))); return box; }
    const ta = el("textarea", { placeholder: "What's still confusing? Ask anything. (+" + PTS.ask + ")", maxlength: "400", "aria-label": "Your question" });
    const save = el("button", { class: "btn", disabled: true, onclick: () => saveText(c, "ask", ta.value.trim(), PTS.ask) }, "Ask");
    ta.addEventListener("input", () => (save.disabled = ta.value.trim().length < 5));
    box.append(ta, el("div", { class: "actions" }, save, el("span", { class: "muted small", text: "Answered in tomorrow's brief." })));
    return box;
  }

  // 👍 / 👎 on each card: tells the morning job what he's into.
  function reactView(c) {
    const ev = S.events.get(evKey(c.id, "like")), v = ev ? ev.choice : 0;
    const set = async (nv) => {
      if (nv === v) return;
      const row = { user_id: S.user.id, feed_date: S.feed.feed_date, card_id: c.id, kind: "like", choice: nv, points: ev ? ev.points : 1 };
      const { error } = await sb.from("brief_events").upsert(row, { onConflict: "user_id,feed_date,card_id,kind" });
      if (error) return toast("Couldn't save. Check your connection.");
      if (!ev) { S.stats.total += 1; S.stats.today += 1; S.stats.week += 1; }
      S.events.set(evKey(c.id, "like"), row);
      if (nv > 0) gain(ev ? 0 : 1, "Noted: more like this"); else toast("Got it: less like this");
      paintLearner(true);
    };
    return el("div", { class: "react" }, el("span", { class: "muted small", text: "Into this topic?" }),
      el("button", { class: "rx" + (v > 0 ? " on" : ""), "aria-pressed": String(v > 0), onclick: () => set(1) }, "👍 More like this"),
      el("button", { class: "rx" + (v < 0 ? " on down" : ""), "aria-pressed": String(v < 0), onclick: () => set(-1) }, "👎 Not for me"));
  }

  // Instant coaching on how an answer is built (structure only; facts get checked overnight).
  const RX = {
    reason: /\b(because|since|so that|which means|that means|due to|that's why|thats why|as a result|for example|for instance|like when)\b/i,
    other: /\b(but|however|although|though|on the other hand|unless|even if|downside|trade-?off|the risk|at the same time|then again)\b/i,
    closed: /^\s*(is|are|was|were|do|does|did|can|could|will|would|should|has|have|had|isn't|aren't|don't|didn't)\b/i,
    open: /^\s*(why|how|what|which|who|where|when|in what way|to what extent)\b/i,
    deep: /\b(why|what if|what happens|how would|how do you know|evidence|assum|instead|trade-?off|cost|risk|long[- ]term|who (pays|benefits|loses)|what would change|compared)\b/i,
    filler: /\b(um+|uh+|you know|kind of|sort of|basically|literally)\b/gi
  };
  const STOP = new Set("about after again against their there these those which while would could should other being because people still today first where things".split(" "));
  function storyWords(c) { return new Set((((c.title || "") + " " + (c.body || "")).toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) => !STOP.has(w))); }
  function quickTips(kind, text, c, ms) {
    const t = (text || "").trim(), words = t ? t.split(/\s+/).length : 0;
    const first = t.split(/(?<=[.!?])\s+/)[0] || "";
    if (kind === "opinion") return [
      [words && first.split(/\s+/).length <= 25, "Point up front", "Start with your answer in one short sentence."],
      [RX.reason.test(t), "Gave a reason", "Add a reason: “because…” or an example."],
      [RX.other.test(t), "Saw the other side", "Show you see the trade-off: “but…”, “unless…”."]];
    if (kind === "question") {
      const sw = storyWords(c), tied = (t.toLowerCase().match(/[a-z]{5,}/g) || []).some((w) => sw.has(w));
      return [
        [!RX.closed.test(t) && (RX.open.test(t) || /\?/.test(t) && !RX.closed.test(t)), "Open question", "Yes/no questions stop the conversation. Start with why, how or what."],
        [tied, "Specific to the story", "Name the thing you're asking about, so only this story could answer it."],
        [RX.deep.test(t), "Digs deeper", "Go one layer down: a cause, a cost, who wins or loses, what if."]];
    }
    if (kind === "speak") {
      const s = Math.round((ms || 0) / 1000), fill = (t.match(RX.filler) || []).length;
      return [
        [words >= 25 && first.split(/\s+/).length <= 30, "Point up front", "Open with the headline in one sentence."],
        [RX.reason.test(t), "Said why it matters", "Add “it matters because…”"],
        [s ? s >= 18 && s <= 50 : words >= 40 && words <= 130, s ? "Good length (" + s + " s)" : "Good length", s && s < 18 ? "A bit short: add why it matters and what you think." : "Tighten it to about 30 seconds: point, reason, your view."],
        [fill <= 2, "Few fillers", "Pause instead of “um” or “like”. Silence sounds confident."]];
    }
    return [];
  }
  function tipsView(kind, text, c, ms, live) {
    const tips = quickTips(kind, text, c, ms);
    if (!tips.length) return null;
    const got = tips.filter((x) => x[0]).length;
    return el("div", { class: "tips" + (live ? " live" : "") },
      el("div", { class: "tips-h" }, el("b", { text: live ? "Checklist" : "Quick coaching" }), el("span", { class: "muted small", text: got + " of " + tips.length })),
      el("ul", {}, tips.map(([ok, label, hint]) => el("li", { class: ok ? "ok" : "todo" }, el("span", { class: "tk", text: ok ? "✓" : "○" }), el("span", {}, el("b", { text: label }), ok ? null : el("span", { class: "muted small", text: " " + hint }))))),
      live ? null : el("div", { class: "muted small", text: "Your coach also checks your facts and gives feedback tomorrow on your home screen." }));
  }

  // 🎤 Say it out loud: speech-to-text practice (falls back to typing where the browser can't transcribe).
  function speakView(c) {
    const ev = S.events.get(evKey(c.id, "speak"));
    const box = el("div", { class: "speak" }, el("b", { text: "🎤 Say it out loud" }), el("div", { class: "q", text: c.speak }));
    if (ev) { box.append(el("div", { class: "saved", text: ev.answer }), el("div", { class: "muted small", text: "Saved · " + Math.round((ev.ms || 0) / 1000) + " s · +" + ev.points }), tipsView("speak", ev.answer, c, ev.ms)); return box; }
    if (S.preview) return box;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const out = el("div", { class: "transcript", "aria-live": "polite" });
    const clock = el("span", { class: "num speakclock", text: "0:00" });
    const save = el("button", { class: "btn signal", hidden: true }, "Save");
    let t0 = 0, iv = null, text = "", rec = null;
    const tipsBox = el("div");
    const finish = () => { clearInterval(iv); iv = null; if (rec) try { rec.stop(); } catch (e) { } go.textContent = "🎙 Try again"; save.hidden = !text.trim(); tipsBox.replaceChildren(text.trim() ? tipsView("speak", text, c, Date.now() - t0, true) || "" : ""); };
    const go = el("button", { class: "btn mic", onclick: () => {
      if (iv) return finish();
      text = ""; out.textContent = "Listening… start talking.";
      t0 = Date.now(); iv = setInterval(() => (clock.textContent = fmt(Date.now() - t0)), 250);
      go.textContent = "■ Stop"; save.hidden = true;
      if (!SR) return;
      rec = new SR(); rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => { let fin = "", tmp = ""; for (const r of e.results) (r.isFinal ? (fin += r[0].transcript + " ") : (tmp += r[0].transcript)); text = fin; out.textContent = (fin + tmp).trim() || "Listening…"; };
      rec.onerror = () => { out.textContent = "The mic isn't available here. Type what you said instead."; ta.hidden = false; };
      rec.onend = () => { if (iv) finish(); };
      try { rec.start(); } catch (e) { rec.onerror(); }
    } }, "🎙 Start talking");
    const ta = el("textarea", { hidden: !!SR, placeholder: "Say it out loud first, then type roughly what you said.", maxlength: "800", "aria-label": "What you said" });
    ta.addEventListener("input", () => { text = ta.value; save.hidden = text.trim().length < 15; tipsBox.replaceChildren(text.trim().length >= 15 ? tipsView("speak", text, c, t0 ? Date.now() - t0 : 0, true) : ""); });
    save.addEventListener("click", async () => {
      const ms = t0 ? Math.min(Date.now() - t0, 600000) : 0;
      if (await record({ card_id: c.id, kind: "speak", answer: text.trim().slice(0, 800), ms: Math.round(ms), points: PTS.speak })) { gain(PTS.speak, "Nice delivery"); paintLearner(true); }
    });
    box.append(el("div", { class: "actions" }, go, clock), out, ta, tipsBox, save,
      el("div", { class: "muted small", text: "Aim for about 30 seconds: what happened, why it matters, what you think." }));
    return box;
  }

  // ❓ Question challenge: practice asking sharp questions. Good ones get answered in tomorrow's brief.
  function curiousView(c) {
    const ev = S.events.get(evKey(c.id, "question"));
    const box = el("div", { class: "curious" }, el("b", { text: "❓ Question challenge" }), el("div", { class: "q", text: c.curious }));
    if (ev) { box.append(el("div", { class: "saved", text: ev.answer }), el("div", { class: "muted small", text: "Saved · +" + ev.points + ". The best questions get answered tomorrow." }), tipsView("question", ev.answer, c)); return box; }
    if (S.preview) return box;
    const ta = el("textarea", { placeholder: "Your question. Make it one you really want answered. (+" + PTS.question + ")", maxlength: "300", "aria-label": "Your question" });
    const save = el("button", { class: "btn", disabled: true, onclick: () => saveText(c, "question", ta.value.trim(), PTS.question) }, "Save my question");
    const qtips = el("div");
    ta.addEventListener("input", () => { save.disabled = ta.value.trim().length < 10; qtips.replaceChildren(ta.value.trim().length >= 10 ? tipsView("question", ta.value, c, 0, true) : ""); });
    box.append(ta, qtips, el("div", { class: "actions" }, save, el("span", { class: "muted small", text: "Open questions (why, how, what if) score best." })));
    return box;
  }

  // 📝 Next-morning feedback written by the coach (extras.feedback) and the Sunday week review (extras.week).
  const FBK = { opinion: "💬 Your take", speak: "🎤 Said out loud", question: "❓ Your question", check: "⚡ Quick check", recall: "🏆 Recall", ask: "🙋 You asked", fact: "🔎 Fact check" };
  function feedbackView() {
    const list = S.feed.extras && S.feed.extras.feedback;
    if (!Array.isArray(list) || !list.length) return null;
    const seen = list.filter((f, i) => has(fbId(f, i), "feedback")).length;
    return el("section", { class: "fb" },
      el("div", { class: "fb-h" }, el("div", { class: "eyebrow", text: "📝 Your feedback" + (list[0].ref ? " · from " + prettyDate(list[0].ref, { weekday: "short", month: "short" }) : "") }), el("span", { class: "muted small", text: seen + "/" + list.length + " read" })),
      list.map((f, i) => fbItem(f, i)));
  }
  function fbId(f, i) { return "fb:" + (f.card_id || i) + ":" + (f.kind || "x"); }
  function fbItem(f, i) {
    const id = fbId(f, i), done = has(id, "feedback");
    const d = el("details", { class: "fbi" + (done ? " done" : "") + (Array.isArray(f.fixes) && f.fixes.length ? " hasfix" : "") });
    if (!done && i === 0) d.open = true;
    d.append(el("summary", {}, el("span", { class: "fk", text: FBK[f.kind] || "📝 Feedback" }), el("span", { class: "ft", text: f.title || "" }),
      typeof f.score === "number" ? el("span", { class: "dots", "aria-label": f.score + " of 3" }, [0, 1, 2].map((k) => el("i", { class: k < f.score ? "on" : "" }))) : null,
      Array.isArray(f.fixes) && f.fixes.length ? el("span", { class: "fixtag", text: "Fact fix" }) : null));
    const body = el("div", { class: "fbb" });
    if (f.answer) body.append(el("q", { class: "said", text: f.answer }));
    if (Array.isArray(f.checks) && f.checks.length) body.append(el("ul", { class: "tips-l" }, f.checks.map((x) => el("li", { class: x.ok ? "ok" : "todo" }, el("span", { class: "tk", text: x.ok ? "✓" : "○" }), el("span", { text: x.t })))));
    if (f.good) body.append(el("p", { class: "good" }, el("b", { text: "What worked " }), f.good));
    if (Array.isArray(f.fixes)) for (const x of f.fixes) body.append(el("div", { class: "fix" },
      el("b", { text: "🔎 Fact fix" }),
      x.said ? el("p", {}, el("span", { class: "muted", text: "You said: " }), x.said) : null,
      el("p", {}, el("span", { class: "muted", text: "Actually: " }), x.actually || ""),
      x.source && /^https:\/\//.test(x.source.url || "") ? el("a", { href: x.source.url, target: "_blank", rel: "noopener", class: "small", text: "Source: " + (x.source.name || "link") }) : null));
    if (f.next) body.append(el("p", { class: "next" }, el("b", { text: "Try next time " }), f.next));
    if (f.better) body.append(el("div", { class: "better" }, el("b", { text: "A stronger version" }), el("p", { text: f.better })));
    if (!S.preview) body.append(done ? el("div", { class: "muted small", text: "✓ Got it" }) : el("button", { class: "btn ghost", onclick: async () => {
      if (await record({ card_id: id, kind: "feedback", points: PTS.feedback })) { gain(PTS.feedback, "Learning from feedback"); paintLearner(true); }
    } }, "Got it (+" + PTS.feedback + ")"));
    d.append(body);
    return d;
  }
  function weekView() {
    const w = S.feed.extras && S.feed.extras.week;
    if (!w || (!w.win && !w.focus)) return null;
    return el("section", { class: "wkrev" }, el("div", { class: "eyebrow", text: "🗓 Your week in review" }),
      w.win ? el("p", {}, el("b", { text: "📈 Got better: " }), w.win) : null,
      w.focus ? el("p", {}, el("b", { text: "🎯 Next week: " }), w.focus) : null,
      Array.isArray(w.evidence) && w.evidence.length ? el("ul", {}, w.evidence.map((x) => el("li", { text: x }))) : null,
      Array.isArray(w.facts) && w.facts.length ? el("div", { class: "fix" }, el("b", { text: "🔎 Facts worth remembering" }), el("ul", {}, w.facts.map((x) => el("li", { text: x })))) : null);
  }

  function answersView() {
    const a = S.feed.extras && S.feed.extras.answers;
    if (!Array.isArray(a) || !a.length) return null;
    return el("section", { class: "answers" }, el("div", { class: "eyebrow", text: "❓ You asked" }),
      a.map((x) => el("div", { class: "qa" }, el("b", { text: x.q }), el("p", { text: x.a }))));
  }

  function checkView(c) {
    const ev = S.events.get(evKey(c.id, "check"));
    const box = el("div", { class: "check" }, el("div", { class: "q", text: "⚡ " + c.check.q }));
    const letter = choices(box, S.feed.feed_date + c.id, c.check.o, c.check.a, ev, (i) => answerCheck(c, i));
    if (ev || S.preview) box.append(el("div", { class: "explain" }, el("b", { text: S.preview ? "Answer: " + letter + "." : ev.correct ? "Nailed it! +" + ev.points : "Not quite. +" + ev.points + " for trying." }), c.check.e));
    return box;
  }

  function talkView(c) {
    const ev = S.events.get(evKey(c.id, "opinion"));
    const wrap = el("div", { class: "talk" }, el("div", { class: "q", text: c.talk }));
    if (ev) { wrap.append(el("div", { class: "saved", text: ev.answer }), el("div", { class: "muted small", text: "Saved · +" + ev.points + ". Strong reasons earn bonus points tomorrow." }), tipsView("opinion", ev.answer, c)); return wrap; }
    if (S.preview) return wrap;
    const ta = el("textarea", { placeholder: "Your take in 1–3 sentences. Give a reason. (+" + PTS.opinion + ")", maxlength: "600", "aria-label": "Your answer" });
    const save = el("button", { class: "btn", disabled: true, onclick: () => saveOpinion(c, ta.value.trim()) }, "Save my take");
    const otips = el("div");
    ta.addEventListener("input", () => { save.disabled = ta.value.trim().length < 15; otips.replaceChildren(ta.value.trim().length >= 15 ? tipsView("opinion", ta.value, c, 0, true) : ""); });
    wrap.append(ta, otips, el("div", { class: "actions" }, save, el("span", { class: "muted small", text: "Graded on your reasons, not your side." })));
    return wrap;
  }

  function reflectView(c) {
    const ev = S.events.get(evKey(c.id, "reflect"));
    const wrap = el("div", { class: "talk reflect" }, el("div", { class: "q", text: c.reflect }));
    if (ev) { wrap.append(el("div", { class: "saved", text: ev.answer }), el("div", { class: "muted small", text: "Saved · +" + ev.points })); return wrap; }
    if (S.preview) return wrap;
    const ta = el("textarea", { placeholder: "There's no wrong answer. (+" + PTS.reflect + ")", maxlength: "600", "aria-label": "Your reflection" });
    const save = el("button", { class: "btn", disabled: true, onclick: () => saveText(c, "reflect", ta.value.trim(), PTS.reflect) }, "Save");
    ta.addEventListener("input", () => (save.disabled = ta.value.trim().length < 10));
    wrap.append(ta, el("div", { class: "actions" }, save, el("span", { class: "muted small", text: "Not graded." })));
    return wrap;
  }

  function missionView() {
    const m = S.feed.extras && S.feed.extras.mission_checkin;
    if (!m || !m.text) return null;
    const ev = S.events.get(evKey("mission", "mission"));
    const box = el("section", { class: "checkin" }, el("div", { class: "eyebrow", text: "🎯 Mission check-in" + (m.ref ? " · from " + prettyDate(m.ref, { weekday: "short", month: "short" }) : "") }), el("div", { class: "q", text: m.text }));
    if (ev) { box.append(el("div", { class: "small", text: ["Not yet: no problem, it'll come around again.", "Partly: that still counts. Nice.", "You did it! That takes guts."][ev.choice] + " +" + ev.points })); return box; }
    if (S.preview) return box;
    const opts = [["Did it ✅", 2], ["Partly", 1], ["Not yet", 0]];
    box.append(el("div", { class: "actions" }, opts.map(([label, v]) => el("button", { class: "btn" + (v === 2 ? " signal" : " ghost"), onclick: async () => {
      if (await record({ card_id: "mission", kind: "mission", choice: v, answer: m.text.slice(0, 600), points: PTS.mission[v] })) { gain(PTS.mission[v], v === 2 ? "Brave move!" : ""); paintLearner(true); }
    } }, label))));
    return box;
  }

  async function saveText(c, kind, text, pts) {
    if (await record({ card_id: c.id, kind, answer: text.slice(0, 600), points: pts })) { gain(pts, "Saved"); paintLearner(true); }
  }

  async function record(row) {
    const full = Object.assign({ user_id: S.user.id, feed_date: S.feed.feed_date }, row);
    const { error } = await sb.from("brief_events").upsert(full, { onConflict: "user_id,feed_date,card_id,kind", ignoreDuplicates: true });
    if (error) { toast("Couldn't save. Check your connection."); return false; }
    S.events.set(evKey(row.card_id, row.kind), full);
    const pts = row.points || 0;
    const before = level(S.stats.total || 0).n;
    S.stats.total += pts; S.stats.today += S.feed.feed_date === localDate() ? pts : 0; S.stats.week += pts;
    const after = level(S.stats.total);
    if (after.n > before) setTimeout(() => { toast("Level up! Lv " + after.n + " · " + after.name + " 🎉", true); confetti(); }, 700);
    return true;
  }

  // Points feedback: floating "+N" plus a pill bump.
  function gain(pts, label) {
    const f = el("div", { class: "floatpts", text: "+" + pts + (label ? " · " + label : "") });
    document.body.append(f); setTimeout(() => f.remove(), 1200);
    requestAnimationFrame(() => { const p = document.getElementById("ptsPill"); if (p) { p.classList.remove("bump"); void p.offsetWidth; p.classList.add("bump"); } });
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { }
  }

  async function answerCheck(c, i) {
    if (has(c.id, "check") || S.preview) return;
    const correct = i === c.check.a;
    const pts = correct ? PTS.right : PTS.wrong;
    if (await record({ card_id: c.id, kind: "check", correct, choice: i, points: pts, ms: Math.min(3600000, Math.round(cardActive(c.id))) })) { gain(pts, correct ? "Correct!" : "Good try"); paintLearner(true); }
  }

  async function saveOpinion(c, text) {
    if (text.length < 15) return;
    if (await record({ card_id: c.id, kind: "opinion", answer: text.slice(0, 600), points: PTS.opinion })) { gain(PTS.opinion, "Take saved"); paintLearner(true); }
  }

  async function markRead(c) {
    if (has(c.id, "read")) return go(1);
    const ms = Math.min(3600000, Math.round(cardActive(c.id)) || (Date.now() - (S.opened[c.id] || Date.now())));
    const pts = ms >= 12000 ? PTS.readLong : PTS.readShort;
    if (!(await record({ card_id: c.id, kind: "read", ms, points: pts }))) return;
    const n = readCount(), total = S.feed.cards.length;
    if (n === total && !has("_complete", "bonus")) {
      if (await record({ card_id: "_complete", kind: "bonus", points: PTS.complete })) gain(pts + PTS.complete, "All 10 read!");
    } else gain(pts, n === QUIZ_UNLOCK ? "Quiz unlocked 🔓" : "");
    if (n === QUIZ_UNLOCK || n === total) { const { data } = await sb.rpc("brief_stats"); if (data) S.stats = data; }
    S.idx = Math.min(S.idx + 1, deckItems().length - 1); S.dir = 1;
    paintLearner();
  }

  function quizSlide() {
    const qz = S.feed.quiz || [];
    const done = qz.filter((q) => has(q.id, "recall")).length;
    const head = el("header", { class: "shead g-quiz" }, el("div", { class: "meta" }, el("span", { class: "chip", text: "Recall quiz" }), el("span", { class: "chip ghost", text: done + " of " + qz.length })),
      el("div", { class: "big", text: "🏆" }), el("h2", { text: "Do you remember?" }), el("p", { class: "sub", text: "Questions from earlier briefs. Remembering is what turns news into knowledge. +" + PTS.recallRight + " each." }));
    const inner = el("div", { class: "inner", id: "quiz" });
    for (const q of qz) {
      const ev = S.events.get(evKey(q.id, "recall"));
      const box = el("div", { class: "check" }, q.ref ? el("div", { class: "ref", text: "From " + prettyDate(q.ref, { weekday: undefined, month: "short" }) }) : null, el("div", { class: "q", text: q.q }));
      const letter = choices(box, S.feed.feed_date + q.id, q.o, q.a, ev, (i) => answerRecall(q, i));
      if (ev || S.preview) box.append(el("div", { class: "explain" }, el("b", { text: S.preview ? "Answer: " + letter + "." : ev.correct ? "Remembered! +" + ev.points : "+" + ev.points + " for trying." }), q.e));
      inner.append(box);
    }
    return el("article", { class: "slide" + (S.dir < 0 ? " from-left" : " from-right") }, head, inner);
  }

  async function answerRecall(q, i) {
    if (has(q.id, "recall") || S.preview) return;
    const correct = i === q.a, pts = correct ? PTS.recallRight : PTS.recallWrong;
    if (await record({ card_id: q.id, kind: "recall", correct, choice: i, points: pts })) { gain(pts, correct ? "Remembered!" : ""); paintLearner(true); }
  }

  function finishSlide() {
    const complete = allDone(), lv = level(S.stats.total || 0);
    const says = S.feed.cards.filter((c) => c.say).slice(0, 3);
    const head = el("header", { class: "shead g-finish" }, el("div", { class: "big", text: complete ? "🎉" : "👀" }),
      el("h2", { text: complete ? "Brief complete!" : "Almost there" }),
      el("p", { class: "sub", text: complete ? "You're caught up on today." + (S.stats.streak > 1 ? " That's " + S.stats.streak + " days in a row." : " Come back tomorrow to start a streak.") : readCount() + " of " + S.feed.cards.length + " cards read. Go back to finish the rest." }));
    const inner = el("div", { class: "inner" },
      el("div", { class: "finstats" },
        el("div", {}, el("b", { text: S.stats.today || 0 }), el("span", { text: "points today" })),
        el("div", {}, el("b", { text: (S.stats.streak || 0) + "🔥" }), el("span", { text: "day streak" })),
        el("div", {}, el("b", { text: "Lv " + lv.n }), el("span", { text: lv.name }))),
      el("div", { class: "xp big" }, el("i", { style: "width:" + lv.pct + "%" })),
      el("p", { class: "muted small", style: "text-align:center;margin:0", text: lv.next ? lv.toNext + " points to " + lv.next : "Top level!" }));
    if (says.length) inner.append(el("div", { class: "lines" }, el("b", { text: "Your conversation starters for today" }), el("ul", {}, says.map((c) => el("li", { text: c.say })))));
    return el("article", { class: "slide" }, head, inner);
  }

  // Lightweight confetti; skipped when the user prefers reduced motion.
  function confetti() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cv = el("canvas", { class: "confetti", "aria-hidden": "true" }); document.body.append(cv);
    const W = (cv.width = innerWidth * devicePixelRatio), H = (cv.height = innerHeight * devicePixelRatio), cx = cv.getContext("2d");
    const cols = ["#FF7A45", "#FF2E83", "#7C5CFF", "#22C3A6", "#FFC53D", "#3DA5FF"];
    const ps = Array.from({ length: 140 }, () => ({ x: W / 2, y: H * 0.35, vx: (Math.random() - 0.5) * 22 * devicePixelRatio, vy: (Math.random() * -18 - 6) * devicePixelRatio, r: (4 + Math.random() * 5) * devicePixelRatio, c: cols[(Math.random() * cols.length) | 0], a: Math.random() * 6 }));
    let t = 0;
    (function frame() {
      cx.clearRect(0, 0, W, H);
      for (const p of ps) { p.vy += 0.5 * devicePixelRatio; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.a += 0.2; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); cx.restore(); }
      if (++t < 110) requestAnimationFrame(frame); else cv.remove();
    })();
  }

  /* ---------- parent view ---------- */
  async function renderParent() {
    const { data, error } = await sb.rpc("brief_admin_overview");
    if (error) throw error;
    const kids = data || [];
    const mine = S.me.learner && S.me.learner.active;
    const nodes = [el("section", { class: "hero" }, el("div", { class: "date", text: prettyDate(localDate()) }), el("h1", { text: "Parent view" }),
      mine ? el("button", { class: "btn signal", style: "margin-top:10px", onclick: () => { S.parentMode = false; S.view = "home"; route(); } }, "Open my own brief →") : null)];
    if (!kids.length) nodes.push(el("div", { class: "card pad", text: "No one added yet." }));
    for (const k of kids) nodes.push(k.private ? privateView(k) : kidView(k));
    nodes.push(addPersonView());
    $app.replaceChildren(...nodes.filter((x) => x != null));
  }

  const BAND = { explorer: "Grades 3–5 level", builder: "Middle-school level", challenger: "High-school level", adult: "Adult level" };
  const who = (k) => (k.age ? "Age " + k.age + " · " : "") + (BAND[k.band] || k.band) + (k.active === false ? " · paused" : "");

  // Edit age (which sets the reading level) and pause/resume.
  function personSettings(k) {
    const age = el("input", { type: "number", min: "5", max: "100", value: k.age || "", "aria-label": "Age", style: "width:90px" });
    const msg = el("span", { class: "muted small", role: "status" });
    const call = async (patch) => {
      msg.textContent = "Saving…";
      const { data, error } = await sb.functions.invoke("brief-admin", { body: Object.assign({ action: "update", user_id: k.user_id }, patch) });
      if (error || (data && data.error)) { msg.textContent = (data && data.error) || "Couldn't save."; return; }
      msg.textContent = "Saved. Tomorrow's brief will follow it."; setTimeout(route, 700);
    };
    return el("details", { class: "goalsbox" }, el("summary", { text: "Age and settings" }),
      el("div", { class: "addgoal" }, el("label", { class: "f", style: "flex:1" }, "Age (sets the reading level)", age),
        el("button", { class: "btn", style: "align-self:end", onclick: () => call({ age: age.value === "" ? null : +age.value }) }, "Save age")),
      el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: () => call({ active: k.active === false }) }, k.active === false ? "Resume Daily Brief" : "Pause Daily Brief"), msg),
      k.email ? el("p", { class: "muted small", style: "margin:0", text: "Signs in as " + k.email }) : null);
  }

  // Other adults: activity only; their answers stay private.
  function privateView(k) {
    const st = k.stats || {};
    return el("article", { class: "card kid" },
      el("div", { class: "row", style: "display:flex;justify-content:space-between;align-items:baseline;gap:10px" }, el("h2", { text: k.name }), el("span", { class: "muted small", text: who(k) })),
      el("div", { class: "stats" },
        el("div", { class: "stat" + (st.streak ? " hot" : "") }, el("b", { text: (st.streak || 0) + "🔥" }), el("span", { text: "day streak" })),
        el("div", { class: "stat" }, el("b", { text: st.week || 0 }), el("span", { text: "points this week" })),
        el("div", { class: "stat" }, el("b", { text: st.total || 0 }), el("span", { text: "all-time points" }))),
      el("p", { class: "muted small", style: "margin:0", text: "Adults' answers and evaluations are private to them." }),
      personSettings(k));
  }

  function addPersonView() {
    const name = el("input", { type: "text", maxlength: "40", placeholder: "First name", "aria-label": "First name" });
    const email = el("input", { type: "email", placeholder: "Email", "aria-label": "Email" });
    const age = el("input", { type: "number", min: "5", max: "100", placeholder: "Age", "aria-label": "Age" });
    const hint = el("p", { class: "muted small", style: "margin:0", text: "Reading level follows age: 10 and under, 11–13, 14–18, or adult." });
    const msg = el("p", { class: "small", role: "status", style: "margin:0" });
    const btn = el("button", { class: "btn primary", onclick: async () => {
      if (!name.value.trim() || !email.value.trim()) { msg.textContent = "Add a name and email."; return; }
      btn.disabled = true; msg.textContent = "Adding…";
      const { data, error } = await sb.functions.invoke("brief-admin", { body: { action: "add", name: name.value.trim(), email: email.value.trim(), age: age.value === "" ? null : +age.value } });
      btn.disabled = false;
      if (error || (data && data.error)) { msg.textContent = (data && data.error) || "Couldn't add them. Try again."; return; }
      msg.textContent = data.status === "invited"
        ? "Invitation sent to " + email.value.trim() + ". They open the email, pick a password, and their first brief arrives the next morning."
        : "Added. They sign in with their existing account; their first brief arrives the next morning.";
      name.value = ""; email.value = ""; age.value = "";
      setTimeout(route, 2500);
    } }, "Add to Daily Brief");
    return el("article", { class: "card kid" }, el("h2", { text: "Add a person" }),
      el("p", { class: "muted small", style: "margin:0", text: "Kids, your spouse or yourself. If the email already has an account (like a Test Prep Hub account), it's reused; otherwise they get an invitation email." }),
      el("div", { class: "addform" }, name, email, age), hint, el("div", { class: "actions" }, btn), msg);
  }

  function kidView(k) {
    const st = k.stats || {}, pr = k.profile || {}, rep = (k.reports || [])[0];
    const days = st.days || [];
    const max = Math.max(10, ...days.map((d) => d.pts));
    const card = el("article", { class: "card kid" },
      el("div", { class: "row", style: "display:flex;justify-content:space-between;align-items:baseline;gap:10px" },
        el("h2", { text: k.name + (k.self ? " (you)" : "") }), el("span", { class: "muted small", text: who(k) + (k.notify ? " · 🔔 on" : " · 🔕 notifications off") })),
      el("div", { class: "stats" },
        el("div", { class: "stat" + (st.streak ? " hot" : "") }, el("b", { text: (st.streak || 0) + "🔥" }), el("span", { text: "day streak" })),
        el("div", { class: "stat" }, el("b", { text: st.week || 0 }), el("span", { text: "points this week" })),
        el("div", { class: "stat" }, el("b", { text: st.total || 0 }), el("span", { text: "all-time points" }))),
      el("div", {}, el("div", { class: "eyebrow", text: "Last 14 days (points)" }),
        el("div", { class: "spark", role: "img", "aria-label": "Daily points for the last 14 days" }, days.map((d) => el("i", { class: d.pts ? "" : "zero", title: d.d + ": " + d.pts + " pts, " + d.read + " read", style: "height:" + Math.max(3, Math.round((64 * d.pts) / max)) + "px" }))),
        el("div", { class: "sparkl" }, el("span", { text: days[0] ? prettyDate(days[0].d, { weekday: undefined, month: "short" }) : "" }), el("span", { text: "today" }))),
      (() => { const wk = days.slice(-7).filter((d) => d.mins > 0); if (!wk.length) return null;
        const avg = wk.reduce((t, d) => t + d.mins, 0) / wk.length;
        return el("p", { class: "small", style: "margin:0" }, "⏱ ", el("b", { text: avg.toFixed(1) + " min" }), " a day on average this week (" + wk.length + " day" + (wk.length === 1 ? "" : "s") + " active). Open See his answers for breaks and seconds per card."); })());
    if (rep) {
      card.append(el("div", {}, el("div", { class: "eyebrow", text: "Latest evaluation · " + prettyDate(rep.date, { weekday: "short", month: "short" }) }), el("div", { class: "report", text: rep.summary })));
      if (rep.knowledge) card.append(el("div", {}, el("div", { class: "eyebrow", text: "What his answers show about his knowledge" }), el("div", { class: "report", text: rep.knowledge })));
      if (rep.plan) card.append(el("div", { class: "plan" }, el("div", { class: "eyebrow", text: "Plan forward" }), el("div", { class: "report", text: rep.plan })));
      const cats = rep.metrics && rep.metrics.accuracy_by_category;
      if (cats && Object.keys(cats).length) {
        const bars = el("div", { class: "catbars" });
        for (const [cat, v] of Object.entries(cats)) {
          if (v == null) continue;
          const pct = Math.round(v * 100);
          bars.append(el("div", { class: "catbar" }, el("span", { text: CAT[cat] || cat }), el("span", { class: "t" }, el("i", { style: "width:" + pct + "%;background:var(--" + (CAT[cat] ? cat : "signal") + ")" })), el("span", { class: "num", text: pct + "%" })));
        }
        card.append(el("div", {}, el("div", { class: "eyebrow", text: "Quick-check accuracy (last 7 days)" }), bars));
      }
    } else card.append(el("p", { class: "muted small", text: "The first evaluation appears the morning after the first brief is used." }));
    const pills = (arr, cls) => el("div", { class: "pills" }, (arr || []).map((t) => el("span", { class: "pill " + (cls || ""), text: t })));
    if (pr.strengths || pr.gaps || pr.interests) {
      card.append(el("div", { style: "display:grid;gap:8px" },
        pr.strengths && pr.strengths.length ? el("div", {}, el("div", { class: "eyebrow", text: "Showing strength in" }), pills(pr.strengths, "good")) : null,
        pr.gaps && pr.gaps.length ? el("div", {}, el("div", { class: "eyebrow", text: "Building up" }), pills(pr.gaps, "warn")) : null,
        pr.interests && pr.interests.length ? el("div", {}, el("div", { class: "eyebrow", text: "Drawn to" }), pills(pr.interests)) : null,
        pr.direction ? el("p", { class: "small", style: "margin:0" }, el("b", { text: "Trend: " }), pr.direction) : null));
    }
    const ops = k.opinions || [];
    const missions = k.missions || [];
    if (missions.length || k.reflections_14d) {
      const lbl = ["Not yet", "Partly", "Did it"];
      const tried = missions.filter((m) => m.result > 0).length;
      const det = el("details", {}, el("summary", { text: "Real-world missions: " + tried + " of " + missions.length + " tried" }));
      for (const m of missions) det.append(el("div", { class: "op" }, el("div", { class: "muted small", text: m.date + " · " + lbl[m.result] }), m.mission));
      det.append(el("p", { class: "muted small", text: "Reflections written in the last 14 days: " + (k.reflections_14d || 0) + ". Read them under See his answers." }));
      card.append(det);
    }
    const likes = k.likes || [];
    if (likes.length) {
      const up = likes.filter((x) => x.v > 0), down = likes.filter((x) => x.v < 0);
      card.append(el("details", {}, el("summary", { text: "What he liked: 👍 " + up.length + " · 👎 " + down.length }),
        up.length ? el("div", {}, el("div", { class: "eyebrow", text: "Liked" }), el("div", { class: "pills" }, up.slice(0, 12).map((x) => el("span", { class: "pill good", text: x.title })))) : null,
        down.length ? el("div", { style: "margin-top:8px" }, el("div", { class: "eyebrow", text: "Not for me" }), el("div", { class: "pills" }, down.slice(0, 12).map((x) => el("span", { class: "pill", text: x.title })))) : null));
    }
    card.append(goalsEditor(k), interestsEditor(k), personSettings(k));
    if (ops.length) {
      const det = el("details", {}, el("summary", { text: "Recent \"your take\" answers (" + ops.length + ")" }));
      for (const o of ops) det.append(el("div", { class: "op" }, el("div", { class: "muted small", text: o.date + (o.score != null ? " · reasoning " + o.score + "/3" : " · not scored yet") }), el("q", { text: o.answer })));
      card.append(det);
    }
    card.append(el("div", { class: "actions" }, el("button", { class: "btn primary", onclick: () => dayView(k, null) }, "See his answers"), el("button", { class: "btn", onclick: () => previewFeed(k) }, "Preview " + k.name + "'s brief"), el("button", { class: "btn ghost", onclick: () => route() }, "Refresh")));
    if (rep && (k.reports || []).length > 1) {
      const det = el("details", {}, el("summary", { text: "Earlier evaluations" }));
      for (const r of k.reports.slice(1)) det.append(el("div", { class: "op" }, el("div", { class: "muted small", text: prettyDate(r.date, { weekday: "short", month: "short" }) }), el("div", { class: "report", text: r.summary })));
      card.append(det);
    }
    return card;
  }

  // Editable list (growth goals, interests) saved through an admin-only function.
  function listEditor(k, o) {
    let items = (k[o.field] || []).slice();
    const list = el("ol", { class: "goals" });
    const msg = el("span", { class: "muted small", role: "status" });
    const save = el("button", { class: "btn primary", disabled: true, onclick: async () => {
      save.disabled = true; msg.textContent = "Saving…";
      const { error } = await sb.rpc(o.rpc, Object.assign({ p_user: k.user_id }, { [o.arg]: items }));
      msg.textContent = error ? friendly(error) : "Saved. Tomorrow's brief will use these.";
      if (!error) k[o.field] = items.slice();
    } }, "Save " + o.noun + "s");
    const dirty = () => { save.disabled = JSON.stringify(items) === JSON.stringify(k[o.field] || []); msg.textContent = save.disabled ? "" : "Unsaved changes"; };
    function paint() {
      list.replaceChildren(...items.map((g, i) => el("li", {}, el("span", { text: g }),
        el("button", { class: "linkbtn", "aria-label": "Remove " + o.noun + ": " + g, onclick: () => { items.splice(i, 1); paint(); dirty(); } }, "Remove"))));
    }
    const input = el("input", { type: "text", maxlength: "200", placeholder: o.placeholder, "aria-label": "New " + o.noun });
    const add = () => { const v = input.value.trim(); if (!v || items.length >= o.max) return; items.push(v); input.value = ""; paint(); dirty(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    paint();
    return el("details", { class: "goalsbox" }, el("summary", { text: o.title + " (" + items.length + ")" }),
      el("p", { class: "muted small", text: o.desc }),
      list, el("div", { class: "addgoal" }, input, el("button", { class: "btn", onclick: add }, "Add")), el("div", { class: "actions" }, save, msg));
  }
  const goalsEditor = (k) => listEditor(k, { field: "goals", rpc: "brief_admin_set_goals", arg: "p_goals", noun: "goal", max: 20, title: "Growth goals",
    placeholder: "e.g. Handling disagreements calmly", desc: "What you want " + k.name + " to grow in. Every morning's brief is built around these. Add or remove any time." });
  const interestsEditor = (k) => listEditor(k, { field: "interests", rpc: "brief_admin_set_interests", arg: "p_items", noun: "interest", max: 30, title: "Interests",
    placeholder: "e.g. Formula 1, cooking, Minecraft", desc: "What " + k.name + " is into. Used as hooks and examples (about 30% of each brief), never to replace the core topics." });

  /* Parent: how long the day's brief took, breaks and distractions, and seconds per card. */
  function timingView(data) {
    const evs = data.events || [], target = (data.feed.extras && data.feed.extras.target_minutes) || 10;
    const segs = evs.filter((e) => e.kind === "time").map((e) => { let a = {}; try { a = JSON.parse(e.answer || "{}"); } catch (x) { } return { ms: e.ms || 0, why: a.why, start: a.start ? Date.parse(a.start) : null }; });
    const active = segs.reduce((t, x) => t + x.ms, 0);
    const box = el("article", { class: "card kid timing" }, el("div", { class: "eyebrow", text: "⏱ Time and focus" }));
    if (!segs.length && !evs.some((e) => e.kind === "read")) { box.append(el("p", { class: "muted small", style: "margin:0", text: "Not started." })); return box; }
    const starts = segs.filter((x) => x.start).map((x) => x.start), ends = segs.filter((x) => x.start).map((x) => x.start + x.ms);
    const span = starts.length ? Math.max(...ends) - Math.min(...starts) : 0;
    const count = (w) => segs.filter((x) => x.why === w).length;
    const tfmt = (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
    const over = active / 60000 - target;
    box.append(el("div", { class: "finstats" },
      el("div", {}, el("b", { text: Math.round(active / 60000) + "m" }), el("span", { text: "active · target " + target })),
      el("div", {}, el("b", { text: count("pause") }), el("span", { text: "breaks taken" })),
      el("div", {}, el("b", { text: count("away") + count("idle") }), el("span", { text: "left app / idle" }))));
    const lines = [];
    if (starts.length) lines.push("Started " + tfmt(Math.min(...starts)) + ", last active " + tfmt(Math.max(...ends)) + " (" + Math.round(span / 60000) + " min from start to finish" + (span > active * 1.5 && span - active > 5 * 60000 ? ", so about " + Math.round((span - active) / 60000) + " min were breaks or time away" : "") + ").");
    if (over > 2) lines.push("Took " + Math.round(over) + " min longer than the target.");
    else if (active && over < -4) lines.push("Finished well under the target.");
    if (lines.length) box.append(el("p", { class: "small", style: "margin:0", text: lines.join(" ") }));
    const reads = {}; for (const e of evs) if (e.kind === "read") reads[e.card] = e.ms || 0;
    const rows = data.feed.cards.map((c) => ({ c, ms: reads[c.id] }));
    const maxMs = Math.max(60000, ...rows.map((r) => r.ms || 0));
    const list = el("div", { class: "cardtimes" });
    for (const r of rows) {
      const sec = r.ms != null ? Math.round(r.ms / 1000) : null;
      const long = r.c.type === "news" || r.c.type === "basics";
      const flag = sec == null ? "not read" : sec < (long ? 15 : 8) ? "very fast: skimmed?" : sec > 180 ? "long: stuck or distracted?" : "";
      list.append(el("div", { class: "ct" + (flag && sec != null ? " flag" : "") }, el("span", { class: "nm", text: r.c.title }),
        el("span", { class: "t" }, el("i", { style: "width:" + (sec == null ? 0 : Math.max(2, Math.round((100 * r.ms) / maxMs))) + "%" })),
        el("span", { class: "num s", text: sec == null ? "–" : sec + "s" }), flag ? el("span", { class: "fl", text: flag }) : null));
    }
    box.append(el("details", {}, el("summary", { text: "Seconds per card" }), list));
    return box;
  }

  /* Parent: one day of answers with the next morning's evaluation. */
  async function dayView(k, date) {
    const { data, error } = await sb.rpc("brief_admin_day", { p_user: k.user_id, p_date: date || localDate() });
    if (error) return toast(friendly(error));
    const days = data.days || [];
    if (!date && !data.feed && days.length) return dayView(k, days[0]);
    const d = data.date, i = days.indexOf(d);
    const ev = {}; for (const e of data.events || []) ev[e.card + ":" + e.kind] = e;
    const notes = {}; for (const n of (data.report && data.report.notes) || []) notes[n.card_id] = n.note;
    const back = el("button", { class: "btn ghost", onclick: () => route() }, "← Back");
    const nav = el("div", { class: "daynav" },
      el("button", { class: "btn ghost", disabled: i < 0 || i >= days.length - 1, onclick: () => dayView(k, days[i + 1]) }, "‹ Earlier"),
      el("strong", { text: prettyDate(d, { weekday: "short", month: "short" }) }),
      el("button", { class: "btn ghost", disabled: i <= 0, onclick: () => dayView(k, days[i - 1]) }, "Later ›"));
    const nodes = [el("div", { class: "row", style: "display:flex;justify-content:space-between;align-items:center;margin-top:6px" }, back), el("section", { class: "hero" }, el("h1", { text: k.name + "'s answers" })), nav,
      data.feed ? timingView(data) : null];
    const r = data.report;
    if (r) {
      nodes.push(el("article", { class: "card kid" }, el("div", { class: "eyebrow", text: "Coach's evaluation (written " + prettyDate(r.date, { weekday: "short", month: "short" }) + ")" }),
        el("div", { class: "report", text: r.summary }),
        r.knowledge ? el("div", {}, el("div", { class: "eyebrow", text: "What his answers show about his knowledge" }), el("div", { class: "report", text: r.knowledge })) : null,
        r.plan ? el("div", { class: "plan" }, el("div", { class: "eyebrow", text: "Plan forward" }), el("div", { class: "report", text: r.plan })) : null));
    } else nodes.push(el("div", { class: "stale", text: data.feed ? "The evaluation of this day appears the next morning after 5:40 a.m." : "No brief on this day." }));
    const fbl = data.feed && data.feed.extras && data.feed.extras.feedback;
    if (Array.isArray(fbl) && fbl.length) nodes.push(el("details", { class: "card kid fbgiven" },
      el("summary", {}, el("b", { text: "📝 Feedback he got this morning" }), el("span", { class: "muted small", text: " · " + fbl.filter((f, i) => ev[fbId(f, i) + ":feedback"]).length + " of " + fbl.length + " read · " + fbl.reduce((t, f) => t + ((f.fixes || []).length), 0) + " fact fixes" })),
      fbl.map((f, i) => el("div", { class: "note" }, el("b", { text: (FBK[f.kind] || "📝") + (f.title ? " · " + f.title : "") + (ev[fbId(f, i) + ":feedback"] ? " ✓" : "") }),
        f.good ? el("div", { class: "small", text: "Worked: " + f.good }) : null,
        (f.fixes || []).map((x) => el("div", { class: "small", text: "Fact fix: " + (x.said ? "\u201c" + x.said + "\u201d → " : "") + (x.actually || "") })),
        f.next ? el("div", { class: "small", text: "Next: " + f.next }) : null))));
    if (data.feed) {
      const m = data.feed.extras && data.feed.extras.mission_checkin, me = ev["mission:mission"];
      if (m) nodes.push(el("div", { class: "card ans" }, el("div", { class: "eyebrow", text: "Mission check-in" }), el("div", { text: m.text }), el("div", { class: "his " + (me ? "" : "none"), text: me ? ["Not yet", "Partly", "Did it"][me.choice] : "No answer" })));
      for (const c of data.feed.cards) {
        const box = el("div", { class: "card ans" }, el("div", { class: "meta" }, tagFor(c)), el("h3", { text: c.title }));
        const rd = ev[c.id + ":read"];
        box.append(el("div", { class: "muted small", text: rd ? "Read in " + Math.round((rd.ms || 0) / 1000) + " s" : "Not read" }));
        if (c.check) {
          const ce = ev[c.id + ":check"];
          box.append(el("div", { class: "aq", text: c.check.q }));
          if (!ce) box.append(el("div", { class: "his none", text: "Skipped the check" }));
          else {
            box.append(el("div", { class: "his " + (ce.correct ? "right" : "wrong"), text: (ce.correct ? "✓ " : "✗ ") + c.check.o[ce.choice] }));
            if (!ce.correct) box.append(el("div", { class: "muted small", text: "Right answer: " + c.check.o[c.check.a] }));
          }
        }
        const op = ev[c.id + ":opinion"];
        if (c.talk) box.append(el("div", { class: "aq", text: "💬 " + c.talk }), op ? el("div", { class: "his text" }, el("q", { text: op.answer }), el("span", { class: "muted small", text: op.score != null ? " · reasoning " + op.score + "/3" : " · not scored yet" })) : el("div", { class: "his none", text: "No take written" }));
        const rf = ev[c.id + ":reflect"];
        if (c.reflect) box.append(el("div", { class: "aq", text: "🪞 " + c.reflect }), rf ? el("div", { class: "his text" }, el("q", { text: rf.answer })) : el("div", { class: "his none", text: "No reflection written" }));
        if (c.speak) box.append(el("div", { class: "aq", text: "🎤 " + c.speak }), ev[c.id + ":speak"] ? el("div", { class: "his text" }, el("q", { text: ev[c.id + ":speak"].answer }), el("span", { class: "muted small", text: " · " + Math.round((ev[c.id + ":speak"].ms || 0) / 1000) + " s" + (ev[c.id + ":speak"].score != null ? " · " + ev[c.id + ":speak"].score + "/3" : "") })) : el("div", { class: "his none", text: "Didn't do the speaking challenge" }));
        if (c.curious) box.append(el("div", { class: "aq", text: "❓ " + c.curious }), ev[c.id + ":question"] ? el("div", { class: "his text" }, el("q", { text: ev[c.id + ":question"].answer }), el("span", { class: "muted small", text: ev[c.id + ":question"].score != null ? " · " + ev[c.id + ":question"].score + "/3" : "" })) : el("div", { class: "his none", text: "No question written" }));
        if (ev[c.id + ":confused"]) box.append(el("div", { class: "his wrong", text: "🤔 Tapped \"I don't get it\"" }));
        if (ev[c.id + ":ask"]) box.append(el("div", { class: "his text" }, el("span", { class: "muted small", text: "His question: " }), el("q", { text: ev[c.id + ":ask"].answer })));
        if (c.mission) box.append(el("div", { class: "muted small", text: "🎯 Mission: " + c.mission }));
        if (notes[c.id]) box.append(el("div", { class: "note" }, el("b", { text: "Coach: " }), notes[c.id]));
        nodes.push(box);
      }
      const qz = data.feed.quiz || [];
      if (qz.length) {
        const box = el("div", { class: "card ans" }, el("div", { class: "eyebrow", text: "Recall quiz" }));
        for (const q of qz) {
          const qe = ev[q.id + ":recall"];
          box.append(el("div", { class: "aq", text: q.q }), qe ? el("div", { class: "his " + (qe.correct ? "right" : "wrong"), text: (qe.correct ? "✓ " : "✗ ") + q.o[qe.choice] + (qe.correct ? "" : " (right: " + q.o[q.a] + ")") }) : el("div", { class: "his none", text: "Not answered" }));
          if (notes[q.id]) box.append(el("div", { class: "note" }, el("b", { text: "Coach: " }), notes[q.id]));
        }
        nodes.push(box);
      }
    }
    $app.replaceChildren(...nodes.filter((x) => x != null));
    window.scrollTo(0, 0);
  }

  async function previewFeed(k) {
    const { data, error } = await sb.rpc("brief_admin_feed", { p_user: k.user_id, p_date: localDate() });
    if (error) return toast(friendly(error));
    if (!data) return toast("No brief written yet");
    S.feed = data; S.preview = k; S.events = new Map(); S.stats = k.stats || { total: 0, week: 0, today: 0, streak: 0 }; S.note = null; S.view = "home";
    S.me = Object.assign({}, S.me, { learner: { name: k.name } });
    paintLearner();
    window.scrollTo(0, 0);
  }

  /* ---------- settings sheet: notifications + account ---------- */
  const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let swReg = null;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then((r) => (swReg = r)).catch(() => {});
  const b64u = (str) => { const pad = "=".repeat((4 - (str.length % 4)) % 4); const bin = atob((str + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

  function closeSheet() { $sheet.hidden = true; $sheet.textContent = ""; }
  $sheet.addEventListener("click", (e) => { if (e.target === $sheet) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$sheet.hidden) closeSheet(); });

  async function openSettings() {
    const panel = el("div", { class: "panel", role: "dialog", "aria-modal": "true", "aria-label": "Settings" },
      el("header", {}, el("strong", { text: "Settings" }), el("button", { class: "iconbtn", "aria-label": "Close", onclick: closeSheet }, "✕")));
    $sheet.replaceChildren(panel); $sheet.hidden = false;
    const isLearner = S.me && S.me.learner && S.me.learner.active && !S.preview;
    if (isLearner) panel.append(await notifySection());
    if (S.me && S.me.admin && !S.parentMode) panel.append(el("button", { class: "btn", onclick: () => { closeSheet(); S.parentMode = true; S.view = "home"; route(); } }, "👨‍👩‍👧 Parent view"));
    panel.append(el("div", { style: "display:grid;gap:8px" }, el("div", { class: "eyebrow", text: "Account" }), el("p", { class: "small", style: "margin:0", text: "Signed in as " + (S.user && S.user.email) }), el("button", { class: "btn ghost", onclick: signOut }, "Sign out")));
  }
  $menu.addEventListener("click", openSettings);

  function iosSteps() {
    return el("ol", { class: "steps" },
      el("li", {}, "Open this page in ", el("b", { text: "Safari" }), " (iOS 16.4 or later)."),
      el("li", {}, "Tap ", el("b", { text: "Share" }), " (square with an arrow; on newer iPhones it may be under ", el("b", { text: "⋯" }), ")."),
      el("li", {}, "Tap ", el("b", { text: "Add to Home Screen" }), ", then ", el("b", { text: "Add" }), "."),
      el("li", {}, "Open ", el("b", { text: "Daily Brief" }), " from the new icon and sign in once."),
      el("li", {}, "Tap ☰ → ", el("b", { text: "Turn on daily brief" }), " → ", el("b", { text: "Allow" }), "."));
  }

  async function notifySection() {
    const box = el("div", { style: "display:grid;gap:10px" }, el("div", { class: "eyebrow", text: "Daily notification" }));
    const msg = el("p", { class: "muted small", role: "status", style: "margin:0" });
    if (isIOS && !standalone) { box.append(el("p", { style: "margin:0", text: "On iPhone, notifications work once Daily Brief is on your Home Screen:" }), iosSteps()); return box; }
    if (!pushOK) { box.append(el("p", { style: "margin:0", text: "This browser can't show notifications. On iPhone, add Daily Brief to your Home Screen first:" }), iosSteps()); return box; }
    if (Notification.permission === "denied") { box.append(el("p", { style: "margin:0", text: "Notifications are blocked. On iPhone: Settings → Notifications → Daily Brief → Allow Notifications. Then come back here." })); return box; }
    const reg = swReg || (await navigator.serviceWorker.getRegistration());
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    let row = null;
    if (sub) { const { data } = await sb.from("brief_push_subscriptions").select("id, remind_hour, enabled").eq("endpoint", sub.endpoint).maybeSingle(); row = data; }
    const sel = el("select", { id: "rh", "aria-label": "Notification time" }, [6, 7, 8, 15, 16, 17, 18, 19].map((h) => el("option", { value: String(h), text: hourLabel(h) })));
    sel.value = String(row ? row.remind_hour : 7);
    box.append(el("p", { class: "small", style: "margin:0", text: "One notification a day when your brief is ready. It won't nag once you've read it." }), el("label", { class: "f", for: "rh" }, "Send it at", sel));
    if (row && row.enabled) {
      sel.addEventListener("change", async () => {
        const { error } = await sb.from("brief_push_subscriptions").update({ remind_hour: +sel.value, tz: tz() }).eq("id", row.id);
        msg.textContent = error ? friendly(error) : "Saved: " + hourLabel(+sel.value) + ".";
      });
      box.append(el("div", {}, el("span", { class: "chip good", text: "On for this phone" })),
        el("div", { class: "actions" },
          el("button", { class: "btn", onclick: async () => { msg.textContent = "Sending…"; const { error } = await sb.functions.invoke("brief-push", { body: { mode: "test" } }); msg.textContent = error ? "Couldn't send a test. Try again in a minute." : "Sent. It should appear in a few seconds."; } }, "Send a test"),
          el("button", { class: "btn ghost", onclick: async () => { try { await sub.unsubscribe(); } catch (e) { } await sb.from("brief_push_subscriptions").delete().eq("id", row.id); toast("Notifications off"); openSettings(); } }, "Turn off")),
        msg);
    } else {
      const on = el("button", { class: "btn signal block", onclick: async () => {
        on.disabled = true; msg.textContent = "Asking for permission…";
        try {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") { msg.textContent = "Notifications weren't allowed."; on.disabled = false; return; }
          const r = swReg || (await navigator.serviceWorker.register("sw.js"));
          await navigator.serviceWorker.ready;
          const s = (await r.pushManager.getSubscription()) || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(APP_KEY) }));
          const j = s.toJSON();
          const { error } = await sb.from("brief_push_subscriptions").upsert({ user_id: S.user.id, endpoint: s.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, tz: tz(), remind_hour: +sel.value, enabled: true }, { onConflict: "endpoint" });
          if (error) throw error;
          toast("Daily brief notifications on", true);
          sb.functions.invoke("brief-push", { body: { mode: "test" } });
          openSettings();
        } catch (e) { msg.textContent = "Couldn't turn on: " + friendly(e); on.disabled = false; }
      } }, "Turn on daily brief");
      box.append(on, msg);
    }
    return box;
  }

  // Coming back after a while (e.g. from a notification) refreshes the brief; a quick trip to a source link doesn't.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); if (T.since) { clearInterval(T.iv); T.iv = null; timerFlush(null, "away"); T.autoPaused = true; } return; }
    if (T.autoPaused && S.view === "deck") { T.autoPaused = false; timerStart(); }
    if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000 && S.user && S.me && S.me.learner && !S.preview && $sheet.hidden) { S.view = "home"; route(); }
  });
  window.__brief = { S, sb, route };
  route();
})();
