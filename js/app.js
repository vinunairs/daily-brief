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
  const PTS = { readLong: 3, readShort: 1, right: 8, wrong: 2, opinion: 5, reflect: 5, recallRight: 10, recallWrong: 2, complete: 20, mission: [2, 6, 10] };
  const CAT = { finance: "Finance", tech: "Tech", health: "Health", world: "World", reasoning: "Reasoning", skills: "Life skills", social: "People skills" };
  const KIND = { estimation: "Estimate it", flaw: "Spot the flaw", logic: "Logic", pattern: "Pattern", triage: "Triage", interview: "Interview", money: "Money", workplace: "Work smarts", communication: "Communication", decision: "Decisions",
    conversation: "Conversation", jargon: "Jargon", street: "Street smarts", self: "Self-check" };
  const SOCIAL = new Set(["conversation", "communication"]);

  const $app = document.getElementById("app");
  const $sheet = document.getElementById("sheet");
  const $toast = document.getElementById("toast");
  const $menu = document.getElementById("menuBtn");

  if (!window.supabase || !window.supabase.createClient) { $app.textContent = "Couldn't load. Check your connection and reopen."; return; }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
  });

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
  const S = { user: null, me: null, feed: null, events: new Map(), stats: null, note: null, open: null, opened: {}, preview: null };
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
      const { data: me, error } = await sb.rpc("brief_me");
      if (error) throw error;
      S.me = me || {};
      if (S.me.learner && S.me.learner.active) return await renderLearner();
      if (S.me.admin) return await renderParent();
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
      el("p", { class: "muted", text: "The news that matters, a reasoning workout and a life skill, picked for you each morning. Sign in with your Test Prep Hub account." }),
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
  function renderNewPassword() {
    const pw = el("input", { type: "password", autocomplete: "new-password", minlength: "8", required: true, id: "npw" });
    const msg = el("p", { class: "err", role: "alert" });
    $app.replaceChildren(el("form", { class: "auth", onsubmit: async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: pw.value });
      if (error) msg.textContent = friendly(error); else { toast("Password updated"); route(); }
    } }, el("h1", { text: "Set a new password" }), el("label", { class: "f", for: "npw" }, "New password (8+ characters)", pw), el("button", { class: "btn primary block", type: "submit" }, "Save password"), msg));
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
      const { data: evs } = await sb.from("brief_events").select("card_id, kind, correct, choice, answer, points").eq("feed_date", S.feed.feed_date);
      for (const e of evs || []) S.events.set(evKey(e.card_id, e.kind), e);
    }
    if (!S.open && S.feed) { const next = S.feed.cards.find((c) => !has(c.id, "read")); S.open = next ? next.id : null; }
    paintLearner();
  }

  function paintLearner() {
    const today = localDate();
    const name = (S.me.learner && S.me.learner.name) || "";
    const nodes = [];
    nodes.push(el("section", { class: "hero" },
      el("div", { class: "date", text: prettyDate(today) }),
      el("h1", { text: greeting() + (name ? ", " + name : "") }),
      el("div", { class: "stats" },
        el("div", { class: "stat" + (S.stats.streak > 0 ? " hot" : "") }, el("b", { text: (S.stats.streak || 0) + "🔥" }), el("span", { text: "day streak" })),
        el("div", { class: "stat" }, el("b", { text: S.stats.today || 0 }), el("span", { text: "points today" })),
        el("div", { class: "stat" }, el("b", { text: S.stats.week || 0 }), el("span", { text: "this week" })))));
    if (S.note && S.note.note) nodes.push(el("div", { class: "coach" }, el("span", { class: "eyebrow", text: "Coach's note" }), S.note.note));
    if (!S.feed) {
      nodes.push(el("div", { class: "card pad" }, el("p", { text: "Your first brief is being prepared. Check back after 7 a.m." })));
      return $app.replaceChildren(...nodes);
    }
    if (S.feed.feed_date !== today && !S.preview) nodes.push(el("div", { class: "stale", text: "Today's brief isn't ready yet, so here's the latest one (" + prettyDate(S.feed.feed_date, { weekday: "short", month: "short" }) + ")." }));
    const n = readCount(), total = S.feed.cards.length;
    nodes.push(el("div", { class: "progress" },
      el("div", { class: "lbl" }, el("span", { text: n + " of " + total + " read" }), el("span", { class: "muted", text: n >= total ? "All done" : "~" + Math.max(1, Math.round((total - n) * 1)) + " min left" })),
      el("div", { class: "bar" }, el("i", { style: "width:" + Math.round((100 * n) / total) + "%" }))));
    nodes.push(missionView());
    nodes.push(el("div", { class: "feed" }, S.feed.cards.map(cardView)));
    nodes.push(quizView());
    if (n >= total && S.feed.quiz.every((q) => has(q.id, "recall"))) nodes.push(el("div", { class: "finish" }, el("h3", { text: "Brief complete 🎉" }), el("p", { text: "You're caught up. Bring one of today's stories into a conversation. That's how it sticks." })));
    $app.replaceChildren(...nodes);
  }

  function tagFor(c) {
    const cat = c.type === "news" ? (CAT[c.cat] ? c.cat : "world") : c.type === "reasoning" ? "reasoning" : SOCIAL.has(c.kind) ? "social" : "skills";
    const label = c.type === "news" ? CAT[cat] : KIND[c.kind] || CAT[cat];
    return el("span", { class: "tag " + cat, text: label });
  }

  function cardView(c) {
    const done = has(c.id, "read");
    const open = S.open === c.id;
    const readEv = S.events.get(evKey(c.id, "read"));
    const earned = ["read", "check", "opinion", "reflect"].reduce((t, k) => t + ((S.events.get(evKey(c.id, k)) || {}).points || 0), 0);
    const head = el("button", { class: "head", type: "button", "aria-expanded": String(open), onclick: () => toggle(c.id) },
      el("div", { class: "meta" }, tagFor(c), c.region ? el("span", { class: "region", text: c.region }) : null),
      done && !open ? el("span", { class: "pts", text: "✓ +" + earned }) : chevron(),
      el("h2", { text: c.title }));
    const card = el("article", { class: "card" + (open ? " open" : "") + (done && !open ? " done" : ""), id: "c-" + c.id }, head);
    if (!open) return card;
    if (!S.opened[c.id]) S.opened[c.id] = Date.now();
    const inner = el("div", { class: "inner" });
    inner.append(el("div", { class: "body", text: c.body }));
    if (c.why) inner.append(el("div", { class: "why" }, el("b", { text: "Why it matters" }), c.why));
    if (Array.isArray(c.terms) && c.terms.length) inner.append(el("dl", { class: "terms" }, c.terms.map((t) => [el("dt", { text: t.term }), el("dd", {}, t.means, t.example ? el("span", { class: "ex", text: "e.g. " + t.example }) : null)])));
    if (Array.isArray(c.lines) && c.lines.length) inner.append(el("div", { class: "lines" }, el("b", { text: "Try saying" }), el("ul", {}, c.lines.map((l) => el("li", { text: l })))));
    if (c.say) inner.append(el("div", { class: "say" }, el("b", { text: "Bring it up with friends" }), c.say));
    if (c.check) inner.append(checkView(c));
    if (c.tip) inner.append(el("div", { class: "tip" }, el("b", { text: "Tip: " }), c.tip));
    if (c.mission) inner.append(el("div", { class: "mission" }, el("b", { text: "🎯 Today's mission" }), c.mission, el("span", { class: "muted small", text: "Tomorrow's brief will ask how it went. Honest answers earn points too." })));
    if (c.reflect) inner.append(reflectView(c));
    if (c.talk) inner.append(talkView(c));
    if (c.source && c.source.url) inner.append(el("div", { class: "source" }, "Source: ", el("a", { href: c.source.url, target: "_blank", rel: "noopener" }, c.source.name || "Read more"), " ↗"));
    if (S.preview) {
      // parent preview: read-only
    } else if (!done) {
      const checked = !c.check || has(c.id, "check");
      inner.append(el("div", { class: "actions" },
        el("button", { class: "btn " + (checked ? "signal" : "ghost") + " block", onclick: () => markRead(c) }, checked ? "Done — next card" : "Skip the check and move on")));
    } else if (readEv) {
      inner.append(el("p", { class: "muted small", text: "✓ Read · +" + earned + " points from this card" }));
    }
    card.append(inner);
    return card;
  }

  function toggle(id) {
    S.open = S.open === id ? null : id;
    paintLearner();
    if (S.open) requestAnimationFrame(() => { const n = document.getElementById("c-" + id); if (n) n.scrollIntoView({ behavior: "smooth", block: "start" }); });
  }

  function checkView(c) {
    const ev = S.events.get(evKey(c.id, "check"));
    const box = el("div", { class: "check" }, el("div", { class: "q", text: c.check.q }));
    const letter = choices(box, S.feed.feed_date + c.id, c.check.o, c.check.a, ev, (i) => answerCheck(c, i));
    if (ev || S.preview) box.append(el("div", { class: "explain" }, el("b", { text: S.preview ? "Answer: " + letter + "." : ev.correct ? "Right! +" + ev.points : "Not quite. +" + ev.points + " for trying." }), c.check.e));
    return box;
  }

  function talkView(c) {
    const ev = S.events.get(evKey(c.id, "opinion"));
    const wrap = el("div", { class: "talk" }, el("div", { class: "q", text: c.talk }));
    if (ev) { wrap.append(el("div", { class: "saved", text: ev.answer }), el("div", { class: "muted small", text: "Saved · +" + ev.points + ". Your coach reads these; strong reasons earn bonus points tomorrow." })); return wrap; }
    if (S.preview) return wrap;
    const ta = el("textarea", { placeholder: "Your take in 1–3 sentences. Give a reason. (Optional, +" + PTS.opinion + ")", maxlength: "600", "aria-label": "Your answer" });
    const save = el("button", { class: "btn", disabled: true, onclick: () => saveOpinion(c, ta.value.trim()) }, "Save my take");
    ta.addEventListener("input", () => (save.disabled = ta.value.trim().length < 15));
    wrap.append(ta, el("div", { class: "actions" }, save, el("span", { class: "muted small", text: "Graded on your reasons, not your side. Your parent can read it." })));
    return wrap;
  }

  function reflectView(c) {
    const ev = S.events.get(evKey(c.id, "reflect"));
    const wrap = el("div", { class: "talk reflect" }, el("div", { class: "q", text: c.reflect }));
    if (ev) { wrap.append(el("div", { class: "saved", text: ev.answer }), el("div", { class: "muted small", text: "Saved · +" + ev.points + " · Your parent can read your answers too." })); return wrap; }
    if (S.preview) return wrap;
    const ta = el("textarea", { placeholder: "Be honest; there's no wrong answer. (+" + PTS.reflect + ")", maxlength: "600", "aria-label": "Your reflection" });
    const save = el("button", { class: "btn", disabled: true, onclick: () => saveText(c, "reflect", ta.value.trim(), PTS.reflect) }, "Save");
    ta.addEventListener("input", () => (save.disabled = ta.value.trim().length < 10));
    wrap.append(ta, el("div", { class: "actions" }, save, el("span", { class: "muted small", text: "Not graded. Your parent can read it." })));
    return wrap;
  }

  function missionView() {
    const m = S.feed.extras && S.feed.extras.mission_checkin;
    if (!m || !m.text) return null;
    const ev = S.events.get(evKey("mission", "mission"));
    const box = el("section", { class: "checkin" }, el("div", { class: "eyebrow", text: "Mission check-in" + (m.ref ? " · from " + prettyDate(m.ref, { weekday: "short", month: "short" }) : "") }), el("div", { class: "q", text: m.text }));
    if (ev) { box.append(el("div", { class: "small", text: ["Not yet: no problem, it'll come around again.", "Partly: that still counts. Nice.", "You did it! That takes guts."][ev.choice] + " +" + ev.points })); return box; }
    if (S.preview) return box;
    const opts = [["Did it ✅", 2], ["Partly", 1], ["Not yet", 0]];
    box.append(el("div", { class: "actions" }, opts.map(([label, v]) => el("button", { class: "btn" + (v === 2 ? " signal" : " ghost"), onclick: async () => {
      if (await record({ card_id: "mission", kind: "mission", choice: v, answer: m.text.slice(0, 600), points: PTS.mission[v] })) { toast("+" + PTS.mission[v], v > 0); paintLearner(); }
    } }, label))));
    return box;
  }

  async function saveText(c, kind, text, pts) {
    if (await record({ card_id: c.id, kind, answer: text.slice(0, 600), points: pts })) { toast("Saved +" + pts, true); paintLearner(); }
  }

  async function record(row) {
    const full = Object.assign({ user_id: S.user.id, feed_date: S.feed.feed_date }, row);
    const { error } = await sb.from("brief_events").upsert(full, { onConflict: "user_id,feed_date,card_id,kind", ignoreDuplicates: true });
    if (error) { toast("Couldn't save. Check your connection."); return false; }
    S.events.set(evKey(row.card_id, row.kind), full);
    const pts = row.points || 0;
    S.stats.total += pts; S.stats.today += S.feed.feed_date === localDate() ? pts : 0; S.stats.week += pts;
    return true;
  }

  async function answerCheck(c, i) {
    if (has(c.id, "check") || S.preview) return;
    const correct = i === c.check.a;
    const pts = correct ? PTS.right : PTS.wrong;
    if (await record({ card_id: c.id, kind: "check", correct, choice: i, points: pts })) {
      toast(correct ? "Correct! +" + pts : "+" + pts + " for trying", correct);
      paintLearner();
    }
  }

  async function saveOpinion(c, text) {
    if (text.length < 15) return;
    if (await record({ card_id: c.id, kind: "opinion", answer: text.slice(0, 600), points: PTS.opinion })) { toast("Saved +" + PTS.opinion, true); paintLearner(); }
  }

  async function markRead(c) {
    if (has(c.id, "read")) return;
    const ms = Math.min(3600000, Date.now() - (S.opened[c.id] || Date.now()));
    const pts = ms >= 12000 ? PTS.readLong : PTS.readShort;
    if (!(await record({ card_id: c.id, kind: "read", ms, points: pts }))) return;
    const n = readCount(), total = S.feed.cards.length;
    if (n === total && !has("_complete", "bonus")) {
      if (await record({ card_id: "_complete", kind: "bonus", points: PTS.complete })) toast("All 10 read! +" + PTS.complete + " bonus", true);
    } else toast("+" + pts + (n === QUIZ_UNLOCK ? " · Recall quiz unlocked" : ""), true);
    if (n === QUIZ_UNLOCK || n === total) { const { data } = await sb.rpc("brief_stats"); if (data) S.stats = data; }
    const next = S.feed.cards.find((x) => !has(x.id, "read"));
    S.open = next ? next.id : null;
    paintLearner();
    const target = next ? document.getElementById("c-" + next.id) : document.getElementById("quiz");
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function quizView() {
    const qz = S.feed.quiz || [];
    if (!qz.length) return null;
    const unlocked = readCount() >= Math.min(QUIZ_UNLOCK, S.feed.cards.length) || S.preview;
    const done = qz.filter((q) => has(q.id, "recall")).length;
    const sec = el("section", { id: "quiz" }, el("div", { class: "section-h" }, el("h3", { text: "Recall quiz" }), el("span", { class: "muted small", text: done + " of " + qz.length + " · +" + PTS.recallRight + " each" })));
    if (!unlocked) { sec.append(el("div", { class: "locked", text: "🔒 Read " + QUIZ_UNLOCK + " cards to unlock. These questions come from earlier briefs. Remembering old stories is what builds real knowledge." })); return sec; }
    const list = el("div", { class: "quiz" });
    for (const q of qz) {
      const ev = S.events.get(evKey(q.id, "recall"));
      const card = el("div", { class: "card" }, q.ref ? el("div", { class: "ref", text: "From " + prettyDate(q.ref, { weekday: undefined, month: "short" }) }) : null, el("div", { class: "q", style: "font-weight:700", text: q.q }));
      const letter = choices(card, S.feed.feed_date + q.id, q.o, q.a, ev, (i) => answerRecall(q, i));
      if (ev || S.preview) card.append(el("div", { class: "explain" }, el("b", { text: S.preview ? "Answer: " + letter + "." : ev.correct ? "Remembered! +" + ev.points : "+" + ev.points + " for trying." }), q.e));
      list.append(card);
    }
    sec.append(list);
    return sec;
  }

  async function answerRecall(q, i) {
    if (has(q.id, "recall") || S.preview) return;
    const correct = i === q.a, pts = correct ? PTS.recallRight : PTS.recallWrong;
    if (await record({ card_id: q.id, kind: "recall", correct, choice: i, points: pts })) {
      toast(correct ? "Remembered! +" + pts : "+" + pts, correct);
      const y = window.scrollY; paintLearner(); window.scrollTo(0, y);
    }
  }

  /* ---------- parent view ---------- */
  async function renderParent() {
    const { data, error } = await sb.rpc("brief_admin_overview");
    if (error) throw error;
    const kids = data || [];
    const nodes = [el("section", { class: "hero" }, el("div", { class: "date", text: prettyDate(localDate()) }), el("h1", { text: "Parent view" }))];
    if (!kids.length) nodes.push(el("div", { class: "card pad", text: "No learners yet." }));
    for (const k of kids) nodes.push(kidView(k));
    $app.replaceChildren(...nodes);
  }

  function kidView(k) {
    const st = k.stats || {}, pr = k.profile || {}, rep = (k.reports || [])[0];
    const days = st.days || [];
    const max = Math.max(10, ...days.map((d) => d.pts));
    const card = el("article", { class: "card kid" },
      el("div", { class: "row", style: "display:flex;justify-content:space-between;align-items:baseline;gap:10px" },
        el("h2", { text: k.name }), el("span", { class: "muted small", text: "Grade " + (k.grade || "?") + " · " + k.band + (k.notify ? " · 🔔 on" : " · 🔕 notifications off") })),
      el("div", { class: "stats" },
        el("div", { class: "stat" + (st.streak ? " hot" : "") }, el("b", { text: (st.streak || 0) + "🔥" }), el("span", { text: "day streak" })),
        el("div", { class: "stat" }, el("b", { text: st.week || 0 }), el("span", { text: "points this week" })),
        el("div", { class: "stat" }, el("b", { text: st.total || 0 }), el("span", { text: "all-time points" }))),
      el("div", {}, el("div", { class: "eyebrow", text: "Last 14 days (points)" }),
        el("div", { class: "spark", role: "img", "aria-label": "Daily points for the last 14 days" }, days.map((d) => el("i", { class: d.pts ? "" : "zero", title: d.d + ": " + d.pts + " pts, " + d.read + " read", style: "height:" + Math.max(3, Math.round((64 * d.pts) / max)) + "px" }))),
        el("div", { class: "sparkl" }, el("span", { text: days[0] ? prettyDate(days[0].d, { weekday: undefined, month: "short" }) : "" }), el("span", { text: "today" }))));
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
    card.append(goalsEditor(k));
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

  function goalsEditor(k) {
    let goals = (k.goals || []).slice();
    const list = el("ol", { class: "goals" });
    const msg = el("span", { class: "muted small", role: "status" });
    const save = el("button", { class: "btn primary", disabled: true, onclick: async () => {
      save.disabled = true; msg.textContent = "Saving…";
      const { error } = await sb.rpc("brief_admin_set_goals", { p_user: k.user_id, p_goals: goals });
      msg.textContent = error ? friendly(error) : "Saved. Tomorrow's brief will use these.";
      if (!error) k.goals = goals.slice();
    } }, "Save goals");
    const dirty = () => { save.disabled = JSON.stringify(goals) === JSON.stringify(k.goals || []); msg.textContent = save.disabled ? "" : "Unsaved changes"; };
    function paint() {
      list.replaceChildren(...goals.map((g, i) => el("li", {}, el("span", { text: g }),
        el("button", { class: "linkbtn", "aria-label": "Remove goal: " + g, onclick: () => { goals.splice(i, 1); paint(); dirty(); } }, "Remove"))));
    }
    const input = el("input", { type: "text", maxlength: "200", placeholder: "e.g. Handling disagreements calmly", "aria-label": "New goal" });
    const add = () => { const v = input.value.trim(); if (!v || goals.length >= 20) return; goals.push(v); input.value = ""; paint(); dirty(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    paint();
    return el("details", { class: "goalsbox" }, el("summary", { text: "Growth goals (" + goals.length + ")" }),
      el("p", { class: "muted small", text: "What you want " + k.name + " to grow in. Every morning's brief is built around these. Add or remove any time." }),
      list, el("div", { class: "addgoal" }, input, el("button", { class: "btn", onclick: add }, "Add")), el("div", { class: "actions" }, save, msg));
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
    const nodes = [el("div", { class: "row", style: "display:flex;justify-content:space-between;align-items:center;margin-top:6px" }, back), el("section", { class: "hero" }, el("h1", { text: k.name + "'s answers" })), nav];
    const r = data.report;
    if (r) {
      nodes.push(el("article", { class: "card kid" }, el("div", { class: "eyebrow", text: "Coach's evaluation (written " + prettyDate(r.date, { weekday: "short", month: "short" }) + ")" }),
        el("div", { class: "report", text: r.summary }),
        r.knowledge ? el("div", {}, el("div", { class: "eyebrow", text: "What his answers show about his knowledge" }), el("div", { class: "report", text: r.knowledge })) : null,
        r.plan ? el("div", { class: "plan" }, el("div", { class: "eyebrow", text: "Plan forward" }), el("div", { class: "report", text: r.plan })) : null));
    } else nodes.push(el("div", { class: "stale", text: data.feed ? "The evaluation of this day appears the next morning after 5:40 a.m." : "No brief on this day." }));
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
    $app.replaceChildren(...nodes);
    window.scrollTo(0, 0);
  }

  async function previewFeed(k) {
    const { data, error } = await sb.rpc("brief_admin_feed", { p_user: k.user_id, p_date: localDate() });
    if (error) return toast(friendly(error));
    if (!data) return toast("No brief written yet");
    S.feed = data; S.preview = k; S.events = new Map(); S.stats = k.stats || { total: 0, week: 0, today: 0, streak: 0 }; S.note = null; S.open = data.cards[0] && data.cards[0].id;
    S.me = Object.assign({}, S.me, { learner: { name: k.name } });
    paintLearner();
    $app.prepend(el("div", { class: "preview-banner" }, el("span", { text: "Preview of " + k.name + "'s brief for " + prettyDate(data.feed_date, { weekday: "short", month: "short" }) + ". Nothing is recorded." }), el("button", { class: "btn ghost", onclick: () => { S.preview = null; S.me.learner = null; route(); } }, "Back")));
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

  // Coming back to the app (e.g. from a notification) refreshes the brief.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.user && S.me && S.me.learner && !S.preview && $sheet.hidden) { S.open = null; route(); } });
  window.__brief = { S, sb, route };
  route();
})();
