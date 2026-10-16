await page.set_viewport_size({"width": 390, "height": 844})
MEASURE = """() => Array.from(document.querySelectorAll('[data-testid^="history-row-"]')).map(r => {
  const id = r.dataset.testid.replace('history-row-','');
  const cs = getComputedStyle(r);
  const info = r.children[1];
  const right = r.children[2];
  const wa = document.querySelector(`[data-testid="history-whatsapp-${id}"]`);
  const pr = document.querySelector(`[data-testid="history-print-${id}"]`);
  const ri = info.getBoundingClientRect(), rr = right.getBoundingClientRect(), rw = wa?.getBoundingClientRect(), rp = pr?.getBoundingClientRect();
  const truncated = Array.from(info.querySelectorAll('*')).some(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible');
  const vis = (el) => el ? Array.from(el.querySelectorAll('span')).filter(s => s.offsetParent !== null).map(s=>s.textContent.trim()) : null;
  return {id, display: cs.display, dir: cs.flexDirection, align: cs.alignItems,
    infoRight: Math.round(ri.right), btnLeft: Math.round(rr.left), overlap: ri.right > rr.left + 0.5,
    infoCenter: Math.round(ri.top + ri.height/2), btnCenter: Math.round(rr.top + rr.height/2),
    wa: rw && {w: rw.width, h: rw.height, top: rw.top, radius: getComputedStyle(wa).borderRadius, text: wa.innerText.trim()},
    pr: rp && {w: rp.width, h: rp.height, top: rp.top, left: rp.left, waRight: rw && rw.right, radius: getComputedStyle(pr).borderRadius, text: pr.innerText.trim(), chevronVisible: !!Array.from(pr.querySelectorAll('svg')).find((s,i)=> i>0 && s.getBoundingClientRect().width>0)},
    truncated, infoText: info.innerText.replace(/\\n/g,' | '), docOverflowX: document.documentElement.scrollWidth > window.innerWidth};
})"""
try:
    await page.wait_for_selector('[data-testid="keypad-4"]', timeout=10000)
    for d in "4321":
        await page.click(f'[data-testid="keypad-{d}"]')
        await page.wait_for_timeout(200)
    await page.wait_for_selector('[data-testid="location-9de8cddc-0a97-4fce-aa2f-bde90aa93484"]', timeout=15000)
    await page.click('[data-testid="location-9de8cddc-0a97-4fce-aa2f-bde90aa93484"]')
    await page.wait_for_timeout(2000)
    await page.click('[data-testid="apt-HUIS 1B"]')
    await page.wait_for_timeout(3000)
    btn = page.locator('[data-testid="overview-history-btn"]:visible').first
    await btn.click()
    await page.wait_for_selector('[data-testid^="history-row-"]', timeout=15000)
    await page.wait_for_timeout(1000)
    print("PASS history modal opened")
    res = await page.evaluate(MEASURE)
    for r in res: print("MOBILE", r)
    await page.screenshot(path=".screenshots/hist_mobile.png", quality=40, full_page=False)
    pid = res[0]["id"]
    # Print menu
    await page.click(f'[data-testid="history-print-{pid}"]')
    await page.wait_for_timeout(1000)
    print("print menu visible:", await page.is_visible(f'[data-testid="history-print-menu-{pid}"]'))
    await page.screenshot(path=".screenshots/hist_menu.png", quality=40, full_page=False)
    await page.click(f'[data-testid="history-print-menu-backdrop-{pid}"]', force=True)
    await page.wait_for_timeout(500)
    # WhatsApp
    await page.click(f'[data-testid="history-whatsapp-{pid}"]')
    await page.wait_for_timeout(4000)
    st = page.locator(f'[data-testid="history-print-status-{pid}"]')
    print("WA status:", await st.inner_text() if await st.count() else "none")
    res = await page.evaluate(MEASURE)
    print("MOBILE after WA", res[0])
    await page.screenshot(path=".screenshots/hist_wa.png", quality=40, full_page=False)
    # Desktop
    await page.set_viewport_size({"width": 1920, "height": 1080})
    await page.wait_for_timeout(1500)
    if await page.locator('[data-testid^="history-row-"]').count() == 0:
        await page.locator('[data-testid="overview-history-btn"]:visible').first.click()
        await page.wait_for_selector('[data-testid^="history-row-"]', timeout=15000)
    res = await page.evaluate(MEASURE)
    for r in res: print("DESKTOP", r)
    await page.screenshot(path=".screenshots/hist_desktop.png", quality=40, full_page=False)
except Exception as e:
    print("ERR", e)
    await page.screenshot(path=".screenshots/hist_err.png", quality=40, full_page=False)
