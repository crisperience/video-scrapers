const { fetchPageContent } = require('./initBrowser');
const cheerio = require('cheerio');
const selectors = require('./selectors');
const { saveMetadata, videoExists } = require('../../common/db');
const logger = require('../../common/logger');
const { retry } = require('./utils');
const fetch = require('node-fetch'); // Using node-fetch v2
const tough = require('tough-cookie');
const fetchCookie = require('fetch-cookie').default;
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const jar = new tough.CookieJar();
const fetchWithCookies = fetchCookie(fetch, jar);

/**
 * Converts a date string from "21 Feb 2025" to "21/02/2025".
 */
function formatDate(dateStr) {
    const months = {
        Jan: '01', Feb: '02', Mar: '03', Apr: '04',
        May: '05', Jun: '06', Jul: '07', Aug: '08',
        Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    const [day, month, year] = dateStr.split(' ');
    return `${day.padStart(2, '0')}/${months[month]}/${year}`;
}

/**
 * Converts a duration string (e.g., "00:30") to "00:00:30" format.
 */
function formatDuration(durationStr) {
    const parts = durationStr.split(':').map(p => p.padStart(2, '0'));
    if (parts.length === 1) return `00:00:${parts[0]}`;
    if (parts.length === 2) return `00:${parts[0]}:${parts[1]}`;
    return durationStr;
}

/**
 * Fetch video listings from the search page.
 * Returns an array of videos with id, url, duration, and a placeholder download URL.
 */
async function getVideos() {
    const url = "https://www.natomultimedia.tv/app/search?s.q=&s.o=date&s.g=1&s.g=2";
    logger.info(`Fetching videos from: ${url}`);
    const html = await fetchPageContent(url);
    if (!html) {
        logger.error("Failed to retrieve video listings.");
        return [];
    }
    const $ = cheerio.load(html);
    const videos = [];
    $(selectors.videoResult).each((_, el) => {
        const link = $(el).find("a").attr("href");
        const durationText = $(el).find('.type').text().trim();
        const duration = formatDuration(durationText);
        if (link) {
            const video_id = link.split('/').pop();
            const placeholder_download = `https://www.natomultimedia.tv/app/download/asset/${video_id}/full_hd_8`;
            videos.push({
                video_id,
                url: `https://www.natomultimedia.tv${link}`,
                duration,
                placeholder_download
            });
        }
    });
    logger.info(`Found ${videos.length} videos.`);
    return videos.slice(0, 5);
}

/**
 * Fetch metadata from a video asset page.
 * Extracts title, description, published date and returns an object with these and other info.
 */
async function getVideoMetadata(video_url, placeholder_download, duration) {
    logger.info(`Fetching metadata from: ${video_url}`);
    const html = await fetchPageContent(video_url);
    if (!html) {
        logger.error(`Failed to retrieve metadata for ${video_url}`);
        return null;
    }
    const $ = cheerio.load(html);
    const title = $(selectors.title).text().trim();
    const description = $(selectors.description).text().trim();
    const rawDate = $(selectors.publishedDate).text().trim().match(/\d{2} \w{3} \d{4}/);
    const published_date = rawDate ? formatDate(rawDate[0]) : "Unknown";
    return { title, description, published_date, duration, placeholder_download };
}

/**
 * Open a placeholder download URL in a new tab and extract the final download URL.
 * After navigation, we simply capture page.url(), which now holds the full signed URL.
 */
async function extractFinalUrlFromPlaceholder(url, browser) {
    let finalUrl = "UNAUTHORIZED";
    let page;
    try {
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0'
        );
        // Navigate and wait for network idle to allow any redirects to complete.
        await page.goto(url, { waitUntil: 'networkidle2' });
        finalUrl = page.url();
        // If the URL hasn't changed, as a fallback, try evaluating body text.
        if (finalUrl === url) {
            const textContent = await page.evaluate(() => document.body.innerText.trim());
            if (textContent && textContent.startsWith('http')) {
                finalUrl = textContent;
            }
        }
    } catch (err) {
        logger.error(`Error extracting final URL from ${url}: ${err.message}`);
    } finally {
        if (page) await page.close();
    }
    return finalUrl;
}

/**
 * Launch a Puppeteer browser instance and extract final download URLs for each video.
 */
async function extractFinalUrls(metadataList) {
    let browser;
    try {
        browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const finalUrlPromises = metadataList.map(item =>
            extractFinalUrlFromPlaceholder(item.meta.placeholder_download, browser)
        );
        const finalUrls = await Promise.all(finalUrlPromises);
        finalUrls.forEach((url, i) => {
            metadataList[i].meta.download_url = url;
            logger.info(`Final URL for video ${metadataList[i].video_id}: ${url}`);
        });
    } catch (err) {
        logger.error(`Error during final URL extraction: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Main function: scrape video listings, retrieve metadata, extract final download URLs,
 * and save data to the database.
 */
(async () => {
    logger.info("Starting NATO Multimedia scraper.");
    const videos = await retry(getVideos);
    const metadataList = [];

    for (const vid of videos) {
        if (await videoExists(vid.video_id)) {
            logger.info(`Video ${vid.video_id} already exists. Skipping.`);
            continue;
        }
        try {
            logger.debug(`Fetching metadata for video ${vid.video_id}`);
            const meta = await retry(() =>
                getVideoMetadata(vid.url, vid.placeholder_download, vid.duration)
            );
            if (meta) {
                metadataList.push({ video_id: vid.video_id, meta });
            } else {
                logger.warn(`No metadata found for video ${vid.video_id}`);
            }
        } catch (err) {
            logger.error(`Error processing video ${vid.video_id}: ${err.message}`);
        }
    }

    await extractFinalUrls(metadataList);

    for (const item of metadataList) {
        try {
            await saveMetadata(
                "NATO Multimedia",
                item.video_id,
                item.meta.published_date,
                item.meta.title,
                item.meta.description,
                "", // No personalities for NATO Multimedia
                item.meta.duration,
                item.meta.download_url
            );
            logger.info(`Saved video ${item.video_id}`);
        } catch (err) {
            logger.error(`Error saving video ${item.video_id}: ${err.message}`);
        }
    }
    logger.info("Scraping completed.");
})();