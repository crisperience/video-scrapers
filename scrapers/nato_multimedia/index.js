// index.js
const { addExtra } = require('playwright-extra');
const playwright = addExtra(require('playwright'));
const stealth = require("puppeteer-extra-plugin-stealth")();
playwright.use(stealth);

const { initBrowser } = require('./initBrowser');
const { saveMetadata, videoExists } = require('../../common/db');
const selectors = require('./selectors');
const logger = require('../../common/logger');
const { randomDelay, retry, USER_AGENT } = require('./utils');

async function login(page) {
    // Navigate to the search page where the login is available
    await page.goto('https://www.natomultimedia.tv/app/search?s.q=&s.o=date&s.g=1&s.g=2&s.l=&s.df=&s.dt=&s.nr=&s.lm=&s.lmi=&s.lmc=&s%40action=search', { waitUntil: 'domcontentloaded' });
    // Add a random delay to simulate human behavior
    await randomDelay();
    // Scroll down to simulate natural user activity
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await randomDelay();
    // Click the login button and wait for the login form to appear
    await page.click(selectors.loginButton);
    await page.waitForSelector(selectors.loginForm);
    // Fill in the login credentials
    await page.fill(selectors.emailField, 'martin@crisp.hr');
    await page.fill(selectors.passwordField, '20wVUSDwZR7Jkk9Y');
    await randomDelay();
    // Submit the login form
    await page.click(selectors.submitButton);
    // Wait for the "User" button to appear, confirming a successful login
    await page.waitForSelector('button#dropdownMenu1', { timeout: 60000 });
    // Optionally wait until the login form is hidden
    await page.waitForSelector(selectors.loginForm, { state: 'hidden', timeout: 30000 });
}

async function getVideos(page) {
    // Navigate to the search page to load video results
    await page.goto('https://www.natomultimedia.tv/app/search?s.q=&s.o=date&s.g=1&s.g=2&s.l=&s.df=&s.dt=&s.nr=&s.lm=&s.lmi=&s.lmc=&s%40action=search', { waitUntil: 'networkidle' });
    await page.waitForSelector(selectors.videoResult);
    // Extract basic video info from the video listing
    const videos = await page.$$eval(selectors.videoResult, els =>
        els.map(el => {
            const link = el.querySelector('a');
            const url = link.href;
            const video_id = url.split('/').pop();
            return { video_id, url };
        })
    );
    return videos.slice(0, 5);
}

async function getVideoMetadata(page, video_url) {
    // Navigate to the video detail page
    await page.goto(video_url, { waitUntil: 'networkidle' });
    await page.waitForSelector(selectors.title);
    // Extract metadata from the page
    const title = await page.$eval(selectors.title, el => el.innerText.trim());
    const description = await page.$eval(selectors.description, el => el.innerText.trim());
    const published_date = await page.$eval(selectors.publishedDate, el => el.innerText.trim());
    const duration = await page.$eval(selectors.duration, el => el.innerText.trim());

    // Click the download dropdown and wait for the full HD download link to appear
    await page.waitForSelector(selectors.downloadDropdown, { timeout: 30000 });
    await page.click(selectors.downloadDropdown);
    await page.waitForSelector(selectors.downloadLinkFullHD, { timeout: 30000 });
    const download_url = await page.$eval(selectors.downloadLinkFullHD, el => el.href).catch(() => 'No download available');

    return { title, description, published_date, duration, download_url };
}

(async () => {
    // Launch the browser using playwright-extra with stealth (headful mode for testing)
    const browser = await playwright.chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled']
    });
    // Create a new context with custom headers to mimic genuine traffic
    const context = await browser.newContext({
        userAgent: USER_AGENT,
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    const page = await context.newPage();

    // Execute the login flow with anti-detection techniques
    await login(page);
    await randomDelay();

    // Retrieve video listings
    const videos = await retry(() => getVideos(page));

    // Process each video
    for (const vid of videos) {
        if (await videoExists(vid.video_id)) {
            logger.info(`Video ${vid.video_id} exists. Skipping.`);
            continue;
        }

        try {
            logger.debug(`Fetching metadata for ${vid.video_id}`);
            const metadata = await retry(() => getVideoMetadata(page, vid.url));

            if (metadata) {
                // Save the metadata; no personalities for NATO Multimedia.
                await saveMetadata(
                    "NATO Multimedia",
                    vid.video_id,
                    metadata.published_date,
                    metadata.title,
                    metadata.description,
                    "", // no personalities
                    metadata.duration,
                    metadata.download_url
                );
                logger.info(`Saved video ${vid.video_id}`);
            } else {
                logger.warn(`No metadata for video ${vid.video_id}`);
            }
        } catch (err) {
            logger.error(`Error for video ${vid.video_id}: ${err.message}`);
        }
    }

    await browser.close();
})();