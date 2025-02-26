// scrapers/eu_commission/utils.js

const { randomInt } = require('crypto');
const logger = require('../../common/logger');

/**
 * Generates a random delay to prevent detection while scraping.
 * @param {number} min Minimum delay in milliseconds.
 * @param {number} max Maximum delay in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
async function randomDelay(min = 500, max = 1500) {
    const delay = randomInt(min, max);
    logger.debug(`Delaying for ${delay}ms`);
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * User-Agent string to mimic a real browser session.
 */
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Retries an async function a given number of times before failing.
 * @param {Function} fn The async function to execute.
 * @param {number} retries Number of retry attempts.
 * @param {number} delay Delay between retries in milliseconds.
 * @returns {Promise<any>} The resolved value of the function.
 */
async function retry(fn, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            logger.warn(`Attempt ${i + 1} failed: ${err.message}`);
            if (i < retries - 1) {
                await randomDelay(delay, delay * 1.5);
            } else {
                logger.error(`All ${retries} attempts failed.`);
                throw err;
            }
        }
    }
}

module.exports = { randomDelay, USER_AGENT, retry };
