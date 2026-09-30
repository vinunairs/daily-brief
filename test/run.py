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
FEED["extras"] = {"mission_checkin": {"text": "Ask a teacher one question after class.", "ref": "2026-09-27"},
  "feedback": [{"ref": "2026-09-27", "card_id": "n1", "kind": "opinion", "title": "Should the US reopen the route?", "answer": "Yes because gas is 10 dollars now.", "score": 2,
    "checks": [{"t": "Clear point up front", "ok": True}, {"t": "Gave a reason", "ok": True}, {"t": "Saw the other side", "ok": False}],
    "good": "You led with your answer and backed it with a reason.", "fixes": [{"said": "gas is 10 dollars now", "actually": "The US average was about $3.20 a gallon last week.", "source": {"name": "AAA", "url": "https://gasprices.aaa.com/"}}],
    "next": "Add one 'but' sentence.", "better": "Yes, because higher fuel costs hit families first, but reopening it too fast could raise the risk to ships."},
   {"ref": "2026-09-27", "card_id": "n3", "kind": "question", "title": "Your question to the AI lab", "answer": "Is AI dangerous?", "score": 1, "good": "You picked a big question.", "next": "Make it open and specific."}],
  "bonus": [{"id": "f1", "after": FEED["cards"][0]["id"], "kind": "trivia", "topic": "Pokémon", "q": "Which type is strong against Water?", "o": ["Fire", "Grass", "Rock", "Ground"], "a": 1, "e": "Grass beats Water."},
            {"id": "f2", "after": "s1", "kind": "joke", "topic": "Drumming", "setup": "Why did the drummer bring a ladder?", "punch": "To reach the high hats."},
            {"id": "f3", "after": FEED["cards"][7]["id"], "kind": "fact", "topic": "Orchestral music", "text": "Some video-game soundtracks are recorded by full orchestras."}],
  "game": {"type": "realfake", "after": FEED["cards"][3]["id"], "items": [{"text": "Starship reaches orbit", "real": True, "e": "Happened Sept 28."}, {"text": "Florida bans flip-flops", "real": False, "e": "Made up."}, {"text": "US and China cut some tariffs", "real": True, "e": "Real."}]},
  "week": {"win": "Your quick-check accuracy on money stories went from 50% to 80%.", "focus": "Give a reason in every take.", "facts": ["A tariff is a tax on imports, paid by the importer."]}}
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
    p.goto("http://127.0.0.1:8765/index.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"); p.reload()
    p.wait_for_selector("form.auth .linkerr")
    if "expired" not in p.locator(".linkerr").inner_text(): fails.append(("expired link msg", 0))
    p.screenshot(path=str(OUT / "signin-expired.png"))
    if errs: fails.append(("signin", errs))

    # learner flow: home -> deck through all cards -> quiz -> finish -> home mission check-in
    p, errs = page_for(b, "learner")
    p.wait_for_selector(".steps .step")
    p.screenshot(path=str(OUT / "home.png"), full_page=True)
    p.locator(".tab", has_text="My progress").click()
    p.wait_for_selector(".skillmap .sk")
    p.wait_for_timeout(200); p.screenshot(path=str(OUT / "progress.png"), full_page=True)
    if p.locator(".skillmap .sk").count() != 7 or p.locator(".bdg.on").count() < 3: fails.append(("progress", p.locator(".bdg.on").count()))
    p.locator(".tab", has_text="Today").click(); p.wait_for_selector(".steps .step")
    if p.locator(".steps .step").count() != 2: fails.append(("two steps", p.locator(".steps .step").count()))
    p.locator(".step", has_text="Review yesterday").click()
    p.wait_for_selector(".fb .fbi[open] .fix")
    if not p.locator(".wkrev").count(): fails.append(("week review", 0))
    p.locator(".fb").screenshot(path=str(OUT / "home-feedback.png"))
    p.locator(".fb .fbi").first.locator("button", has_text="Got it").click()
    p.wait_for_selector(".fb .fbi.done")
    p.screenshot(path=str(OUT / "review.png"), full_page=True)
    p.locator(".revtop button", has_text="Home").click()
    p.wait_for_selector(".steps")
    p.locator(".step", has_text="brief").click()
    p.wait_for_selector(".slide .shead")
    p.wait_for_timeout(400); p.screenshot(path=str(OUT / "deck-card.png"))
    # Done is blocked until the check is answered
    if "Answer the quick check" not in p.locator(".deck-bar .grow").inner_text(): fails.append(("check not required", 1))
    p.locator("#timerPill").click()
    p.wait_for_selector(".pausebox")
    p.screenshot(path=str(OUT / "paused.png"))
    p.locator(".pausebox button", has_text="Resume").click()
    first = FEED["cards"][0]
    def extras_slides():
        for _ in range(3):
            p.wait_for_timeout(150)
            if p.locator("#f-f1").count():
                p.locator("#f-f1 .opt", has_text="Grass").click(); p.wait_for_selector("#f-f1 .opt.right")
                p.screenshot(path=str(OUT / "fun-trivia.png")); p.locator(".deck-bar .grow").click()
            elif p.locator("#f-f2").count():
                p.locator("#f-f2 .reveal").click(); p.locator("#f-f2 button", has_text="Ha").click(); p.wait_for_selector("#f-f2 .punch")
                p.screenshot(path=str(OUT / "fun-joke.png")); p.locator(".deck-bar .grow").click()
            elif p.locator("#f-f3").count():
                p.locator(".deck-bar .grow").click()  # skip one
            elif p.locator("#game-slide").count():
                p.locator("#game-slide button", has_text="Start").click()
                for want in ["Real", "Fake", "Fake"]:
                    p.wait_for_selector("#game-slide .gcard"); p.locator("#game-slide .gbtns button", has_text=want).click(); p.wait_for_timeout(1700)
                p.wait_for_selector("#game-slide .gover"); p.screenshot(path=str(OUT / "game-over.png"))
                p.wait_for_timeout(1800); p.locator(".deck-bar .grow").click()
            else: return
    for i, c in enumerate(FEED["cards"]):
        extras_slides()
        p.wait_for_selector(f"#c-{c['id']}")
        slide = p.locator(f"#c-{c['id']}")
        if c.get("check"):
            if i == 0: slide.locator(".opt", has_text=c["check"]["o"][c["check"]["a"]][:30]).click()
            else: slide.locator(".opt").first.click()
            p.wait_for_selector(f"#c-{c['id']} .opt.right")
        if i == 0:
            slide.locator(".talk:not(.reflect) textarea").fill("I think reopening the route matters more now because gas prices hurt families.")
            if not slide.locator(".tips.live").count(): fails.append(("live tips", 0))
            slide.locator("button", has_text="Save my take").click()
            p.wait_for_selector(f"#c-{c['id']} .saved")
            p.screenshot(path=str(OUT / "deck-answered.png"))
            slide.locator(".rx", has_text="More like this").click()
            p.wait_for_selector(f"#c-{c['id']} .rx.on")
            slide.locator(".word").first.click()
            p.wait_for_selector(f"#c-{c['id']} .defbox:not([hidden])")
            slide.locator(".catchup summary").click()
            slide.locator(".helpbtn").click()
            p.wait_for_selector(f"#c-{c['id']} .simple")
            slide.locator(".help textarea").fill("What is a Treasury bond?")
            slide.locator(".help button", has_text="Ask").click()
            p.wait_for_selector(f"#c-{c['id']} .asked")
            p.locator(".slide").evaluate("n => n.scrollTo(0, 0)")
            p.screenshot(path=str(OUT / "deck-help.png"), full_page=False)
        if c.get("curious"):
            slide.locator(".curious textarea").fill("How do you test an AI that might trick the test?")
            slide.locator(".curious button", has_text="Save my question").click()
            p.wait_for_selector(f"#c-{c['id']} .curious .saved")
        if c.get("speak"):
            if not slide.locator(".speak .mic").count(): fails.append(("speak missing", c["id"]))
        if c.get("reflect"):
            slide.locator(".reflect textarea").fill("Mostly when I'm with one friend I already know.")
            slide.locator(".reflect button", has_text="Save").click()
            p.wait_for_selector(f"#c-{c['id']} .reflect .saved")
            p.screenshot(path=str(OUT / "deck-growth.png"))
        p.locator(".deck-bar .grow").click()
    extras_slides()
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
    p.wait_for_selector(".step.done")
    p.locator(".step", has_text="Review yesterday").click()
    p.wait_for_selector(".checkin")
    p.locator(".checkin button", has_text="Did it").click()
    p.wait_for_selector(".checkin .small")
    while p.locator(".fbi:not(.done)").count():
        it = p.locator(".fbi:not(.done)").first
        if not it.get_attribute("open") is not None: it.locator("summary").click()
        it.locator("button", has_text="Got it").click(); p.wait_for_timeout(300)
    p.locator(".revtop button", has_text="Home").click(); p.wait_for_selector(".steps")
    if p.locator(".step.done").count() != 2: fails.append(("both steps done", p.locator(".step.done").count()))
    p.screenshot(path=str(OUT / "home-done.png"), full_page=True)
    ev = p.evaluate("window.__EVENTS")
    import json as _j
    tev = [e for e in ev if e["kind"] == "time"]
    if not tev or "why" not in _j.loads(tev[0].get("answer") or "{}"): fails.append(("time segment reason", tev))
    rd = [e for e in ev if e["kind"] == "read"]
    if not all(isinstance(e.get("ms"), int) for e in rd): fails.append(("read ms", rd[:2]))
    kinds = {}
    for e in ev: kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print("events:", kinds, "points:", sum(e.get("points", 0) for e in ev))
    if kinds.get("read") != 10 or kinds.get("check") != sum(1 for c in FEED["cards"] if c.get("check")) or kinds.get("recall") != 3 or kinds.get("opinion") != 1 or kinds.get("bonus") != 1 or kinds.get("reflect") != 1 or kinds.get("mission") != 1 or kinds.get("confused") != 1 or kinds.get("ask") != 1 or kinds.get("question") != 1 or kinds.get("like") != 1 or kinds.get("feedback") != 2 or kinds.get("fun") != 2 or kinds.get("game") != 1:
        fails.append(("events", kinds))
    if not all(e["correct"] for e in ev if e["kind"] == "recall"): fails.append(("recall should be correct", ev))
    g = [e for e in ev if e["kind"] == "game"]
    if g and _j.loads(g[0]["answer"])["score"] != 2: fails.append(("game score", g))
    first_check = [e for e in ev if e["kind"] == "check" and e["card_id"] == first["id"]][0]
    if not first_check["correct"] or first_check["choice"] != first["check"]["a"]: fails.append(("first check mapping", first_check))
    if errs: fails.append(("learner", errs))

    # strict mode: every answer required, no jumping ahead, quiz must be finished
    p, errs = page_for(b, "strict")
    p.wait_for_selector(".steps")
    p.locator(".lineup summary").click(); p.locator(".lineup .tile").nth(5).click()
    p.wait_for_selector(".slide .shead")
    if not p.locator(f"#c-{FEED['cards'][0]['id']}").count(): fails.append(("strict jump-ahead not blocked", 0))
    c0 = FEED["cards"][0]
    p.locator(".slide .opt").first.click(); p.wait_for_selector(".slide .opt.right")
    if c0.get("talk") and "your take" not in p.locator(".deck-bar .grow").inner_text(): fails.append(("strict take required", p.locator(".deck-bar .grow").inner_text()))
    p.screenshot(path=str(OUT / "strict.png"))
    for sel, txt, btn in [(".talk:not(.reflect) textarea", "Reopening matters because gas prices hurt families.", "Save my take"), (".curious textarea", "Why did they choose this plan over the other one?", "Save my question")]:
        if p.locator(".slide " + sel).count():
            p.locator(".slide " + sel).fill(txt); p.locator(".slide button", has_text=btn).click(); p.wait_for_timeout(300)
    if p.locator(".slide .speak").count() and "Done" not in p.locator(".deck-bar .grow").inner_text():
        p.locator(".slide .speak button", has_text="Type it instead").click() if p.locator(".slide .speak button", has_text="Type it instead").is_visible() else None
        p.locator(".slide .speak textarea").fill("Oil prices went up because the route closed, which matters for gas."); p.locator(".slide .speak button", has_text="Save").click(); p.wait_for_timeout(300)
    if "Done" not in p.locator(".deck-bar .grow").inner_text(): fails.append(("strict done after answers", p.locator(".deck-bar .grow").inner_text()))
    if errs: fails.append(("strict", errs))

    # signed in by a link but no password yet → must create one
    p, errs = page_for(b, "nopass")
    p.wait_for_selector("form.auth #npw")
    if "Pick a password" not in p.locator("form.auth h1").inner_text(): fails.append(("nopass screen", 0))
    if errs: fails.append(("nopass", errs))

    # signed in by a link but no password yet → must create one before seeing anything else
    p, errs = page_for(b, "nopass")
    p.wait_for_selector("form.auth #npw")
    if "Pick a password" not in p.locator("form.auth h1").inner_text(): fails.append(("nopass screen", 0))
    p.screenshot(path=str(OUT / "nopass.png"))
    if errs: fails.append(("nopass", errs))

    # focus nudge after ~75 s with no interaction on a card
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    p = ctx.new_page(); nerrs = []
    p.on("pageerror", lambda e: nerrs.append(str(e)))
    p.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    p.route("**/js/vendor/supabase-*.js", lambda r: r.fulfill(status=200, content_type="application/javascript",
        body=f"window.__MODE='learner';window.__FEED={json.dumps(FEED)};" + STUB))
    p.clock.install()
    p.goto("http://127.0.0.1:8765/index.html")
    p.wait_for_selector(".steps"); p.locator(".step", has_text="brief").click(); p.wait_for_selector(".slide .shead")
    p.clock.run_for(80000)
    p.wait_for_selector(".pausebox.nudge")
    p.wait_for_timeout(700); p.screenshot(path=str(OUT / "nudge.png"))
    p.locator(".pausebox.nudge button", has_text="focused").click()
    if p.locator(".pausebox").count(): fails.append(("nudge not dismissed", 0))
    nev = [e for e in p.evaluate("window.__EVENTS") if e["kind"] == "time"]
    if not any('"nudge"' in (e.get("answer") or "") and e.get("ms") == 0 for e in nev): fails.append(("nudge event", nev))
    if nerrs: fails.append(("nudge", nerrs))
    ctx.close()

    # other game types, each on its own
    GAMEFX = {
      "match": {"type": "match", "after": FEED["cards"][0]["id"], "items": [{"term": "Tariff", "means": "A tax on imports"}, {"term": "Orbit", "means": "A path around a planet"}, {"term": "Yield", "means": "The return on a bond"}]},
      "higherlower": {"type": "higherlower", "after": FEED["cards"][0]["id"], "items": [{"a": {"label": "Countries in the UN", "value": 193}, "b": {"label": "Pokémon in the first games", "value": 151}, "e": "193 vs 151."}]},
      "emoji": {"type": "emoji", "after": FEED["cards"][0]["id"], "items": [{"emoji": "🚀🌍🔄", "o": ["Starship reaches orbit", "Tariffs cut", "New park"], "a": 0, "e": "Rocket around Earth."}]}}
    import copy
    for gt, gfx in GAMEFX.items():
        f2 = copy.deepcopy(FEED); f2["extras"] = {"game": gfx}
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        p = ctx.new_page(); gerrs = []
        p.on("pageerror", lambda e: gerrs.append(str(e)))
        p.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        body = f"window.__MODE='learner';window.__FEED={json.dumps(f2)};" + STUB
        p.route("**/js/vendor/supabase-*.js", (lambda body: (lambda r: r.fulfill(status=200, content_type="application/javascript", body=body)))(body))
        p.goto("http://127.0.0.1:8765/index.html", wait_until="domcontentloaded"); p.wait_for_selector(".steps"); p.locator(".step", has_text="brief").click()
        p.wait_for_selector(".slide .shead"); p.locator(".slide .opt").first.click(); p.locator(".deck-bar .grow").click()
        p.wait_for_selector("#game-slide"); p.locator("#game-slide button", has_text="Start").click()
        if gt == "match":
            for it in gfx["items"]:
                p.locator("#game-slide .mb", has_text=it["term"]).click(); p.locator("#game-slide .mb", has_text=it["means"]).click()
            p.screenshot(path=str(OUT / "game-match.png"))
        elif gt == "higherlower":
            p.wait_for_selector(".hl"); p.screenshot(path=str(OUT / "game-hl.png")); p.locator(".hl", has_text="Countries").click()
        else:
            p.wait_for_selector(".emo"); p.screenshot(path=str(OUT / "game-emoji.png")); p.locator(".gopts button", has_text="Starship").click()
        p.wait_for_selector("#game-slide .gover", timeout=8000)
        gev = [e for e in p.evaluate("window.__EVENTS") if e["kind"] == "game"]
        if not gev or json.loads(gev[0]["answer"])["score"] != len(gfx["items"]): fails.append(("game " + gt, gev))
        if gerrs: fails.append(("game " + gt, gerrs))
        ctx.close()

    # parent view + preview, dark mode
    p, errs = page_for(b, "parent", dark=True)
    p.wait_for_selector(".kid")
    p.screenshot(path=str(OUT / "parent.png"), full_page=True)
    if p.locator(".goalsbox summary", has_text="Interests").count() != 1: fails.append(("interests editor", 0))
    p.locator(".goalsbox summary").first.click()
    p.locator(".goalsbox").first.locator(".addgoal input").fill("Handling disagreements calmly")
    p.locator(".goalsbox").first.locator(".addgoal button").click()
    p.locator(".goalsbox button", has_text="Save goals").click()
    p.wait_for_function("window.__GOALS && window.__GOALS.p_goals.length === 3")
    p.screenshot(path=str(OUT / "parent-goals.png"), full_page=True)
    if p.locator(".kid", has_text="Adults' answers and evaluations are private").count() != 1: fails.append(("private adult card", 0))
    p.locator(".addform input").nth(0).fill("Anika")
    p.locator(".addform input").nth(1).fill("anika@example.com")
    p.locator(".addform input").nth(2).fill("8")
    p.locator("button", has_text="Add to Daily Brief").click()
    p.wait_for_function("window.__INVOKES && window.__INVOKES.some(x => x.body && x.body.action === 'add' && x.body.age === 8)")
    p.wait_for_selector("text=Invitation sent")
    p.screenshot(path=str(OUT / "parent-add.png"), full_page=True)
    p.locator("button", has_text="See his answers").click()
    p.wait_for_selector(".card.ans .note")
    p.wait_for_selector(".timing")
    if not p.locator(".fbgiven").count(): fails.append(("parent feedback list", 0))
    p.locator(".timing summary").click()
    if "skimmed" not in p.locator(".timing").inner_text(): fails.append(("timing flags", 0))
    p.locator(".timing").screenshot(path=str(OUT / "parent-timing.png"))
    if not p.locator(".his.wrong").count() or not p.locator(".plan").count(): fails.append(("answers view", 1))
    p.screenshot(path=str(OUT / "parent-answers.png"), full_page=True)
    p.locator("button", has_text="Back").click()
    p.wait_for_selector(".kid")
    p.locator("button", has_text="Preview").click()
    p.wait_for_selector(".preview-banner")
    p.locator(".step", has_text="brief").click()
    p.wait_for_selector(".slide .shead")
    p.screenshot(path=str(OUT / "parent-preview.png"))
    if "Done" in p.locator(".deck-bar .grow").inner_text(): fails.append(("preview shows Done button", 1))
    if errs: fails.append(("parent", errs))
    b.close()
srv.shutdown()
print("FAIL" if fails else "PASS", fails)
sys.exit(1 if fails else 0)
