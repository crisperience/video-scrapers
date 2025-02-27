const axios = require('axios');
const https = require('https');
const logger = require('../../common/logger');
const { initDB, videoExists, saveMetadata, getUnanalyzedVideos, setMomentslabID } = require('../../common/db');
const selectors = require('./selectors');
const { randomDelay, USER_AGENT, retry } = require('./utils');
const { API_TOKEN, ANALYSIS_URL } = require('../../common/config');
const { chromium } = require('playwright');

const SEARCH_URL = "https://multimedia.europarl.europa.eu/en/search?tab=videos&category=27&page=1";

/**
 * Converts a string to Title Case.
 */
function toTitleCase(str) {
    if (!str || str.length === 0) return '';
    return str[0].toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Normalizes a duration string.
 * If the duration is in "mm:ss" format, prepends "00:".
 */
function normalizeDuration(duration) {
    const parts = duration.split(':');
    if (parts.length === 2) {
        return `00:${duration}`;
    }
    return duration;
}

/**
 * Fetches videos from the search page.
 */
async function getAllVideos(page) {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector(selectors.videoItem, { timeout: 45000 });

    const videos = await page.$$eval(
        selectors.videoItem,
        (elements, durationSelector) => {
            return elements.map(elem => {
                const anchor = elem.querySelector('a');
                let href = anchor ? anchor.getAttribute('href') : '';
                if (href && !href.startsWith('http')) {
                    href = "https://multimedia.europarl.europa.eu" + href;
                }
                const durationEl = elem.querySelector(durationSelector);
                const duration = durationEl ? durationEl.innerText.trim() : '';
                const parts = href.split('_');
                const video_id = parts.length > 1 ? parts.pop() : '';
                return { video_id, url: href, duration };
            });
        },
        selectors.duration
    );

    return videos.slice(0, 5);
}

/**
 * Fetches detailed metadata from a video page.
 */
async function getVideoMetadata(page, video_url, tempVideoId) {
    await page.goto(video_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector(selectors.title, { timeout: 45000 }).catch(() => null);
    await randomDelay();

    try {
        const title = await page.$eval(selectors.title, el => el.innerText.trim());
        const published_date = await page.$eval(selectors.publishedDate, el =>
            el.innerText.replace('Event date:', '').trim()
        );

        let description = '';
        try {
            description = await page.$eval(selectors.description, el => el.innerText.trim());
        } catch (err) {
            description = '';
        }

        let personalities = await page.$$eval(selectors.personalities, els =>
            els.filter(el => (el.getAttribute('href') || '').includes('/person/'))
                .map(el => el.innerText.trim())
        );

        personalities = personalities.map(text => {
            text = text.replace(/\(.*?\)/, '').trim();
            const parts = text.split(',');
            if (parts.length < 2) return text;
            const surname = toTitleCase(parts[0].trim());
            const givenName = toTitleCase(parts[1].trim());
            return `${givenName} ${surname}`;
        });

        // Click "Download" tab to reveal download link.
        await page.click(selectors.downloadButton).catch(() => { });
        await page.waitForSelector(selectors.downloadLink, { timeout: 10000 }).catch(() => { });
        let download_url = await page.$eval(selectors.downloadLink, el => el.href).catch(() => 'No download available');
        if (download_url && download_url.startsWith('//')) {
            download_url = 'https:' + download_url;
        }

        let video_id;
        try {
            video_id = await page.$eval(selectors.reference, el => el.innerText.replace('Reference:', '').trim());
        } catch (err) {
            logger.warn(`Reference element not found on ${video_url}. Using temporary video ID.`);
            video_id = tempVideoId;
        }

        return {
            title: title || "Untitled Video",
            published_date: published_date || "Unknown Date",
            description,
            personalities: personalities.join(', '),
            download_url,
            video_id
        };

    } catch (e) {
        logger.error(`Failed to extract metadata from ${video_url}: ${e.message}`);
        return null;
    }
}

/**
 * Scrapes the latest five videos.
 */
async function scrapeLatestFive() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await randomDelay();

    try {
        let videos = await retry(() => getAllVideos(page));
        // Sort newest first. (Assuming higher video_id means newer.)
        videos.sort((a, b) => b.video_id.localeCompare(a.video_id));
        logger.info(`Found ${videos.length} videos: ${videos.map(v => v.video_id).join(', ')}`);

        for (const vid of videos) {
            if (await videoExists(vid.video_id)) {
                logger.info(`Video ${vid.video_id} exists. Skipping.`);
                continue;
            }
            try {
                logger.debug(`Fetching metadata for video from ${vid.url}...`);
                const metadata = await retry(() => getVideoMetadata(page, vid.url, vid.video_id));
                if (metadata) {
                    // Normalize duration so it always is in "hh:mm:ss" format.
                    metadata.duration = normalizeDuration(vid.duration);
                    if (!(await videoExists(metadata.video_id))) {
                        await saveMetadata(
                            "EU Parliament",
                            metadata.video_id,
                            metadata.published_date,
                            metadata.title,
                            metadata.description,
                            metadata.personalities,
                            metadata.duration,
                            metadata.download_url,
                            null
                        );
                        logger.info(`Saved metadata for ${metadata.video_id}.`);
                    } else {
                        logger.info(`Video ${metadata.video_id} already saved. Skipping.`);
                    }
                } else {
                    logger.warn(`No metadata for video at ${vid.url}.`);
                }
            } catch (error) {
                logger.error(`Failed fetching metadata for video at ${vid.url}: ${error.message}`);
            }
        }
    } catch (error) {
        logger.error(`Failed to get video list: ${error.message}`);
    } finally {
        await browser.close();
    }
}

async function sendAnalysisRequest(video_id, title, download_url) {
    try {
        const agent = new https.Agent({ rejectUnauthorized: false });
        const headers = {
            "Authorization": `Bearer ${API_TOKEN}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Nb-Workspace": "demo-en"
        };
        const payload = {
            "type": "video",
            "external_id": video_id,
            "filename": `${video_id}.mp4`,
            "title": title,
            "source": { "type": "URL", "url": download_url },
            "analysis_parameters": {
                "transcript_language": "en",
                "audio_channel_mapping": "left",
                "tasks": ["mxt"]
            }
        };
        const response = await axios.post(ANALYSIS_URL, payload, { headers, httpsAgent: agent });
        return response.data.analysis_request_id;
    } catch (e) {
        logger.error(`Failed MomentsLab for ${video_id}: ${e.response ? e.response.data : e.message}`);
        return null;
    }
}

async function sendUnanalyzedVideosToMomentslab() {
    const rows = await getUnanalyzedVideos(5);
    for (let row of rows) {
        const { video_id, title, download_url } = row;
        const analysis_id = await sendAnalysisRequest(video_id, title, download_url);
        if (analysis_id) {
            await setMomentslabID(video_id, analysis_id);
            logger.info(`Sent ${video_id} to MomentsLab. ID: ${analysis_id}`);
        } else {
            logger.warn(`No analysis ID for ${video_id}`);
        }
    }
}

(async () => {
    await initDB();
    await scrapeLatestFive();
    await sendUnanalyzedVideosToMomentslab();
})();