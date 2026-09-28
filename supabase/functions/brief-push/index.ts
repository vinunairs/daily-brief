// Daily Brief — daily notification (Supabase Edge Function "brief-push").
// POST {mode:"test"} with the signed-in user's access token → sends a test notification to that user's devices.
// POST {mode:"cron"} with header x-cron-secret → hourly job: sends each subscriber one notification at
// their chosen local hour, once today's brief exists, unless they've already read it.
// Reuses the VAPID keys and cron secret in public.app_secrets (shared with Test Prep Hub's reminders).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const SITE = "https://vinunairs.github.io/daily-brief/";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

let appServer: webpush.ApplicationServer | null = null;
let cronSecret = "";
async function getServer() {
  if (appServer) return appServer;
  const { data, error } = await admin.from("app_secrets").select("name, value");
  if (error || !data) throw new Error("Could not load server settings");
  const m = Object.fromEntries(data.map((r: { name: string; value: string }) => [r.name, r.value]));
  cronSecret = m.cron_secret;
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(m.vapid_keys), { extractable: false });
  appServer = await webpush.ApplicationServer.new({ contactInformation: m.vapid_contact, vapidKeys });
  return appServer;
}

function localParts(tz: string, d = new Date()) {
  try {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(d)) % 24;
    return { date, hour };
  } catch {
    return localParts("America/New_York", d);
  }
}

async function status(userId: string, date: string) {
  const [{ data: feed }, { count }, { data: learner }, { data: stats }] = await Promise.all([
    admin.from("brief_feeds").select("headline, cards").eq("user_id", userId).eq("feed_date", date).maybeSingle(),
    admin.from("brief_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("feed_date", date).eq("kind", "read"),
    admin.from("brief_learners").select("display_name, active").eq("user_id", userId).maybeSingle(),
    admin.rpc("brief_streak_for", { p_user: userId }),
  ]);
  return { feed, read: count || 0, name: learner?.display_name || "", active: !!learner?.active, streak: Number(stats) || 0 };
}

function compose(s: Awaited<ReturnType<typeof status>>, hour: number, test = false) {
  const hi = s.name ? ", " + s.name : "";
  const total = s.feed?.cards?.length || 10;
  let title: string, body: string;
  if (!s.feed) { title = `Daily Brief${hi}`; body = "Today's brief is on its way. Check back soon."; }
  else if (hour < 12) {
    title = s.streak > 0 ? `Keep your ${s.streak}-day streak${hi} 🔥` : `Your Daily Brief is ready${hi}`;
    body = (s.feed.headline || "Today's news, a reasoning workout and a life skill.") + ` · ${total} cards, about 10 minutes.`;
  } else {
    title = s.read > 0 ? `${total - s.read} cards left${hi}` : `Your brief is waiting${hi}`;
    body = (s.streak > 0 ? `Don't lose your ${s.streak}-day streak. ` : "") + (s.feed.headline || "Ten minutes is all it takes.");
  }
  if (test) { title = `Notifications are on${hi}`; body = "You'll get one of these each day when your brief is ready."; }
  return { title, body };
}

// deno-lint-ignore no-explicit-any
async function sendTo(sub: any, payload: object) {
  const server = await getServer();
  try {
    await server.subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }).pushTextMessage(JSON.stringify(payload), {});
    return "sent";
  } catch (e) {
    const msg = String(e?.message || e);
    if (/\b(404|410)\b/.test(msg) || e?.isGone?.()) { await admin.from("brief_push_subscriptions").delete().eq("id", sub.id); return "removed"; }
    console.error("push failed", sub.id, msg);
    return "failed";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: { mode?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  await getServer();

  if (body.mode === "test") {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json({ error: "Sign in first" }, 401);
    const { data: subs } = await admin.from("brief_push_subscriptions").select("*").eq("user_id", u.user.id).eq("enabled", true);
    if (!subs?.length) return json({ error: "No devices have notifications turned on" }, 404);
    const results = [];
    for (const s of subs) {
      const { date, hour } = localParts(s.tz);
      const c = compose(await status(s.user_id, date), hour, true);
      results.push(await sendTo(s, { title: c.title, body: c.body, url: SITE, tag: "brief-test" }));
    }
    return json({ ok: true, results });
  }

  if (body.mode === "cron") {
    if (req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "Not allowed" }, 401);
    const { data: subs } = await admin.from("brief_push_subscriptions").select("*").eq("enabled", true);
    let sent = 0, skipped = 0;
    for (const s of subs || []) {
      const { date, hour } = localParts(s.tz);
      if (s.last_sent_on === date || hour < s.remind_hour || hour > s.remind_hour + 3) continue; // 3-hour window in case the brief is late
      const st = await status(s.user_id, date);
      if (!st.active) continue;
      if (!st.feed) { skipped++; continue; }                 // brief not written yet: try again next hour
      await admin.from("brief_push_subscriptions").update({ last_sent_on: date }).eq("id", s.id);
      if (st.read >= (st.feed.cards?.length || 10)) { skipped++; continue; } // already finished today
      const c = compose(st, hour);
      if ((await sendTo(s, { title: c.title, body: c.body, url: SITE + "?from=notify", tag: "brief-daily" })) === "sent") sent++;
    }
    return json({ ok: true, sent, skipped });
  }

  return json({ error: "Unknown mode" }, 400);
});
