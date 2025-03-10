const { randomInt } = require('crypto');
const { subDays, subHours, subMinutes, subWeeks, subMonths, format } = require('date-fns');
const logger = require('../../common/logger');

async function randomDelay(min = 500, max = 1500) {
    const delay = randomInt(min, max);
    logger.debug(`Delaying for ${delay}ms`);
    return new Promise(resolve => setTimeout(resolve, delay));
}

async function retry(fn, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            logger.warn(`Attempt ${i + 1} failed: ${err.message}`);
            if (i < retries - 1) {
                const nextDelay = delay * Math.pow(1.5, i);
                logger.info(`Retrying in ${(nextDelay / 1000).toFixed(1)}s...`);
                await randomDelay(nextDelay, nextDelay * 1.5);
            } else {
                logger.error(`All ${retries} attempts failed.`);
                throw err;
            }
        }
    }
}

function parseRelativeDate(relativeDate) {
    if (!relativeDate || typeof relativeDate !== 'string') return 'Unknown Date';

    const now = new Date();
    let parsedDate;
    if (relativeDate.includes('hour')) {
        parsedDate = subHours(now, parseInt(relativeDate));
    } else if (relativeDate.includes('minute')) {
        parsedDate = subMinutes(now, parseInt(relativeDate));
    } else if (relativeDate.includes('day')) {
        parsedDate = subDays(now, parseInt(relativeDate));
    } else if (relativeDate.includes('week')) {
        parsedDate = subWeeks(now, parseInt(relativeDate));
    } else if (relativeDate.includes('month')) {
        parsedDate = subMonths(now, parseInt(relativeDate));
    } else {
        return 'Unknown Date';
    }
    return format(parsedDate, 'dd/MM/yyyy');
}

function formatDuration(rawDuration) {
    if (!rawDuration || typeof rawDuration !== 'string') return '00:00:00';

    const parts = rawDuration.split(':').map(num => num.padStart(2, '0'));
    if (parts.length === 2) {
        return `00:${parts[0]}:${parts[1]}`;
    } else if (parts.length === 3) {
        return parts.join(':');
    }
    return '00:00:00';
}

async function getVideoDetails(videoUrl, page) {
    try {
        await page.goto(videoUrl, { waitUntil: 'networkidle', timeout: 90000 });
        const dateElement = await page.$('meta[itemprop="datePublished"]');
        const exactPublishedDate = dateElement ? await dateElement.getAttribute('content') : null;
        const descriptionElement = await page.$('yt-formatted-string#description');
        const description = descriptionElement ? await descriptionElement.innerText() : '';
        const durationElement = await page.$('span.ytp-time-duration');
        const rawDuration = durationElement ? await durationElement.innerText() : 'Unknown';
        return {
            exactPublishedDate: exactPublishedDate ? format(new Date(exactPublishedDate), 'dd/MM/yyyy') : null,
            description,
            duration: formatDuration(rawDuration)
        };
    } catch (err) {
        logger.warn(`Failed to fetch details from ${videoUrl}: ${err.message}`);
        return { exactPublishedDate: null, description: '', duration: '00:00:00' };
    }
}

async function acceptCookies(page) {
    try {
        const acceptButton = await page.waitForSelector('button:has-text("Accept")', { timeout: 5000 });
        if (acceptButton) {
            await acceptButton.click();
            logger.info("Accepted cookies.");
        }
    } catch (err) {
        logger.warn("No cookies prompt found.");
    }
}

module.exports = { randomDelay, retry, acceptCookies, parseRelativeDate, getVideoDetails, formatDuration };