// Test double for the Supabase client: lets the page run in a headless browser with no network.
// Loaded instead of js/vendor/supabase-*.js by test/run.py.
(function () {
  const feed = window.__FEED;
  const mode = window.__MODE || "learner";
  const events = [];
  window.__EVENTS = events;
  const user = { id: "u1", email: mode === "parent" ? "parent@example.com" : "kid@example.com" };
  const signedIn = mode !== "signedout";
  function q(table) {
    const chain = {
      _t: table,
      select() { return chain; }, eq() { return chain; }, lte() { return chain; }, order() { return chain; }, limit() { return chain; },
      maybeSingle() {
        if (table === "brief_feeds") return Promise.resolve({ data: feed, error: null });
        if (table === "brief_coach_notes") return Promise.resolve({ data: { note: "Welcome to your first Daily Brief!", note_date: feed.feed_date }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      upsert(row) { events.push(row); return Promise.resolve({ error: null }); },
      update() { return chain; }, delete() { return chain; },
      then(res) { return Promise.resolve({ data: table === "brief_events" ? [] : null, error: null }).then(res); }
    };
    return chain;
  }
  window.supabase = {
    createClient() {
      return {
        auth: {
          getSession: async () => ({ data: { session: signedIn ? { user } : null } }),
          onAuthStateChange() {}, signInWithPassword: async () => ({ error: { message: "Invalid login credentials" } }),
          signOut: async () => ({}), resetPasswordForEmail: async () => ({}), updateUser: async () => ({})
        },
        rpc: async (fn, args) => {
          if (fn === "brief_me") return { data: mode === "parent" ? { admin: true, learner: null } : { admin: false, learner: { name: "Rishabh", band: "challenger", active: true } } };
          if (fn === "brief_stats") return { data: { total: 0, week: 0, today: 0, streak: 0, days: [] } };
          if (fn === "brief_admin_overview") return { data: [{ user_id: "u2", name: "Rishabh", band: "challenger", grade: "10", active: true, notify: false,
            goals: ["General knowledge", "Conversation confidence"], interests: ["Drumming", "Pokémon"], likes: [{ date: "2026-09-28", title: "US and China agree to regular talks on advanced AI", cat: "tech", v: 1 }], missions: [{ date: "2026-09-29", mission: "Ask one older neighbor a question.", result: 2 }], reflections_14d: 1,
            profile: { strengths: ["estimation"], gaps: ["health vocabulary"], interests: ["AI"], direction: "Early days: 1 day of data." },
            stats: { total: 57, week: 57, streak: 1, days: Array.from({ length: 14 }, (_, i) => ({ d: "2026-09-" + String(15 + i).padStart(2, "0"), pts: i === 13 ? 57 : 0, read: i === 13 ? 10 : 0, mins: i === 13 ? 11 : 0 })) },
            reports: [{ date: "2026-09-29", summary: "Rishabh read all 10 cards yesterday.", metrics: { accuracy_by_category: { finance: 1, tech: 0.5, health: 1, reasoning: 0.5, skills: 1 } } }],
            opinions: [{ date: "2026-09-28", card: "n2", answer: "Holding back soybeans keeps leverage for the next round.", score: 2 }] },
            { user_id: "u3", name: "Mom", band: "adult", age: 44, active: true, private: true, stats: { total: 12, week: 12, streak: 1, days: [] } }] };
          if (fn === "brief_admin_feed") return { data: feed };
          if (fn === "brief_admin_day") return { data: { date: feed.feed_date, days: [feed.feed_date], feed,
            events: [{ card: feed.cards[0].id, kind: "read", ms: 42000 }, { card: feed.cards[1].id, kind: "read", ms: 6000 },
                     { card: "seg-1", kind: "time", ms: 300000, answer: JSON.stringify({ why: "away", start: "2026-09-28T23:00:00Z" }) },
                     { card: "seg-2", kind: "time", ms: 360000, answer: JSON.stringify({ why: "finish", start: "2026-09-28T23:20:00Z" }) }, { card: feed.cards[0].id, kind: "check", correct: false, choice: (feed.cards[0].check.a + 1) % 4 },
                     { card: feed.cards[0].id, kind: "opinion", answer: "Reopen the route first, gas prices hurt families.", score: 2 }, { card: "s1", kind: "reflect", answer: "Easier one-on-one." }],
            report: { date: "2026-09-29", summary: "Read 10 of 10.", knowledge: "Solid on trade basics; mixes up refining and shipping.", plan: "More supply-chain cards this week.", notes: [{ card_id: feed.cards[0].id, note: "Confused refining with shipping routes." }] } } };
          if (fn === "brief_admin_set_goals") { window.__GOALS = args; return { data: [] }; }
          return { data: null };
        },
        from: q,
        functions: { invoke: async (fn, o) => { window.__INVOKES = (window.__INVOKES || []).concat([{ fn, body: o && o.body }]); return { data: { ok: true, status: "invited" } }; } }
      };
    }
  };
})();
