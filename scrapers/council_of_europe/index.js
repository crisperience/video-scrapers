const { chromium } = require('playwright');
const logger = require('../../common/logger');
const { initDB, videoExists, saveMetadata } = require('../../common/db');
const { randomDelay, USER_AGENT, retry } = require('./utils');
const selectors = require('./selectors');

const BASE_URL = "https://www.coe.int/en/web/portal/videos";

/**
 * Scrapes the latest 5 videos from the Council of Europe video archive.
 */
async function getAllVideos(page) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector(selectors.videoItem, { timeout: 45000 });

    const videos = await page.$$eval(selectors.videoItem, elements =>
        elements.slice(0, 5).map(elem => {
            const anchor = elem.querySelector('h3 a');
            return {
                title: anchor?.innerText.trim() || "Untitled",
                url: anchor?.href || "#"
            };
        })
    );

    return videos;
}

/**
 * Scrapes metadata from a single video page.
 */
async function getVideoMetadata(page, videoUrl) {
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Check if the Vimeo iframe exists before proceeding
    const iframeElement = await page.$(selectors.vimeoIframe);
    if (!iframeElement) {
        logger.warn(`No Vimeo iframe found for ${videoUrl}, skipping metadata extraction.`);
        return null;
    }

    // Extract the iframe source URL
    const vimeoIframeUrl = await iframeElement.getAttribute('src');

    // Extract Vimeo ID from the URL
    const vimeoIdMatch = vimeoIframeUrl.match(/video\/(\d+)/);
    const videoId = vimeoIdMatch ? vimeoIdMatch[1] : null;

    if (!videoId) {
        logger.warn(`Could not extract Vimeo ID from ${vimeoIframeUrl}`);
        return null;
    }

    // Extract video metadata by monitoring XHR requests
    const { downloadUrl, publishedDate, duration } = await getVimeoData(page, vimeoIdMatch[1]);

    return { videoId, downloadUrl, publishedDate, duration };
}

/**
 * Extracts video metadata by intercepting XHR requests to Vimeo's player config.
 */
async function getVimeoData(page, videoId) {
    let videoFileUrl = "Unknown";
    let publishedDate = "Unknown";
    let duration = "Unknown";

    // Listen for XHR response containing video metadata
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes(`player.vimeo.com/video/${videoId}/config`)) {
            try {
                const json = await response.json();

                // Extract direct video file URL (choose highest quality)
                const progressiveFiles = json.request.files.progressive;
                if (progressiveFiles && progressiveFiles.length > 0) {
                    videoFileUrl = progressiveFiles.sort((a, b) => b.height - a.height)[0].url;
                }

                // Extract publish date
                if (json.video.upload_date) {
                    publishedDate = formatDate(json.video.upload_date);
                }

                // Extract duration
                if (json.video.duration) {
                    duration = formatDuration(json.video.duration);
                }
            } catch (err) {
                logger.warn(`Failed to parse Vimeo JSON for ${videoId}: ${err.message}`);
            }
        }
    });

    // Navigate to the Vimeo player to trigger the XHR request
    await page.goto(`https://player.vimeo.com/video/${videoId}`, { waitUntil: 'networkidle', timeout: 45000 });

    return { downloadUrl: videoFileUrl, publishedDate, duration };
}

/**
 * Formats date to "DD/MM/YYYY".
 */
function formatDate(dateString) {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB").replace(/\//g, '/');
}

/**
 * Formats duration from seconds to "hh:mm:ss".
 */
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return "Unknown";

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Scrapes the latest 5 videos and saves new ones to the database.
 */
async function scrapeLatestFive() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await randomDelay();

    try {
        const videos = await retry(() => getAllVideos(page));

        for (const vid of videos) {
            const metadata = await retry(() => getVideoMetadata(page, vid.url));

            if (!metadata) {
                logger.warn(`No metadata found for ${vid.url}, skipping.`);
                continue;
            }

            const { videoId, downloadUrl, publishedDate, duration } = metadata;

            if (await videoExists(videoId)) {
                logger.info(`Video ${videoId} already exists. Skipping.`);
                continue;
            }

            try {
                await saveMetadata(
                    "Council of Europe",
                    videoId,
                    publishedDate,
                    vid.title,
                    "",
                    "",
                    duration,
                    downloadUrl,
                    null
                );
                logger.info(`Saved metadata for video ID: ${videoId}.`);
            } catch (error) {
                logger.error(`Failed to save metadata for ${videoId}: ${error.message}`);
            }
        }
    } catch (error) {
        logger.error(`Failed to retrieve video list: ${error.message}`);
    } finally {
        await browser.close();
    }
}

(async () => {
    await initDB();
    await scrapeLatestFive();
})();