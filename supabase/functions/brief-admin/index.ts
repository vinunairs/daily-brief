// Daily Brief — admin actions (Supabase Edge Function "brief-admin").
// Called from the Parent view with the signed-in admin's access token.
//   {action:"add", name, email, age}  → enroll an existing account, or invite a new one by email
//   {action:"update", user_id, name?, age?, active?}  → change a learner's details (age sets the band)
//   {action:"resend", user_id}  → email a fresh link: a new invite if they never finished setup, otherwise a password-reset link
//   {action:"set_password", user_id, password}  → set a temporary password (and confirm the email) so they can sign in without the email link
// New accounts need a Test Prep Hub invite code (the signup trigger requires one), so this creates a single-use code
// and passes it in the invitation.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const SITE = "https://vinunairs.github.io/daily-brief/";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const bandFor = (age: number | null) => age == null ? "challenger" : age <= 10 ? "explorer" : age <= 13 ? "builder" : age <= 18 ? "challenger" : "adult";

async function isAdmin(token: string) {
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u?.user?.email || !u.user.email_confirmed_at) return false;
  const { data } = await admin.from("admins").select("email").ilike("email", u.user.email).maybeSingle();
  return !!data;
}

async function findUserByEmail(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

function newCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => abc[x % abc.length]).join("");
}

// Only people enrolled in Daily Brief can be managed here.
async function learnerUser(userId: string) {
  if (!userId) return null;
  const { data: l } = await admin.from("brief_learners").select("user_id").eq("user_id", userId).maybeSingle();
  if (!l) return null;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) return null;
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(await isAdmin(token))) return json({ error: "Not allowed" }, 403);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (body.action === "add") {
    const name = String(body.name || "").trim().slice(0, 40);
    const email = String(body.email || "").trim().toLowerCase();
    const age = body.age == null || body.age === "" ? null : Math.round(Number(body.age));
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a name and a valid email." }, 400);
    if (age != null && (isNaN(age) || age < 5 || age > 100)) return json({ error: "Age must be between 5 and 100." }, 400);
    let user = await findUserByEmail(email);
    let status = "enrolled";
    if (!user) {
      const code = newCode();
      const { error: ce } = await admin.from("invite_codes").insert({ code, note: "Daily Brief: " + name });
      if (ce) return json({ error: "Couldn't create an invite code: " + ce.message }, 500);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: SITE, data: { invite_code: code, first_name: name } });
      if (error || !data?.user) return json({ error: "Couldn't send the invitation: " + (error?.message || "unknown error") }, 500);
      user = data.user;
      status = "invited";
    }
    const { error: le } = await admin.from("brief_learners").upsert(
      { user_id: user.id, display_name: name, age, band: bandFor(age), active: true, updated_at: new Date().toISOString() },
      { onConflict: "user_id" });
    if (le) return json({ error: "Couldn't add them to Daily Brief: " + le.message }, 500);
    return json({ ok: true, status, band: bandFor(age) });
  }

  if (body.action === "update") {
    // deno-lint-ignore no-explicit-any
    const patch: any = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string" && body.name.trim()) patch.display_name = body.name.trim().slice(0, 40);
    if (body.age !== undefined) {
      const age = body.age == null || body.age === "" ? null : Math.round(Number(body.age));
      if (age != null && (isNaN(age) || age < 5 || age > 100)) return json({ error: "Age must be between 5 and 100." }, 400);
      patch.age = age; patch.band = bandFor(age);
    }
    if (typeof body.active === "boolean") patch.active = body.active;
    const { error } = await admin.from("brief_learners").update(patch).eq("user_id", body.user_id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, band: patch.band });
  }

  if (body.action === "resend") {
    const user = await learnerUser(String(body.user_id || ""));
    if (!user?.email) return json({ error: "That person isn't in Daily Brief." }, 404);
    if (!user.email_confirmed_at) {
      const { error } = await admin.auth.admin.inviteUserByEmail(user.email, { redirectTo: SITE, data: user.user_metadata || {} });
      if (!error) return json({ ok: true, status: "invite", email: user.email });
    }
    const { error: re } = await anon.auth.resetPasswordForEmail(user.email, { redirectTo: SITE });
    if (re) return json({ error: "Couldn't send the email: " + re.message }, 500);
    return json({ ok: true, status: "reset", email: user.email });
  }

  if (body.action === "set_password") {
    const password = String(body.password || "");
    if (password.length < 8) return json({ error: "Use at least 8 characters." }, 400);
    const user = await learnerUser(String(body.user_id || ""));
    if (!user) return json({ error: "That person isn't in Daily Brief." }, 404);
    const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) return json({ error: "Couldn't set the password: " + error.message }, 500);
    return json({ ok: true, email: user.email });
  }

  return json({ error: "Unknown action" }, 400);
});
