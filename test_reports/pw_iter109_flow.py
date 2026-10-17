# Shared Playwright flow body for iter109 (printer options per device). Paste into browser_automation.
await page.set_viewport_size({"width": 390, "height": 844})
prints = []
await page.expose_function("__logPrint", lambda: prints.append(1))
await page.add_init_script("window.print = () => { window.__logPrint && window.__logPrint(); };")
await page.add_init_script(INIT_JS)
await page.reload()

async def ids(prefix, exclude=()):
    l = await page.eval_on_selector_all(f'[data-testid^="{prefix}"]', 'els=>els.map(e=>e.dataset.testid+"|"+e.innerText.replace(/\\n/g," ").slice(0,40))')
    return [x for x in l if not any(x.startswith(p) for p in exclude)]

async def login_and_apt(apt):
    await page.wait_for_selector('[data-testid="keypad-4"]', timeout=15000)
    for d in "4321":
        await page.click(f'[data-testid="keypad-{d}"]'); await page.wait_for_timeout(150)
    await page.wait_for_selector('[data-testid^="location-"]', timeout=15000)
    await page.get_by_text("Hoofdvestiging — Paramaribo").click()
    await page.wait_for_selector(f'[data-testid="apt-{apt}"]', timeout=10000)
    await page.click(f'[data-testid="apt-{apt}"]')
    await page.wait_for_timeout(2500)
