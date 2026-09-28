"""End-to-end check of the Daily Brief page in headless Chromium, with Supabase stubbed out.
Run: python3 test/run.py   (from the repo root)"""
import json, pathlib, sys, http.server, threading, functools
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FEED = json.loads((ROOT / "docs/feeds/2026-09-28.json").read_text())
# Swap the two skill cards for growth cards and add a mission check-in, to exercise the newer card types.
FEED["cards"][5] = {"id": "s1", "type": "skill", "kind": "conversation", "cat": "skills", "title": "Joining a group conversation",
  "body": "Walking up to a group that's already talking is hard for most people.", "lines": ["Wait, are you talking about the game last night?", "What did I miss?"],
  "mission": "Join one group conversation today with a question.", "reflect": "When do you feel most comfortable talking to new people?"}
FEED["cards"][9] = {"id": "s2", "type": "skill", "kind": "jargon", "cat": "skills", "title": "Money words you'll hear",
  "body": "Three terms from this week's news.", "terms": [{"term": "Yield", "means": "The return you earn on a bond.", "example": "The 10-year yield hit 5.2%."}],
  "check": {"q": "A bond's yield is...", "o": ["its return", "its color", "its owner", "its age"], "a": 0, "e": "Yield is the return."}}
FEED["cards"][0]["say"] = "Did you see gas might go up again?"
FEED["extras"] = {"mission_checkin": {"text": "Ask a teacher one question after class.", "ref": "2026-09-27"}}
STUB = (ROOT / "test/supabase-stub.js").read_text()
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "test/out"
OUT.mkdir(parents=True, exist_ok=True)

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []

def page_for(b, mode, dark=False):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, color_scheme="dark" if dark else "light")
    p = ctx.new_page()
    errs = []
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.on("console", lambda m: m.type == "error" and "fonts.g" not in m.text and "ERR_FAILED" not in m.text and errs.append(m.text))
    p.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    p.route("**/js/vendor/supabase-*.js", lambda r: r.fulfill(status=200, content_type="application/javascript",
        body=f"window.__MODE={json.dumps(mode)};window.__FEED={json.dumps(FEED)};" + STUB))
    p.add_init_script("Date.now = (orig => () => orig())(Date.now);")
    p.goto("http://127.0.0.1:8765/index.html")
    return p, errs

with sync_playwright() as pw:
    b = pw.chromium.launch()
    # signed out
    p, errs = page_for(b, "signedout")
    p.wait_for_selector("form.auth")
    p.screenshot(path=str(OUT / "signin.png"))
    if errs: fails.append(("signin", errs))

    # learner flow: home -> deck through all cards -> quiz -> finish -> home mission check-in
    p, errs = page_for(b, "learner")
    p.wait_for_selector(".cta")
    p.screenshot(path=str(OUT / "home.png"), full_page=True)
    p.locator(".cta").click()
    p.wait_for_selector(".slide .shead")
    p.wait_for_timeout(400); p.screenshot(path=str(OUT / "deck-card.png"))
    first = FEED["cards"][0]
    for i, c in enumerate(FEED["cards"]):
        p.wait_for_selector(f"#c-{c['id']}")
        slide = p.locator(f"#c-{c['id']}")
        if c.get("check"):
            if i == 0: slide.locator(".opt", has_text=c["check"]["o"][c["check"]["a"]][:30]).click()
            else: slide.locator(".opt").first.click()
            p.wait_for_selector(f"#c-{c['id']} .opt.right")
        if i == 0:
            slide.locator(".talk:not(.reflect) textarea").fill("I think reopening the route matters more now because gas prices hurt families.")
            slide.locator("button", has_text="Save my take").click()
            p.wait_for_selector(f"#c-{c['id']} .saved")
            p.screenshot(path=str(OUT / "deck-answered.png"))
        if c.get("reflect"):
            slide.locator(".reflect textarea").fill("Mostly when I'm with one friend I already know.")
            slide.locator(".reflect button", has_text="Save").click()
            p.wait_for_selector(f"#c-{c['id']} .reflect .saved")
            p.screenshot(path=str(OUT / "deck-growth.png"))
        p.locator(".deck-bar .grow").click()
    p.wait_for_selector("#quiz")
    for q in FEED["quiz"]:
        p.locator("#quiz .check", has_text=q["q"][:40]).locator(".opt", has_text=q["o"][q["a"]]).click()
        p.wait_for_timeout(150)
    p.screenshot(path=str(OUT / "deck-quiz.png"))
    p.locator(".deck-bar .grow", has_text="Finish").click()
    p.wait_for_selector(".g-finish")
    p.wait_for_timeout(300)
    p.screenshot(path=str(OUT / "deck-finish.png"))
    p.locator(".deck-bar .grow", has_text="Back to home").click()
    p.wait_for_selector(".checkin")
    p.locator(".checkin button", has_text="Did it").click()
    p.wait_for_selector(".checkin .small")
    p.screenshot(path=str(OUT / "home-done.png"), full_page=True)
    ev = p.evaluate("window.__EVENTS")
    kinds = {}
    for e in ev: kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print("events:", kinds, "points:", sum(e.get("points", 0) for e in ev))
    if kinds.get("read") != 10 or kinds.get("check") != sum(1 for c in FEED["cards"] if c.get("check")) or kinds.get("recall") != 3 or kinds.get("opinion") != 1 or kinds.get("bonus") != 1 or kinds.get("reflect") != 1 or kinds.get("mission") != 1:
        fails.append(("events", kinds))
    if not all(e["correct"] for e in ev if e["kind"] == "recall"): fails.append(("recall should be correct", ev))
    first_check = [e for e in ev if e["kind"] == "check" and e["card_id"] == first["id"]][0]
    if not first_check["correct"] or first_check["choice"] != first["check"]["a"]: fails.append(("first check mapping", first_check))
    if errs: fails.append(("learner", errs))

    # parent view + preview, dark mode
    p, errs = page_for(b, "parent", dark=True)
    p.wait_for_selector(".kid")
    p.screenshot(path=str(OUT / "parent.png"), full_page=True)
    p.locator(".goalsbox summary").click()
    p.locator(".addgoal input").fill("Handling disagreements calmly")
    p.locator(".addgoal button").click()
    p.locator(".goalsbox button", has_text="Save goals").click()
    p.wait_for_function("window.__GOALS && window.__GOALS.p_goals.length === 3")
    p.screenshot(path=str(OUT / "parent-goals.png"), full_page=True)
    p.locator("button", has_text="See his answers").click()
    p.wait_for_selector(".card.ans .note")
    if not p.locator(".his.wrong").count() or not p.locator(".plan").count(): fails.append(("answers view", 1))
    p.screenshot(path=str(OUT / "parent-answers.png"), full_page=True)
    p.locator("button", has_text="Back").click()
    p.wait_for_selector(".kid")
    p.locator("button", has_text="Preview").click()
    p.wait_for_selector(".preview-banner")
    p.locator(".cta").click()
    p.wait_for_selector(".slide .shead")
    p.screenshot(path=str(OUT / "parent-preview.png"))
    if "Done" in p.locator(".deck-bar .grow").inner_text(): fails.append(("preview shows Done button", 1))
    if errs: fails.append(("parent", errs))
    b.close()
srv.shutdown()
print("FAIL" if fails else "PASS", fails)
sys.exit(1 if fails else 0)
