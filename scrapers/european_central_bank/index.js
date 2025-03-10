const { chromium } = require('playwright');
const logger = require('../../common/logger');
const { initDB, videoExists, saveMetadata } = require('../../common/db');
const { randomDelay, retry, acceptCookies, parseRelativeDate, getVideoDetails, formatDuration } = require('./utils');

const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@ecbeuro/videos";

/**
 * Extracts video metadata from a YouTube channel page.
 */
async function getYouTubeVideos(page) {
    await page.goto(YOUTUBE_CHANNEL_URL, { waitUntil: 'networkidle', timeout: 90000 });
    await acceptCookies(page);
    await page.waitForSelector('yt-formatted-string#video-title', { timeout: 90000 });

    const videos = await page.$$eval('ytd-rich-grid-media', elements => {
        return elements.slice(0, 5).map(elem => {
            const titleElem = elem.querySelector('yt-formatted-string#video-title');
            const title = titleElem ? titleElem.innerText.trim() : 'Untitled Video';

            const anchor = elem.querySelector('a#thumbnail');
            const videoUrl = anchor ? anchor.href : '';

            const videoId = videoUrl.includes("watch?v=") ? new URL(videoUrl).searchParams.get("v") : '';

            const durationElem = elem.querySelector('span.ytd-thumbnail-overlay-time-status-renderer');
            const rawDuration = durationElem ? durationElem.innerText.trim() : 'Unknown';

            const dateElem = elem.querySelector('#metadata-line span.inline-metadata-item:nth-child(2)');
            const relativePublishedDate = dateElem ? dateElem.innerText.trim() : 'Unknown Date';

            return { videoId, title, relativePublishedDate, rawDuration, videoUrl };
        });
    });

    for (const video of videos) {
        const { exactPublishedDate, description, duration } = await getVideoDetails(video.videoUrl, page);
        video.publishedDate = exactPublishedDate || parseRelativeDate(video.relativePublishedDate);
        video.description = description;
        video.duration = formatDuration(duration || video.rawDuration);
    }

    return videos;
}

/**
 * Scrapes the latest five videos from the YouTube channel.
 */
async function scrapeLatestFive() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();

    await randomDelay();

    try {
        const videos = await retry(() => getYouTubeVideos(page));
        logger.info(`Found ${videos.length} videos: ${videos.map(v => v.videoId).join(', ')}`);

        for (const vid of videos) {
            if (await videoExists(vid.videoId)) {
                logger.info(`Video ${vid.videoId} exists. Skipping.`);
                continue;
            }
            try {
                logger.debug(`Fetching metadata for video ${vid.videoUrl}...`);
                if (!(await videoExists(vid.videoId))) {
                    await saveMetadata(
                        "European Central Bank",
                        vid.videoId,
                        vid.publishedDate,
                        vid.title,
                        vid.description,
                        "",
                        vid.duration,
                        vid.videoUrl
                    );
                    logger.info(`Saved metadata for ${vid.videoId}.`);
                } else {
                    logger.info(`Video ${vid.videoId} already saved. Skipping.`);
                }
            } catch (error) {
                logger.error(`Failed fetching metadata for video at ${vid.videoUrl}: ${error.message}`);
            }
        }
    } catch (error) {
        logger.error(`Failed to get video list: ${error.message}`);
    } finally {
        await browser.close();
    }
}

(async () => {
    await initDB();
    await scrapeLatestFive();
})();