const { chromium } = require('playwright');
const axios = require('axios');
const https = require('https');
const logger = require('../../common/logger');
const { initDB, videoExists, saveMetadata, getUnanalyzedVideos, setMomentslabID } = require('../../common/db');
const { randomDelay, retry, acceptCookies, parseRelativeDate, getVideoDetails, formatDuration } = require('./utils');
const { API_TOKEN, ANALYSIS_URL } = require('../../common/config');

const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@greenpeace/videos";

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
                        "Greenpeace",
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
