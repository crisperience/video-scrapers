// scrapers/eu_commission/index.js

const axios = require('axios');
const https = require('https');
const logger = require('../../common/logger');
const { initDB, videoExists, saveMetadata, getUnanalyzedVideos, setMomentslabID } = require('../../common/db');
const { SEARCH_RESULTS, VIDEO_TITLE, VIDEO_DATE, VIDEO_DURATION, DETAIL_TITLE, DETAIL_DATE, DETAIL_DURATION, DETAIL_DESCRIPTION, DETAIL_PERSONALITIES, DETAIL_DOWNLOAD_LINK } = require('./selectors');
const { randomDelay, USER_AGENT, retry } = require('./utils');
const { API_TOKEN, ANALYSIS_URL } = require('../../common/config');
const { initBrowser } = require('./initBrowser');

const BASE_URL = "https://audiovisual.ec.europa.eu/en/search?mediatype=VIDEO&categories=VideoNews&sort=score&direction=desc";

async function getAllVideos(page) {
    await page.setUserAgent(USER_AGENT);
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector(SEARCH_RESULTS, { timeout: 15000 });

    const videos = await page.$$eval(SEARCH_RESULTS, elements => {
        return elements.map(elem => {
            let href = elem.getAttribute('href');
            if (href && !href.startsWith('http')) {
                href = "https://audiovisual.ec.europa.eu" + href;
            }
            const video_id = href ? href.split('/').pop() : '';
            return { video_id, url: href };
        });
    });

    return videos
        .sort((a, b) => parseInt(b.video_id.split('-').pop(), 10) - parseInt(a.video_id.split('-').pop(), 10))
        .slice(0, 5)
        .reverse();
}

async function getVideoMetadata(page, video_url) {
    await page.goto(video_url, { waitUntil: 'networkidle2' });
    await page.waitForSelector(DETAIL_TITLE, { timeout: 10000 });
    await randomDelay();

    try {
        const title = await page.$eval(DETAIL_TITLE, el => el.textContent.trim());

        const published_date = await page.evaluate(() => {
            const elements = document.querySelectorAll("div.avs-media-details p");
            for (let el of elements) {
                if (el.textContent.includes("Date:")) {
                    return el.textContent.split("Date:").pop().trim();
                }
            }
            return "";
        });

        const duration = await page.evaluate(() => {
            const elements = document.querySelectorAll("div.avs-media-details p");
            for (let el of elements) {
                if (el.textContent.includes("Duration:")) {
                    return el.textContent.split("Duration:").pop().trim();
                }
            }
            return "";
        });

        const description = await page.$eval(DETAIL_DESCRIPTION, el => el.textContent.trim()).catch(() => "");
        const personalities = await page.$$eval(DETAIL_PERSONALITIES, links => links.map(a => a.textContent.trim()).join(", "));
        const download_url = await page.$eval(DETAIL_DOWNLOAD_LINK, el => el.getAttribute("href"));

        return { title, published_date, duration, description, personalities, download_url };
    } catch (e) {
        logger.error(`Failed to extract metadata from ${video_url}: ${e.message}`);
        return null;
    }
}

async function scrapeLatestFive() {
    const browser = await initBrowser();
    const page = await browser.newPage();
    await randomDelay();

    try {
        const videos = await retry(() => getAllVideos(page));
        for (const vid of videos) {
            if (await videoExists(vid.video_id)) {
                logger.info(`Video ${vid.video_id} already in database, skipping.`);
                continue;
            }

            try {
                const metadata = await retry(() => getVideoMetadata(page, vid.url));
                if (metadata) {
                    await saveMetadata(
                        vid.video_id,
                        metadata.published_date,
                        metadata.title,
                        metadata.description,
                        metadata.personalities,
                        metadata.duration,
                        metadata.download_url
                    );
                    logger.info(`Saved metadata for video ${vid.video_id}.`);
                } else {
                    logger.warn(`No metadata found for video ${vid.video_id}.`);
                }
            } catch (error) {
                logger.error(`Failed to get metadata for video ${vid.video_id}: ${error.message}`);
            }
        }
    } catch (error) {
        logger.error(`Failed to retrieve video list: ${error.message}`);
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
            "source": {
                "type": "URL",
                "url": download_url
            },
            "analysis_parameters": {
                "transcript_language": "en",
                "audio_channel_mapping": "left",
                "tasks": ["mxt"]
            }
        };
        const response = await axios.post(ANALYSIS_URL, payload, { headers, httpsAgent: agent });
        return response.data.analysis_request_id;
    } catch (e) {
        logger.error(`Failed to send ${video_id} to MomentsLab: ${e.response ? e.response.data : e.message}`);
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
            logger.info(`Sent ${video_id} to MomentsLab, analysis ID: ${analysis_id}`);
        } else {
            logger.warn(`No analysis_request_id for ${video_id}`);
        }
    }
}

(async () => {
    await initDB();
    await scrapeLatestFive();
    await sendUnanalyzedVideosToMomentslab();
})();