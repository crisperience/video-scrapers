// index.js
const { chromium } = require('playwright');
const { initBrowser } = require('./initBrowser');
const {
    saveMetadata,
    videoExists
} = require('../../common/db');
const selectors = require('./selectors');
const logger = require('../../common/logger');
const { randomDelay, retry, USER_AGENT } = require('./utils');

async function login(page) {
    await page.goto('https://www.natomultimedia.tv/app/search?s.q=&s.o=date&s.g=1&s.g=2&s.l=&s.df=&s.dt=&s.nr=&s.lm=&s.lmi=&s.lmc=&s%40action=search');
    await page.click(selectors.loginButton);
    await page.waitForSelector(selectors.loginForm);
    await page.fill(selectors.emailField, 'martin@crisp.hr');
    await page.fill(selectors.passwordField, '20wVUSDwZR7Jkk9Y');
    await page.click(selectors.submitButton);
    await page.waitForSelector(selectors.loginForm, { state: 'hidden', timeout: 30000 });
}

async function getVideos(page) {
    await page.goto('https://www.natomultimedia.tv/app/search?s.q=&s.o=date&s.g=1&s.g=2&s.l=&s.df=&s.dt=&s.nr=&s.lm=&s.lmi=&s.lmc=&s%40action=search', { waitUntil: 'networkidle' });
    await page.waitForSelector(selectors.videoResult);
    // Get basic info from video listing.
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
    await page.goto(video_url, { waitUntil: 'networkidle' });
    await page.waitForSelector(selectors.title);
    const title = await page.$eval(selectors.title, el => el.innerText.trim());
    const description = await page.$eval(selectors.description, el => el.innerText.trim());
    const published_date = await page.$eval(selectors.publishedDate, el => el.innerText.trim());
    const duration = await page.$eval(selectors.duration, el => el.innerText.trim());
    // Download link. If login is required, you should already be logged in.
    const download_url = await page.$eval(selectors.downloadLink, el => el.href).catch(() => 'No download available');

    return { title, description, published_date, duration, download_url };
}

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    await login(page);
    await randomDelay();

    const videos = await retry(() => getVideos(page));

    for (const vid of videos) {
        if (await videoExists(vid.video_id)) {
            logger.info(`Video ${vid.video_id} exists. Skipping.`);
            continue;
        }

        try {
            logger.debug(`Fetching metadata for ${vid.video_id}`);
            const metadata = await retry(() => getVideoMetadata(page, vid.url));

            if (metadata) {
                // No personalities for NATO Multimedia.
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