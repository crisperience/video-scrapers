const { chromium, devices } = require('playwright');
// Example phone or desktop device to emulate
const iPhone = devices['iPhone 13 Pro'];

(async () => {
    // Keep headless: true
    const browser = await chromium.launch({
        headless: true, args: [
            '--disable-blink-features=AutomationControlled'
        ]
    });

    // Use a genuine User-Agent and device profile
    const context = await browser.newContext({
        ...iPhone,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:104.0) Gecko/20100101 Firefox/104.0',
        // Some websites look at timezone, language, etc.
        locale: 'en-US',
        timezoneId: 'Europe/Berlin'
    });

    // Hide webdriver flag
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const page = await context.newPage();

    // Random delay function
    async function humanDelay(min = 1000, max = 3000) {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        await page.waitForTimeout(ms);
    }

    // Example flow
    await page.goto('https://www.natomultimedia.tv/app/search?s.q=&s.o=date&s.g=1', { waitUntil: 'domcontentloaded' });
    await humanDelay();
    // Interact with the page so Cloudflare sees "human" signals
    await page.click('button[data-target="#login"]');
    await page.fill('input#f49', 'martin@crisp.hr');
    await page.fill('input#f50', '20wVUSDwZR7Jkk9Y');
    await humanDelay();
    await page.click('button[name="login@action"]');

    // Possibly wait for a known post-login element to appear
    await page.waitForSelector('.some-post-login-element', { timeout: 60000 });

    // Continue your scraping...

    await browser.close();
})();