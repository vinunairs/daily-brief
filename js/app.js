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
  const PTS = { readLong: 3, readShort: 1, right: 8, wrong: 2, opinion: 5, reflect: 5, recallRight: 10, recallWrong: 2, complete: 20, mission: [2, 6, 10], confused: 1, ask: 3, speak: 6, question: 4, feedback: 2, funRight: 5, funTry: 1, gameEach: 2, gameDone: 5 };
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
  // Cards in order, with interest bonus rounds (extras.bonus[].after = card id) and the daily mini-game (extras.game.after) slotted in.
  function deckItems() {
    const x = S.feed.extras || {}, cards = S.feed.cards, last = cards.length ? cards[cards.length - 1].id : null;
    const fun = Array.isArray(x.bonus) ? x.bonus.filter((f) => f && f.id) : [];
    const game = x.game && Array.isArray(x.game.items) && x.game.items.length ? x.game : null;
    const gameAfter = game ? (cards.some((c) => c.id === game.after) ? game.after : cards[Math.max(0, Math.floor(cards.length / 2) - 1)].id) : null;
    const out = [];
    cards.forEach((c, i) => {
      out.push({ t: "card", c, n: i + 1 });
      if (c.id === last) return;
      for (const f of fun) if (f.after === c.id) out.push({ t: "fun", f });
      if (game && gameAfter === c.id) out.push({ t: "game", g: game });
    });
    if (S.feed.quiz && S.feed.quiz.length) out.push({ t: "quiz" });
    out.push({ t: "finish" });
    return out;
  }
  const allDone = () => readCount() >= S.feed.cards.length && (S.feed.quiz || []).every((q) => has(q.id, "recall"));

  function paintLearner(keepScroll) {
    document.body.classList.toggle("in-deck", S.view === "deck");
    if (S.view === "deck" && S.feed) return paintDeck(keepScroll);
    if (S.view === "review" && S.feed) return paintReview();
    if (S.view === "progress") return paintProgress();
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

  /* ---------- 📈 My progress ---------- */
  function tabsNav(cur) {
    const t = (id, label) => el("button", { class: "tab" + (cur === id ? " on" : ""), "aria-pressed": String(cur === id), onclick: () => { if (cur === id) return; S.view = id; paintLearner(); window.scrollTo(0, 0); } }, label);
    return el("nav", { class: "tabs", "aria-label": "Sections" }, t("home", "🏠 Today"), t("progress", "📈 My progress"));
  }
  const TOPIC = { finance: "💰 Money", tech: "💻 Tech", health: "🩺 Health", science: "🔬 Science", climate: "🌎 Climate", world: "🌐 World", civics: "🏛️ Government", culture: "🎬 Culture", local: "🌴 Tampa Bay", basics: "📚 Foundations", reasoning: "🧩 Reasoning", street: "🛡️ Street smarts", skills: "🌱 Life skills" };
  const lvlFromAcc = (r, n) => (!n ? 0 : n < 3 ? 1 : r / n >= 0.9 ? 5 : r / n >= 0.75 ? 4 : r / n >= 0.6 ? 3 : r / n >= 0.4 ? 2 : 1);
  const lvlFromScore = (arr) => (!arr.length ? 0 : Math.min(5, 1 + Math.floor((arr.reduce((t, x) => t + x, 0) / arr.length / 3) * 4 + 1e-9)));
  async function paintProgress() {
    $app.replaceChildren(tabsNav("progress"), el("div", { class: "loading" }, el("span"), "Loading your progress…"));
    const { data: P, error } = await sb.rpc("brief_my_progress");
    if (S.view !== "progress") return;
    if (error || !P) { $app.replaceChildren(tabsNav("progress"), el("div", { class: "card pad", text: error ? friendly(error) : "Your progress shows up after your first brief." })); return; }
    const tp = {}; for (const t of P.topics || []) tp[t.topic] = t;
    const sum = (keys, f) => keys.reduce((a, k) => a + ((tp[k] || {})[f] || 0), 0);
    const NEWS = ["finance", "tech", "health", "science", "climate", "world", "civics", "culture", "local", "basics"];
    const c = P.counts || {}, sc = P.scores || [], kid = P.kid || {}, ks = kid.skills || {};
    const scoresOf = (k) => sc.filter((x) => x.kind === k).map((x) => Number(x.score));
    const newsR = sum(NEWS, "right") + sum(NEWS, "right_prev") + (c.recall_right || 0), newsN = sum(NEWS, "n") + sum(NEWS, "n_prev") + (c.recall_n || 0);
    const reaR = sum(["reasoning"], "right") + sum(["reasoning"], "right_prev"), reaN = sum(["reasoning"], "n") + sum(["reasoning"], "n_prev");
    const stR = sum(["street"], "right") + sum(["street"], "right_prev") + (c.realfake_right || 0), stN = sum(["street"], "n") + sum(["street"], "n_prev") + (c.realfake_n || 0);
    const md = c.missions_did || 0;
    const skills = [
      ["news", "📰", "News knowledge", lvlFromAcc(newsR, newsN), newsN ? newsR + " of " + newsN + " right (checks + recall)" : "Answer quick checks to level up"],
      ["reasoning", "🧩", "Reasoning", lvlFromAcc(reaR, reaN), reaN ? reaR + " of " + reaN + " puzzles right" : "Solve puzzles to level up"],
      ["street", "🛡️", "Street smarts", lvlFromAcc(stR, stN), stN ? stR + " of " + stN + " right (scams, fakes, fine print)" : "Street-smart cards and Real-or-fake level this up"],
      ["explain", "💬", "Explaining your thinking", lvlFromScore(scoresOf("opinion")), scoresOf("opinion").length ? "Average take: " + (scoresOf("opinion").reduce((t, x) => t + x, 0) / scoresOf("opinion").length).toFixed(1) + " / 3" : "Write takes to level up"],
      ["questions", "❓", "Asking good questions", lvlFromScore(scoresOf("question")), scoresOf("question").length ? "Average question: " + (scoresOf("question").reduce((t, x) => t + x, 0) / scoresOf("question").length).toFixed(1) + " / 3" : "Try the question challenge"],
      ["speaking", "🎤", "Speaking", lvlFromScore(scoresOf("speak")), scoresOf("speak").length ? "Average spoken answer: " + (scoresOf("speak").reduce((t, x) => t + x, 0) / scoresOf("speak").length).toFixed(1) + " / 3" : "Try 'Say it out loud'"],
      ["conversation", "🗣️", "Conversation confidence", md ? Math.min(5, 1 + Math.ceil(md / 2)) : 0, md ? md + " mission" + (md > 1 ? "s" : "") + " done" : "Do a conversation mission to level up"]]
      .map(([k, i, n, l, sub]) => [k, i, n, Number(ks[k]) >= 1 && Number(ks[k]) <= 5 ? Number(ks[k]) : l, sub]);
    const nodes = [tabsNav("progress"), el("section", { class: "hero2 slim prog" }, el("div", { class: "date", text: "Last 2 weeks" }), el("h1", { text: "Your progress" }),
      el("p", { class: "muted small", style: "margin:0", text: "You're only compared with you. Every level goes up with practice." }))];
    // You're great at / Level up next (written by the coach; falls back to the skill map)
    const tried = skills.filter((x) => x[3] > 0).sort((a, b) => b[3] - a[3]);
    const great = (Array.isArray(kid.great) && kid.great.length ? kid.great : tried.slice(0, 2).filter((x) => x[3] >= 3).map((x) => x[2] + " (level " + x[3] + ")")).slice(0, 3);
    const next = (Array.isArray(kid.next) && kid.next.length ? kid.next : skills.filter((x) => x[3] < 3).slice(0, 2).map((x) => x[2] + ": " + x[4])).slice(0, 3);
    nodes.push(el("div", { class: "gn" },
      el("div", { class: "gcol good" }, el("b", { text: "⭐ You're great at" }), great.length ? el("ul", {}, great.map((t) => el("li", { text: t }))) : el("p", { class: "muted small", text: "Keep going. Your strengths show up after a few days." })),
      el("div", { class: "gcol next" }, el("b", { text: "🚀 Level up next" }), next.length ? el("ul", {}, next.map((t) => el("li", { text: t }))) : el("p", { class: "muted small", text: "Everything's leveling up nicely." }))));
    // Skill map
    nodes.push(el("section", { class: "card pad skillmap" }, el("div", { class: "eyebrow", text: "Skill map" }),
      skills.map(([k, ico, name, lv, sub]) => el("div", { class: "sk", title: sub },
        el("span", { class: "ski", text: ico }), el("span", { class: "skn" }, el("b", { text: name }), el("span", { class: "muted small", text: sub })),
        el("span", { class: "pips", role: "img", "aria-label": name + ": level " + (lv || 0) + " of 5" }, [1, 2, 3, 4, 5].map((i) => el("i", { class: i <= lv ? "on" : "" }))),
        el("span", { class: "lvn num", text: lv ? "Lv " + lv : "–" })))));
    // Topic accuracy this week (bars), with change vs the week before
    const topics = (P.topics || []).filter((t) => t.n > 0).sort((a, b) => b.right / b.n - a.right / a.n);
    if (topics.length) nodes.push(el("section", { class: "card pad" }, el("div", { class: "eyebrow", text: "Quick checks right, this week" }),
      el("div", { class: "hbars" }, topics.map((t) => {
        const pct = Math.round((100 * t.right) / t.n), prev = t.n_prev >= 2 ? Math.round((100 * t.right_prev) / t.n_prev) : null, d = prev == null ? null : pct - prev;
        return el("div", { class: "hb", title: (TOPIC[t.topic] || t.topic) + ": " + t.right + " of " + t.n + " right" + (prev != null ? " (last week " + prev + "%)" : "") },
          el("span", { class: "hbl", text: TOPIC[t.topic] || t.topic }), el("span", { class: "hbt" }, el("i", { style: "width:" + Math.max(pct, 3) + "%" })),
          el("span", { class: "hbv num", text: pct + "%" }), el("span", { class: "hbd small" + (d > 0 ? " up" : ""), text: d == null ? "" : d > 0 ? "▲" + d : d < 0 ? "▼" + -d : "=" }));
      })), el("p", { class: "muted small", style: "margin:6px 0 0", text: "▲ shows how much you went up since last week." })));
    // Written answers: average score per day (0–3)
    const byDay = {}; for (const x of sc) (byDay[x.d] = byDay[x.d] || []).push(Number(x.score));
    const wd = Object.keys(byDay).sort().slice(-10);
    if (wd.length) nodes.push(el("section", { class: "card pad" }, el("div", { class: "eyebrow", text: "Your written and spoken answers (score out of 3)" }),
      cols(wd.map((d) => ({ d, v: byDay[d].reduce((t, x) => t + x, 0) / byDay[d].length, tip: prettyDate(d, { weekday: "short", month: "short" }) + ": " + (byDay[d].reduce((t, x) => t + x, 0) / byDay[d].length).toFixed(1) + " / 3 over " + byDay[d].length + " answers" })), 3, (v) => v.toFixed(1))));
    // Minutes per day vs target
    const days = (P.days || []).filter((d) => d.mins != null).slice(-10);
    if (days.length) nodes.push(el("section", { class: "card pad" }, el("div", { class: "eyebrow", text: "Minutes per day (dashes = your target)" }),
      cols(days.map((d) => ({ d: d.d, v: Number(d.mins) || 0, t: Number(d.target) || null, tip: prettyDate(d.d, { weekday: "short", month: "short" }) + ": " + Math.round(d.mins) + " min" + (d.target ? " (target " + d.target + ")" : "") })),
        Math.max(15, ...days.map((d) => Math.max(Number(d.mins) || 0, Number(d.target) || 0))), (v) => Math.round(v) + "m")));
    // Badges
    const st = (S.stats && S.stats.streak) || 0;
    const B = [["🔥", "3-day streak", st >= 3, "Do the brief 3 days in a row"], ["🔥🔥", "7-day streak", st >= 7, "7 days in a row"], ["🏁", "First full brief", (c.days_done || 0) >= 1, "Finish every card in a brief"],
      ["🏅", "5 full briefs", (c.days_done || 0) >= 5, "Finish 5 briefs"], ["🎮", "Perfect game", (c.perfect_games || 0) >= 1, "Get every round right in a game"], ["🔎", "Fact checker", (c.feedback_read || 0) >= 5, "Read 5 feedback notes"],
      ["🎯", "Mission done", md >= 1, "Complete a conversation mission"], ["❓", "Curious mind", (c.questions || 0) >= 5, "Ask 5 questions"], ["🎤", "Speaker", (c.speaks || 0) >= 3, "Say 3 answers out loud"], ["🧠", "Memory master", (c.recall_right || 0) >= 5, "Get 5 recall questions right"]];
    const got = B.filter((b) => b[2]).length;
    nodes.push(el("section", { class: "card pad" }, el("div", { class: "eyebrow", text: "Badges · " + got + " of " + B.length }),
      el("div", { class: "badges" }, B.map(([i, n, ok, how]) => el("div", { class: "bdg" + (ok ? " on" : ""), title: ok ? n + ": earned!" : how }, el("span", { class: "bi", text: i }), el("b", { text: n }), el("span", { class: "muted small", text: ok ? "Earned!" : how }))))));
    $app.replaceChildren(...nodes);
  }
  // Simple column chart: one hue, value label on the latest column, optional per-column target tick.
  function cols(rows, max, fmtv) {
    const wrap = el("div", { class: "cols", role: "img", "aria-label": rows.map((r) => r.tip).join("; ") });
    rows.forEach((r, i) => wrap.append(el("div", { class: "col", title: r.tip },
      el("span", { class: "cv num", text: i === rows.length - 1 || rows.length <= 4 ? fmtv(r.v) : "" }),
      el("span", { class: "cbar" }, el("i", { style: "height:" + Math.max(2, Math.round((100 * r.v) / max)) + "%" }), r.t ? el("b", { class: "tgt", style: "bottom:" + Math.round((100 * r.t) / max) + "%" }) : null),
      el("span", { class: "cl", text: new Date(r.d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" }) }))));
    return wrap;
  }

  // ---- Home checklist helpers ----
  function itemDone(x) { return x.t === "card" ? has(x.c.id, "read") : x.t === "fun" ? has(x.f.id, "fun") : x.t === "game" ? has("game", "game") : x.t === "quiz" ? (S.feed.quiz || []).every((q) => has(q.id, "recall")) : true; }
  function briefProgress() {
    const items = deckItems().filter((x) => x.t !== "finish"), doneN = items.filter(itemDone).length, k = deckItems().findIndex((x) => x.t !== "finish" && !itemDone(x));
    const cards = S.feed.cards.length, fx = S.feed.extras || {}, nb = Array.isArray(fx.bonus) ? fx.bonus.length : 0, g = fx.game && fx.game.items && fx.game.items.length;
    const left = S.feed.cards.filter((c) => !has(c.id, "read")).length;
    const sub = (left ? left + " of " + cards + " cards to go" : cards + " cards read") + (nb ? " · " + nb + " bonus rounds" : "") + (g ? " · 🎮 game" : "") + ((S.feed.quiz || []).length ? " · quiz" : "") + " · ⏱ " + Math.round(targetMs() / 60000) + " min";
    return { total: items.length, doneN, done: allDone(), next: k < 0 || allDone() ? (k < 0 ? 0 : k) : k, sub };
  }
  function reviewState() {
    const fx = S.feed.extras || {}, fb = Array.isArray(fx.feedback) ? fx.feedback : [], m = fx.mission_checkin && fx.mission_checkin.text;
    const has_ = fb.length || m || (Array.isArray(fx.answers) && fx.answers.length) || (fx.week && (fx.week.win || fx.week.focus));
    const total = fb.length + (m ? 1 : 0), doneN = fb.filter((f, i) => has(fbId(f, i), "feedback")).length + (m && has("mission", "mission") ? 1 : 0);
    let seen = false; try { seen = localStorage.getItem("brief-review-seen-" + S.feed.feed_date) === "1"; } catch (e) { }
    const fixes = fb.reduce((t, f) => t + ((f.fixes || []).length), 0);
    const parts = []; if (fb.length) parts.push(fb.length + " feedback note" + (fb.length > 1 ? "s" : "")); if (fixes) parts.push(fixes + " fact fix" + (fixes > 1 ? "es" : "")); if (Array.isArray(fx.answers) && fx.answers.length) parts.push("answers to your questions"); if (m) parts.push("mission check-in"); if (fx.week && fx.week.win) parts.push("week in review");
    return { has: !!has_, total, doneN, done: total ? doneN === total : seen, sub: parts.join(" · ") + " · ~2 min" };
  }
  function stepRow(done, ico, title, sub, pct, onclick) {
    return el("button", { class: "step" + (done ? " done" : ""), onclick },
      el("span", { class: "num" }), el("span", { class: "sbody" }, el("span", { class: "st" }, ico + " " + title), el("span", { class: "ss", text: sub }),
        el("span", { class: "sbar" }, el("i", { style: "width:" + Math.round(100 * (pct || 0)) + "%" }))), el("span", { class: "arr", text: "→" }));
  }
  function openDeckAt(k) { k = Math.min(k, maxAllowed()); S.view = "deck"; S.painted = null; S.idx = Math.max(0, Math.min(k, deckItems().length - 1)); paintLearner(); window.scrollTo(0, 0); }
  function openReview() { S.view = "review"; try { localStorage.setItem("brief-review-seen-" + S.feed.feed_date, "1"); } catch (e) { } paintLearner(); window.scrollTo(0, 0); }
  function paintReview() {
    const back = () => { S.view = "home"; paintLearner(); window.scrollTo(0, 0); };
    const rv = reviewState(), bp = briefProgress();
    const nodes = [el("div", { class: "revtop" }, el("button", { class: "btn ghost", onclick: back }, "← Home"), el("b", { text: "📝 Review yesterday" }), el("span", { class: "muted small", text: rv.total ? rv.doneN + "/" + rv.total : "" })),
      S.note && S.note.note ? el("div", { class: "coach2" }, el("div", { class: "av", text: "🧭" }), el("div", {}, el("b", { text: "Coach" }), el("p", { text: S.note.note }))) : null,
      weekView(), feedbackView(), answersView(), missionView(),
      el("button", { class: "cta", onclick: () => openDeckAt(bp.next) }, el("span", { text: bp.done ? "Look back at today's brief" : "Next: today's brief" }), el("span", { class: "arr", text: "→" }))];
    $app.replaceChildren(...nodes.filter((x) => x != null));
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
    const bp = briefProgress(), rv = reviewState();
    nodes.push(el("section", { class: "hero2 slim" },
      el("div", { class: "date", text: prettyDate(today) }),
      el("h1", { text: greeting() + (name ? ", " + name : "") }),
      el("div", { class: "hudline" },
        el("span", { class: "flame" + (S.stats.streak > 0 ? " lit" : "") }, el("span", { class: "fl", text: "🔥" }), el("b", { text: S.stats.streak || 0 }), " day streak"),
        el("span", { class: "badge", text: "Lv " + lv.n + " · " + lv.name }),
        el("span", { class: "pts-pill", id: "ptsPill", text: (S.stats.today || 0) + " pts today" })),
      el("div", { class: "xp" }, el("i", { style: "width:" + lv.pct + "%" })),
      el("span", { class: "muted small", text: lv.next ? lv.toNext + " pts to " + lv.next : "Top level!" })));
    if (!S.preview) nodes.unshift(tabsNav("home"));
    if (S.feed.feed_date !== today && !S.preview) nodes.push(el("div", { class: "stale", text: "Today's brief isn't ready yet, so here's the latest one (" + prettyDate(S.feed.feed_date, { weekday: "short", month: "short" }) + ")." }));
    const steps = [];
    if (rv.has) steps.push(stepRow(rv.done, "📝", "Review yesterday", rv.done ? "All caught up · tap to look again" : rv.sub, rv.total ? rv.doneN / rv.total : 0, () => openReview()));
    else if (S.note && S.note.note) nodes.push(el("div", { class: "coach2" }, el("div", { class: "av", text: "🧭" }), el("div", {}, el("b", { text: "Coach" }), el("p", { text: S.note.note }))));
    steps.push(stepRow(bp.done, "📰", S.preview ? "Open the brief" : bp.done ? "Today's brief: done!" : bp.doneN ? "Continue today's brief" : "Today's brief",
      bp.done ? "Nice work · tap to look back" : bp.sub, bp.total ? bp.doneN / bp.total : 0, () => openDeckAt(S.preview ? 0 : bp.next)));
    nodes.push(el("section", { class: "steps" }, el("div", { class: "eyebrow", text: "Today's checklist" }), steps.map((x, i) => (x.querySelector(".num").textContent = x.classList.contains("done") ? "✓" : String(i + 1), x))));
    const days = (S.stats.days || []).slice(-7);
    if (days.length) nodes.push(el("div", { class: "week" }, el("div", { class: "eyebrow", text: "Your week" }), el("div", { class: "wk" }, days.map((d) => el("div", { class: "wd" + (d.read >= 6 ? " on" : d.pts ? " some" : "") + (d.d === today ? " today" : "") },
      el("i", {}), el("span", { text: new Date(d.d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" }) }))))));
    const lineup = el("details", { class: "lineup" }, el("summary", {}, "See today's cards (" + n + "/" + total + " read)"),
      el("div", { class: "tiles" }, S.feed.cards.map((c, i) => {
        const read = has(c.id, "read");
        return el("button", { class: "tile g-" + catOf(c) + (read ? " read" : ""), onclick: () => openDeck(i) },
          el("span", { class: "te", text: emojiOf(c) }), el("span", { class: "tk", text: (c.type === "news" || c.type === "basics") ? CAT[catOf(c)] : KIND[c.kind] || CAT[catOf(c)] }),
          el("span", { class: "tt", text: c.title }), read ? el("span", { class: "tick", text: "✓" }) : null,
          (S.events.get(evKey(c.id, "like")) || {}).choice > 0 ? el("span", { class: "heart", text: "💖" }) : null);
      })));
    nodes.push(lineup);
    if (S.preview) nodes.unshift(el("div", { class: "preview-banner" }, el("span", { text: "Preview of " + S.preview.name + "'s brief for " + prettyDate(S.feed.feed_date, { weekday: "short", month: "short" }) + ". Nothing is recorded." }), el("button", { class: "btn ghost", onclick: () => { S.preview = null; S.me.learner = null; route(); } }, "Back")));
    $app.replaceChildren(...nodes.filter((x) => x != null));
  }

  function openDeck(i) {
    const items = deckItems(), cards = S.feed.cards;
    let at = i >= cards.length ? items.findIndex((x) => x.t === "quiz") : items.findIndex((x) => x.t === "card" && x.c === cards[i]);
    if (at < 0) at = items.length - 1;
    if (at > maxAllowed()) { toast("Cards go in order. Picking up where you left off."); at = maxAllowed(); }
    S.view = "deck"; S.painted = null; S.idx = Math.max(0, Math.min(at, items.length - 1));
    paintLearner(); window.scrollTo(0, 0);
  }
  function closeDeck() { timerStop("close"); S.view = "home"; paintLearner(); window.scrollTo(0, 0); }

  let slideScroll = 0;
  function paintDeck(keepScroll) {
    const items = deckItems(), it = items[S.idx], total = S.feed.cards.length;
    const prevSlide = document.querySelector(".slide");
    if (keepScroll && prevSlide) slideScroll = prevSlide.scrollTop;
    const segs = el("div", { class: "segs" }, items.filter((x) => x.t !== "finish").map((x, i) => el("i", { class: (i === S.idx ? "cur " : "") + (x.t === "fun" || x.t === "game" ? "mini " : "") + ((x.t === "card" && has(x.c.id, "read")) || (x.t === "fun" && has(x.f.id, "fun")) || (x.t === "game" && has("game", "game")) || (x.t === "quiz" && (S.feed.quiz || []).every((q) => has(q.id, "recall"))) ? "done" : "") })));
    const top = el("div", { class: "deck-top" }, segs, el("div", { class: "deck-row" },
      el("button", { class: "iconbtn ghosty", "aria-label": "Close", onclick: closeDeck }, "✕"),
      el("span", { class: "pos", text: it.t === "card" ? it.n + " / " + total : it.t === "quiz" ? "Recall quiz" : it.t === "fun" ? "Bonus round" : it.t === "game" ? "Game time" : "Done" }),
      it.t !== "finish" && !S.preview ? el("button", { class: "timer", id: "timerPill", "aria-label": "Pause timer", onclick: () => timerPause(true) }, el("span", { class: "tt" }), el("span", { class: "pz", text: "❚❚" })) : null,
      el("span", { class: "pts-pill", id: "ptsPill", text: "⚡ " + (S.stats.today || 0) })));
    let slide;
    if (it.t === "card") slide = cardSlide(it.c);
    else if (it.t === "quiz") slide = quizSlide();
    else if (it.t === "fun") slide = funSlide(it.f);
    else if (it.t === "game") slide = gameSlide(it.g);
    else slide = finishSlide();
    const bar = el("div", { class: "deck-bar" });
    bar.append(el("button", { class: "nav", "aria-label": "Previous", disabled: S.idx === 0, onclick: () => go(-1) }, "‹"));
    if (it.t === "card") {
      const c = it.c, done = has(c.id, "read"), miss = S.preview ? [] : missingAnswers(c);
      if (S.preview || done) bar.append(el("button", { class: "btn signal grow", onclick: () => go(1) }, "Next →"));
      else if (!miss.length) bar.append(el("button", { class: "btn signal grow", onclick: () => markRead(c) }, "Done · next →"));
      else bar.append(el("button", { class: "btn grow needcheck", onclick: () => nudgeMissing(miss[0]) }, "Answer " + miss[0][0] + " ↑"));
    } else if (it.t === "quiz") {
      const qleft = (S.feed.quiz || []).filter((q) => !has(q.id, "recall")).length;
      if (strictOn() && qleft) bar.append(el("button", { class: "btn grow needcheck", onclick: () => toast("Answer all the recall questions to finish (" + qleft + " left).") }, "Answer the quiz to finish ↑"));
      else bar.append(el("button", { class: "btn signal grow", onclick: () => go(1) }, "Finish →"));
    } else if (it.t === "fun" || it.t === "game") {
      const fin = it.t === "fun" ? has(it.f.id, "fun") : has("game", "game");
      bar.append(el("button", { class: "btn grow" + (fin || S.preview ? " signal" : " ghost"), onclick: () => go(1) }, fin || S.preview ? "Next →" : "Skip →"));
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

  // Strict mode (set per person in the Parent view): every answer on a card is required, no jumping ahead, quiz must be finished.
  function strictOn() { return !!(S.me && S.me.learner && S.me.learner.strict) && !S.preview; }
  function missingAnswers(c) {
    const m = [];
    if (c.check && !has(c.id, "check")) m.push(["the quick check", ".slide .check", "Answer the quick check first. It shows you understood."]);
    if (!strictOn()) return m;
    if (c.talk && !has(c.id, "opinion")) m.push(["your take", ".slide .talk:not(.reflect)", "Write your take first: 1–2 sentences, with a reason."]);
    if (c.speak && !has(c.id, "speak")) m.push(["the speaking challenge", ".slide .speak", "Do the speaking challenge first (or type what you'd say)."]);
    if (c.curious && !has(c.id, "question")) m.push(["the question challenge", ".slide .curious", "Write your question first."]);
    if (c.reflect && !has(c.id, "reflect")) m.push(["the reflection", ".slide .reflect", "Answer the reflection question first."]);
    return m;
  }
  function nudgeMissing(m) {
    const box = document.querySelector(m[1]);
    if (box) { box.scrollIntoView({ behavior: "smooth", block: "center" }); box.classList.remove("nudge"); void box.offsetWidth; box.classList.add("nudge"); }
    toast(m[2]);
  }
  // Furthest deck position allowed in strict mode: nothing past the first unread card (or the quiz once all cards are read).
  function maxAllowed() {
    const items = deckItems();
    if (!strictOn()) return items.length - 1;
    const k = items.findIndex((x) => x.t === "card" && !has(x.c.id, "read"));
    if (k >= 0) return k;
    const q = items.findIndex((x) => x.t === "quiz" && !itemDone(x));
    return q >= 0 ? q : items.length - 1;
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
    if (T.since && !T.paused && S.view === "deck" && !document.hidden && Date.now() - T.lastAct > NUDGE_MS) return focusNudge();
    if (T.since && Date.now() - T.lastAct > 180000) { const idleFrom = T.lastAct; clearInterval(T.iv); T.iv = null; timerFlush(idleFrom, "idle"); timerPause(false, "Looks like you stepped away, so we paused the timer."); return; }
    if (!pill) return;
    const left = targetMs() - usedMs();
    pill.classList.toggle("over", left < 0);
    pill.querySelector(".tt").textContent = "⏱ " + (left >= 0 ? fmt(left) : "+" + fmt(-left));
    if (left < 0 && !T.warned) { T.warned = true; toast("That's your " + Math.round(targetMs() / 60000) + " minutes. Wrap up when you're ready."); }
  }
  // Focus nudge: no touch, scroll or key for a while on a card → stop the clock at the last activity and ask him to refocus.
  const NUDGE_MS = 75000;
  let nudges = 0;
  const NUDGE_LINES = [
    ["👀", "Still with me?", "You haven't touched the screen in over a minute. Let's get back to it."],
    ["🎯", "Eyes on the brief", "Your mind might be wandering. Put other things away for a few minutes."],
    ["⚡", "Let's focus", "That's a few drift-offs today. Finish strong: it's only a few minutes."]];
  function focusNudge() {
    const idleFrom = T.lastAct;
    clearInterval(T.iv); T.iv = null; T.paused = true;
    const card = C.id;
    timerFlush(idleFrom, "nudge");
    nudges++;
    if (S.user && S.feed && !S.preview) record({ card_id: "nudge-" + Date.now(), kind: "time", ms: 0, points: 0, answer: JSON.stringify({ why: "nudge", idle_s: Math.round((Date.now() - idleFrom) / 1000), card, n: nudges }) });
    const [ico, h, p] = NUDGE_LINES[Math.min(nudges, NUDGE_LINES.length) - 1];
    const left = Math.max(0, targetMs() - usedMs());
    const done = () => { ov.remove(); T.paused = false; T.lastAct = Date.now(); timerStart(); };
    const ov = el("div", { class: "pausebox nudge", role: "alertdialog", "aria-modal": "true", "aria-label": h },
      el("div", { class: "pz-in" }, el("div", { class: "big", text: ico }), el("h3", { text: h }),
        el("p", { text: p + (left > 30000 ? " About " + Math.max(1, Math.round(left / 60000)) + " min to go." : "") }),
        el("button", { class: "btn signal block", onclick: done }, "I'm focused, let's go"),
        el("button", { class: "btn ghost block", onclick: () => { ov.remove(); T.paused = false; timerPause(true); } }, "I need a short break")));
    document.body.append(ov);
    ov.querySelector("button").focus();
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
    if (d > 0 && ni > maxAllowed()) { const it = items[S.idx]; if (it && it.t === "card") { const m = missingAnswers(it.c); if (m.length) return nudgeMissing(m); } return toast("Finish this one first."); }
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
    const typeBtn = el("button", { class: "btn ghost small", hidden: !SR, onclick: () => { ta.hidden = false; typeBtn.hidden = true; ta.focus(); } }, "⌨️ Type it instead");
    box.append(el("div", { class: "actions" }, go, clock, typeBtn), out, ta, tipsBox, save,
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
    const miss = S.preview ? [] : missingAnswers(c);
    if (miss.length) return nudgeMissing(miss[0]);
    const ms = Math.min(3600000, Math.round(cardActive(c.id)) || (Date.now() - (S.opened[c.id] || Date.now())));
    const pts = ms >= 12000 ? PTS.readLong : PTS.readShort;
    if (!(await record({ card_id: c.id, kind: "read", ms, points: pts }))) return;
    const n = readCount(), total = S.feed.cards.length;
    if (n === total && !has("_complete", "bonus")) {
      if (await record({ card_id: "_complete", kind: "bonus", points: PTS.complete })) gain(pts + PTS.complete, "All " + total + " read!");
    } else gain(pts, n === QUIZ_UNLOCK ? "Quiz unlocked 🔓" : "");
    if (n === QUIZ_UNLOCK || n === total) { const { data } = await sb.rpc("brief_stats"); if (data) S.stats = data; }
    S.idx = Math.min(S.idx + 1, deckItems().length - 1); S.dir = 1;
    paintLearner();
  }

  /* ---------- 🎁 Bonus rounds (interest trivia, facts, jokes, this-or-that) ---------- */
  const FUNKIND = { trivia: ["🧠", "Trivia"], fact: ["🤯", "Did you know?"], joke: ["😂", "Joke break"], thisorthat: ["⚖️", "This or that?"] };
  function funSlide(f) {
    const [ico, label] = FUNKIND[f.kind] || ["🎁", "Bonus"];
    const ev = S.events.get(evKey(f.id, "fun"));
    const head = el("header", { class: "shead g-fun" }, el("div", { class: "meta" }, el("span", { class: "chip", text: "Bonus round" }), f.topic ? el("span", { class: "chip ghost", text: f.topic }) : null),
      el("div", { class: "big", text: ico }), el("h2", { text: label }));
    const inner = el("div", { class: "inner fun" });
    const save = async (row, pts, msg) => { if (S.preview || has(f.id, "fun")) return; if (await record(Object.assign({ card_id: f.id, kind: "fun", points: pts }, row))) { gain(pts, msg); paintLearner(true); } };
    if (f.kind === "trivia" && Array.isArray(f.o)) {
      const box = el("div", { class: "check" }, el("div", { class: "q", text: f.q }));
      const letter = choices(box, S.feed.feed_date + f.id, f.o, f.a, ev, (i) => save({ correct: i === f.a, choice: i }, i === f.a ? PTS.funRight : PTS.funTry, i === f.a ? "Nailed it!" : ""));
      if (ev || S.preview) box.append(el("div", { class: "explain" }, el("b", { text: S.preview ? "Answer: " + letter + ". " : ev.correct ? "You know your stuff! " : "Now you know! " }), f.e || ""));
      inner.append(box);
    } else if (f.kind === "joke") {
      inner.append(el("p", { class: "setup", text: f.setup || f.q || "" }));
      const punch = el("p", { class: "punch", text: f.punch || "", hidden: !ev && !S.preview });
      inner.append(punch);
      if (!ev && !S.preview) inner.append(el("button", { class: "btn signal block reveal", onclick: (e) => { punch.hidden = false; e.target.replaceWith(rateRow()); } }, "Tell me! 👀"));
      else inner.append(el("div", { class: "muted small", text: ev ? (ev.choice ? "😂 Good one" : "😐 Groan") : "" }));
      function rateRow() { return el("div", { class: "actions center" }, el("button", { class: "btn", onclick: () => save({ choice: 1 }, PTS.funTry, "😂") }, "😂 Ha!"), el("button", { class: "btn ghost", onclick: () => save({ choice: 0 }, PTS.funTry, "") }, "😐 Groan")); }
    } else if (f.kind === "thisorthat" && Array.isArray(f.o)) {
      inner.append(el("div", { class: "q", text: f.q || "Which would you pick?" }));
      inner.append(el("div", { class: "tot" }, f.o.slice(0, 2).map((o, i) => el("button", { class: "totb" + (ev && ev.choice === i ? " on" : ""), disabled: !!ev || S.preview, onclick: () => save({ choice: i, answer: o.slice(0, 200) }, PTS.funTry, "Good pick!") }, o))));
      if (ev && f.e) inner.append(el("div", { class: "explain", text: f.e }));
    } else {
      inner.append(el("p", { class: "factt", text: f.text || f.q || "" }));
      if (f.e) inner.append(el("p", { class: "muted small", text: f.e }));
      inner.append(ev ? el("div", { class: "muted small", text: ev.choice ? "🤯 Mind blown" : "😎 Knew it" }) : S.preview ? "" :
        el("div", { class: "actions center" }, el("button", { class: "btn", onclick: () => save({ choice: 1 }, PTS.funTry, "🤯") }, "🤯 No way!"), el("button", { class: "btn ghost", onclick: () => save({ choice: 0 }, PTS.funTry, "😎") }, "😎 Knew it")));
    }
    return el("article", { class: "slide" + (S.dir < 0 ? " from-left" : " from-right"), id: "f-" + f.id }, head, inner);
  }

  /* ---------- 🎮 Daily mini-game: real or fake, higher or lower, word match, emoji decode (60 seconds) ---------- */
  const GAMES = { realfake: ["🕵️", "Real or fake?", "Is each headline real news, or made up? Trust your street smarts."], higherlower: ["📈", "Higher or lower", "Tap the one with the bigger number."], match: ["🔗", "Word match", "Match each word to what it means."], emoji: ["🧩", "Emoji decode", "Which story do the emojis describe?"] };
  const GAME_MS = 60000;
  function gameSlide(g) {
    const [ico, title, how] = GAMES[g.type] || ["🎮", g.title || "Mini-game", ""];
    const ev = S.events.get(evKey("game", "game"));
    const head = el("header", { class: "shead g-game" }, el("div", { class: "meta" }, el("span", { class: "chip", text: "Game time" }), el("span", { class: "chip ghost", text: "60 seconds" })),
      el("div", { class: "big", text: ico }), el("h2", { text: g.title || title }), el("p", { class: "sub", text: how }));
    const inner = el("div", { class: "inner game" });
    const items = g.type === "match" ? g.items.slice(0, 6) : g.items.slice(0, 10);
    let best = null; try { best = ev && JSON.parse(ev.answer || "{}"); } catch (e) { }
    const startBtn = el("button", { class: "btn signal block big", onclick: () => play() }, ev ? "Play again (just for fun)" : "Start ▶");
    inner.append(ev ? el("div", { class: "gres" }, el("b", { text: "Your score: " + (best && best.score != null ? best.score + " / " + best.total : ev.choice) }), el("span", { class: "muted small", text: " +" + ev.points + " points" })) : "", S.preview ? el("div", { class: "muted small", text: items.length + " rounds" }) : startBtn);
    function play() {
      const t0 = Date.now(); let score = 0, i = 0, over = false;
      const bar = el("div", { class: "gbar" }, el("i")), sc = el("span", { class: "gsc num", text: "0" }), stage = el("div", { class: "stage" });
      inner.replaceChildren(el("div", { class: "ghud" }, bar, sc), stage);
      const tick = setInterval(() => { const left = GAME_MS - (Date.now() - t0); bar.firstChild.style.width = Math.max(0, (100 * left) / GAME_MS) + "%"; if (left <= 0) end(); }, 200);
      const hit = (ok, note, next) => { if (over) return; if (ok) { score++; sc.textContent = score; } stage.classList.remove("ok", "no"); void stage.offsetWidth; stage.classList.add(ok ? "ok" : "no");
        if (note) { stage.append(el("div", { class: "gnote", text: (ok ? "✓ " : "✗ ") + note })); setTimeout(next, ok ? 700 : 1500); } else setTimeout(next, 250); };
      const nextRound = () => { if (over) return; if (i >= items.length) return end(); renderRound(items[i++]); };
      function renderRound(x) {
        stage.replaceChildren();
        if (g.type === "realfake") {
          stage.append(el("div", { class: "gcard", text: "“" + x.text + "”" }), el("div", { class: "gbtns" },
            el("button", { class: "btn", onclick: () => hit(x.real === true, (x.real ? "Real. " : "Made up. ") + (x.e || ""), nextRound) }, "📰 Real"),
            el("button", { class: "btn", onclick: () => hit(x.real === false, (x.real ? "Real. " : "Made up. ") + (x.e || ""), nextRound) }, "🧢 Fake")));
        } else if (g.type === "higherlower") {
          const side = (o, other) => el("button", { class: "hl", onclick: () => hit(Number(o.value) >= Number(other.value), fmtHL(x.a) + " vs " + fmtHL(x.b) + (x.e ? ". " + x.e : ""), nextRound) }, el("b", { text: o.label }));
          stage.append(el("div", { class: "q", text: x.q || "Which is bigger?" }), el("div", { class: "hlrow" }, side(x.a, x.b), el("span", { class: "vs", text: "vs" }), side(x.b, x.a)));
        } else if (g.type === "emoji") {
          stage.append(el("div", { class: "emo", text: x.emoji }), el("div", { class: "gopts" }, (x.o || []).map((o, k) => el("button", { class: "btn", onclick: () => hit(k === x.a, x.e || "", nextRound) }, o))));
        }
      }
      function fmtHL(o) { return o.label + ": " + (o.shown || Number(o.value).toLocaleString("en-US")) + (o.unit ? " " + o.unit : ""); }
      function matchRound() {
        const terms = items.map((x, k) => ({ k, t: x.term })), means = order(items.length, S.feed.feed_date + "match").map((k) => ({ k, t: items[k].means }));
        let pick = null, done = 0;
        const L = el("div", { class: "mcol" }), R = el("div", { class: "mcol" });
        const mk = (col, arr, side) => arr.forEach((x) => col.append(el("button", { class: "mb", "data-k": x.k, onclick: (e) => choose(side, x.k, e.currentTarget) }, x.t)));
        function choose(side, k, b) {
          if (b.classList.contains("gone")) return;
          if (!pick || pick.side === side) { stage.querySelectorAll(".mb.sel").forEach((n) => n.classList.remove("sel")); pick = { side, k, b }; b.classList.add("sel"); return; }
          if (pick.k === k) { score++; done++; sc.textContent = score; pick.b.classList.add("gone"); b.classList.add("gone"); pick = null; if (done === items.length) setTimeout(end, 400); }
          else { const a = pick.b; pick = null; a.classList.remove("sel"); [a, b].forEach((n) => { n.classList.add("miss"); setTimeout(() => n.classList.remove("miss"), 500); }); }
        }
        mk(L, terms, "L"); mk(R, means, "R");
        stage.append(el("div", { class: "mgrid" }, L, R));
      }
      async function end() {
        if (over) return; over = true; clearInterval(tick);
        const total = items.length, pts = Math.min(40, score * PTS.gameEach + (score === total ? PTS.gameDone : 0));
        const first = !has("game", "game") && !S.preview;
        inner.replaceChildren(el("div", { class: "gover" }, el("div", { class: "big", text: score === total ? "🏆" : score >= total / 2 ? "🔥" : "💪" }),
          el("h3", { text: score + " / " + total }), el("p", { class: "muted", text: score === total ? "Perfect round!" : score >= total / 2 ? "Nice work!" : "Good warm-up. Tomorrow's another round." }),
          first ? "" : el("p", { class: "muted small", text: "Practice round: points count on your first game each day." })));
        if (first && await record({ card_id: "game", kind: "game", choice: score, points: pts, ms: Math.min(GAME_MS, Date.now() - t0), answer: JSON.stringify({ type: g.type, score, total }) })) { gain(pts, score === total ? "Perfect!" : "Game over"); if (score === total) confetti(); setTimeout(() => paintLearner(true), 1600); }
      }
      if (g.type === "match") matchRound(); else nextRound();
    }
    return el("article", { class: "slide" + (S.dir < 0 ? " from-left" : " from-right"), id: "game-slide" }, head, inner);
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
      el("label", { class: "strictrow" }, el("input", { type: "checkbox", checked: !!k.strict, onchange: async (e) => {
          msg.textContent = "Saving…"; const { error } = await sb.rpc("brief_admin_set_strict", { p_user: k.user_id, p_strict: e.target.checked });
          msg.textContent = error ? friendly(error) : e.target.checked ? "Every answer is now required." : "Answers other than the quick check are optional again."; } }),
        el("span", {}, el("b", { text: "Every answer required" }), el("span", { class: "muted small", text: " No skipping: takes, speaking, questions and reflections must be answered before moving on, cards go in order, and the quiz must be finished." }))),
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
        pr.direction ? el("p", { class: "small", style: "margin:0" }, el("b", { text: "Trend: " }), pr.direction) : null,
        pr.calib ? el("p", { class: "small", style: "margin:0" }, el("b", { text: "Current setup: " }),
          [pr.calib.cards ? pr.calib.cards + " cards" : "", pr.calib.news_words ? "~" + [].concat(pr.calib.news_words).join("–") + "-word articles" : "", pr.calib.written != null ? pr.calib.written + " written answers" : "", pr.calib.target_minutes ? pr.calib.target_minutes + " min target" : ""].filter(Boolean).join(" · ") + (pr.calib.why ? ". " + pr.calib.why : "")) : null));
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
      el("div", {}, el("b", { text: count("away") + count("idle") }), el("span", { text: "left app / idle" })),
      el("div", {}, el("b", { text: segs.filter((x) => x.why === "nudge" && !x.ms).length }), el("span", { text: "focus nudges" }))));
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
    const fx = (data.feed && data.feed.extras) || {};
    if (Array.isArray(fx.bonus) && fx.bonus.length || fx.game) {
      const tried = (fx.bonus || []).filter((f) => ev[f.id + ":fun"]), triv = (fx.bonus || []).filter((f) => f.kind === "trivia" && ev[f.id + ":fun"]);
      const ge = ev["game:game"]; let gr = null; try { gr = ge && JSON.parse(ge.answer || "{}"); } catch (e) { }
      nodes.push(el("div", { class: "card ans" }, el("div", { class: "eyebrow", text: "🎁 Bonus rounds and game" }),
        el("div", { class: "small", text: (fx.bonus || []).length ? "Bonus rounds: " + tried.length + " of " + fx.bonus.length + " done" + (triv.length ? " · trivia " + triv.filter((f) => ev[f.id + ":fun"].correct).length + "/" + triv.length + " right" : "") + " (" + (fx.bonus || []).map((f) => f.topic).filter(Boolean).join(", ") + ")" : "" }),
        fx.game ? el("div", { class: "small", text: "🎮 " + ((GAMES[fx.game.type] || [])[1] || "Game") + ": " + (ge ? (gr && gr.score != null ? gr.score + " / " + gr.total : ge.choice) : "skipped") }) : null));
    }
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
