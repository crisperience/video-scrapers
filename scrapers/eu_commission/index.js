const axios = require('axios');
const https = require('https');
const logger = require('../../common/logger');
const { initDB, videoExists, saveMetadata, getUnanalyzedVideos, setMomentslabID } = require('../../common/db');
const { SEARCH_RESULTS, DETAIL_TITLE, DETAIL_DESCRIPTION, DETAIL_PERSONALITIES, DETAIL_DOWNLOAD_LINK } = require('./selectors');
const { randomDelay, USER_AGENT, retry } = require('./utils');
const { API_TOKEN, ANALYSIS_URL } = require('../../common/config');
const { initBrowser } = require('./initBrowser');

const BASE_URL = "https://audiovisual.ec.europa.eu/en/search?mediatype=VIDEO&categories=VideoNews&sort=score&direction=desc";

async function getAllVideos(page) {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector(SEARCH_RESULTS);

    const videos = await page.$$eval(SEARCH_RESULTS, elements => {
        return elements.map(elem => {
            let href = elem.getAttribute('href') || '';
            if (href && !href.startsWith('http')) {
                if (href.startsWith('//')) {
                    href = 'https:' + href;
                } else {
                    href = 'https://audiovisual.ec.europa.eu' + href;
                }
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
    await page.goto(video_url, { waitUntil: 'networkidle' });
    await page.waitForSelector(DETAIL_TITLE).catch(() => null);
    await randomDelay();

    try {
        const title = await page.evaluate(() => {
            const element = document.querySelector("h1.details-main-title");
            return element ? element.innerText.trim() : null;
        });

        const published_date = await page.evaluate(() => {
            const elements = document.querySelectorAll("p.ecl-paragraph");
            for (let el of elements) {
                if (el.textContent.includes("Date:")) {
                    return el.textContent.replace(/.*Date:\s*/, "").trim();
                }
            }
            return null;
        });

        const duration = await page.evaluate(() => {
            const elements = document.querySelectorAll("div.avs-media-details p");
            for (let el of elements) {
                if (el.textContent.includes("Duration:")) {
                    return el.textContent.split("Duration:").pop().trim();
                }
            }
            return null;
        });

        const description = await page.locator(DETAIL_DESCRIPTION).innerText().catch(() => "No description available");
        const personalities = await page.$$eval(DETAIL_PERSONALITIES, links => links.map(a => a.textContent.trim()).join(", ")) || "No personalities listed";

        // Click "Available HD MP4" button if it exists
        const expandButton = page.locator("a[ng-if='key === \"FHDMP4\"']");
        if (await expandButton.isVisible()) {
            await expandButton.click();
            await page.waitForSelector("#downloadlink", { timeout: 5000 }).catch(() => null);
        }

        // Extract the download link and ensure it has "https:" prefix if it starts with "//"
        const download_url = await page.evaluate(() => {
            const link = document.querySelector("#downloadlink");
            let href = link ? (link.getAttribute("ng-href") || link.getAttribute("href")) : null;
            if (href && href.startsWith("//")) {
                href = "https:" + href;
            }
            return href;
        });

        // Collect missing fields for logging
        let missingFields = [];
        if (!title) missingFields.push("title");
        if (!published_date) missingFields.push("published_date");
        if (!duration) missingFields.push("duration");
        if (!download_url) missingFields.push("download_url");

        if (missingFields.length > 0) {
            logger.warn(`Video ${video_url} is missing fields: ${missingFields.join(", ")}`);
        }

        return {
            title: title || "Untitled Video",
            published_date: published_date || "Unknown Date",
            duration: duration || "00:00",
            description,
            personalities,
            download_url: download_url || "No download available"
        };

    } catch (e) {
        logger.error(`Failed to extract metadata from ${video_url}: ${e.message}`);
        return null;
    }
}

async function scrapeLatestFive() {
    const browser = await initBrowser();
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await randomDelay();

    try {
        const videos = await retry(() => getAllVideos(page));

        // Ensure sorting is applied before slicing
        const latestVideos = videos
            .sort((a, b) => parseInt(b.video_id.split('-').pop(), 10) - parseInt(a.video_id.split('-').pop(), 10))
            .slice(0, 5); // Take only the latest 5 from the website

        logger.info(`Found ${latestVideos.length} latest videos: ${latestVideos.map(v => v.video_id).join(', ')}`);

        for (const vid of latestVideos) {
            const exists = await videoExists(vid.video_id);
            if (exists) {
                logger.info(`Video ${vid.video_id} already in database, skipping.`);
                continue;
            }

            try {
                logger.debug(`Fetching metadata for ${vid.video_id}...`);
                const metadata = await retry(() => getVideoMetadata(page, vid.url));

                if (metadata) {
                    // Ensure metadata isn't saved multiple times due to retry
                    if (!(await videoExists(vid.video_id))) {
                        await saveMetadata(
                            "EU Commission",
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
                        logger.info(`Video ${vid.video_id} was already saved after retry, skipping.`);
                    }
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