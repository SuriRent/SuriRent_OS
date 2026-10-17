# Iter116 UI: repeat kasgeld save N times, record ktp-remote-print-done/ktp-toast events; checks race fix
await page.set_viewport_size({"width": 390, "height": 844})
B = "https://vastgoed-app.preview.emergentagent.com"
N = __N__
TAG = "__TAG__"
await page.add_init_script("""
window.__ev = [];
const t0 = Date.now();
window.addEventListener('ktp-remote-print-done', e => window.__ev.push({t: Date.now(), k: 'done', job: e.detail && e.detail.job_id, ok: e.detail && e.detail.ok, p: e.detail && e.detail.printer}));
window.addEventListener('ktp-toast', e => window.__ev.push({t: Date.now(), k: 'toast', ok: e.detail.ok, msg: e.detail.msg}));
""")
resp_log = []
async def on_resp(r):
    if "/remote-print" in r.url:
        ts = await page.evaluate("Date.now()")
        try:
            j = await r.json()
        except Exception:
            j = {}
        resp_log.append((ts, r.status, j.get("job_id")))
page.on("response", on_resp)
try:
    await page.goto(B + "/my-awesome-rentals-bv/kiosk", wait_until="commit")
    await page.wait_for_timeout(4000)
    if await page.locator('[data-testid="keypad-4"]').count():
        for k in "4321":
            await page.click(f'[data-testid="keypad-{k}"]')
            await page.wait_for_timeout(150)
        await page.wait_for_timeout(3000)
    await page.click('[data-testid="kiosk-mobile-fab"]', force=True)
    await page.wait_for_timeout(800)
    await page.click('[data-testid="kiosk-tile-kasgeld"]', force=True)
    await page.wait_for_selector('[data-testid="kasgeld-new-btn"]', timeout=15000)
    await page.wait_for_timeout(2500)
    results = []
    for i in range(N):
        await page.click('[data-testid="kasgeld-new-btn"]', force=True)
        await page.wait_for_selector('[data-testid="kasgeld-form"]', timeout=5000)
        await page.click('[data-testid="kasgeld-type-out"]', force=True)
        for k in "12":
            await page.click(f'[data-testid="kasgeld-npad-key-{k}"]', force=True)
            await page.wait_for_timeout(80)
        await page.click('[data-testid="kasgeld-next-btn"]', force=True)
        await page.wait_for_selector('[data-testid="kasgeld-input-desc"]', timeout=5000)
        await page.fill('[data-testid="kasgeld-input-desc"]', f"TEST_iter116 {TAG} run{i}")
        await page.click('[data-testid="kasgeld-save"]', force=True)
        await page.wait_for_selector('[data-testid="kasgeld-receipt-screen"]', timeout=15000)
        ok_txt = None
        try:
            await page.wait_for_selector('[data-testid="ktp-print-toast-ok"]', timeout=6000)
            await page.wait_for_timeout(1200)
            ok_txt = await page.text_content('[data-testid="ktp-print-toast-msg"]')
        except Exception:
            pass
        ktp_btn = page.locator('[data-testid="kasgeld-print-ktp"]')
        btn_done = await ktp_btn.evaluate("e => !!e.querySelector('svg.lucide-circle-check-big, svg.lucide-check-circle-2, svg.lucide-circle-check')") if await ktp_btn.count() else None
        err = await page.locator('[data-testid="ktp-print-toast-error"]').count()
        results.append((i, ok_txt, err, btn_done))
        print(f"run{i}: toast_ok={ok_txt!r} err_toast={err} ktp_btn_done_icon={btn_done}")
        if i == 0:
            await page.screenshot(path=f".screenshots/i116_{TAG}_run0.jpg", quality=40, full_page=False)
        for tid in ["ktp-print-toast-ok", "ktp-print-toast-error"]:
            if await page.locator(f'[data-testid="{tid}"]').count():
                await page.click(f'[data-testid="{tid}"]', force=True)
        await page.click('[data-testid="kasgeld-receipt-done"]', force=True)
        await page.wait_for_timeout(1500)
    print("waiting 22s for any late 'Geen antwoord'...")
    await page.wait_for_timeout(22000)
    ev = await page.evaluate("window.__ev")
    toasts = [e for e in ev if e["k"] == "toast"]
    print("ALL toast events:", [(e["ok"], e["msg"]) for e in toasts])
    print("false 'Geen antwoord':", sum(1 for e in toasts if "Geen antwoord" in (e["msg"] or "")))
    # race analysis: ack before HTTP response?
    first_done = {}
    for e in ev:
        if e["k"] == "done" and e["job"] not in first_done:
            first_done[e["job"]] = e["t"]
    early = 0
    for t, st, job in resp_log:
        if job in first_done:
            d = first_done[job] - t
            if d < 0:
                early += 1
    print(f"remote-print responses: {len(resp_log)}, acks arriving BEFORE HTTP response: {early}")
    print("done events per job:", {j: sum(1 for e in ev if e['k']=='done' and e['job']==j) for j in first_done})
except Exception as e:
    print("ERR", e)
    await page.screenshot(path=".screenshots/i116_err.jpg", quality=40, full_page=False)
