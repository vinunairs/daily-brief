"""End-to-end check of the Daily Brief page in headless Chromium, with Supabase stubbed out.
Run: python3 test/run.py   (from the repo root)"""
import json, pathlib, sys, http.server, threading, functools
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FEED = json.loads((ROOT / "docs/feeds/2026-09-28.json").read_text())
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

    # learner flow
    p, errs = page_for(b, "learner")
    p.wait_for_selector(".card.open")
    p.screenshot(path=str(OUT / "learner-top.png"))
    first = FEED["cards"][0]
    right = first["check"]["o"][first["check"]["a"]]
    p.locator(".card.open .opt", has_text=right[:30]).click()
    p.wait_for_selector(".card.open .opt.right")
    p.locator(".card.open textarea").fill("I think reopening the route matters more now because gas prices hurt families.")
    p.locator(".card.open button", has_text="Save my take").click()
    p.wait_for_selector(".card.open .saved")
    p.screenshot(path=str(OUT / "learner-card-answered.png"), full_page=False)
    # read all cards: answer wrong where possible, then Done
    for i, c in enumerate(FEED["cards"]):
        card = p.locator(f"#c-{c['id']}")
        if "open" not in (card.get_attribute("class") or ""):
            card.locator(".head").click()
        if c.get("check") and card.locator(".opt:not([disabled])").count():
            card.locator(".opt").first.click()
            p.wait_for_selector(f"#c-{c['id']} .opt.right")
        card.locator("button.btn.signal, button.btn.ghost.block").first.click()
        p.wait_for_selector(f"#c-{c['id']}.done")
    p.wait_for_selector("#quiz .card")
    for q in FEED["quiz"]:
        p.locator("#quiz .card", has_text=q["q"][:40]).locator(".opt", has_text=q["o"][q["a"]]).click()
    p.wait_for_selector(".finish")
    p.screenshot(path=str(OUT / "learner-done.png"), full_page=True)
    ev = p.evaluate("window.__EVENTS")
    kinds = {}
    for e in ev: kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print("events:", kinds, "points:", sum(e.get("points", 0) for e in ev))
    if kinds.get("read") != 10 or kinds.get("check") != 10 or kinds.get("recall") != 3 or kinds.get("opinion") != 1 or kinds.get("bonus") != 1:
        fails.append(("events", kinds))
    if not all(e["correct"] for e in ev if e["kind"] == "recall"): fails.append(("recall should be correct", ev))
    first_check = [e for e in ev if e["kind"] == "check" and e["card_id"] == first["id"]][0]
    if not first_check["correct"] or first_check["choice"] != first["check"]["a"]: fails.append(("first check mapping", first_check))
    if errs: fails.append(("learner", errs))

    # parent view + preview, dark mode
    p, errs = page_for(b, "parent", dark=True)
    p.wait_for_selector(".kid")
    p.screenshot(path=str(OUT / "parent.png"), full_page=True)
    p.locator("button", has_text="Preview").click()
    p.wait_for_selector(".preview-banner")
    p.screenshot(path=str(OUT / "parent-preview.png"))
    if p.locator(".btn.signal").count(): fails.append(("preview shows Done button", 1))
    if errs: fails.append(("parent", errs))
    b.close()
srv.shutdown()
print("FAIL" if fails else "PASS", fails)
sys.exit(1 if fails else 0)
