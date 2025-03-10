const scrapingbee = require('scrapingbee');

const client = new scrapingbee.ScrapingBeeClient('S00M9ZXHKXQ0JSBZWRS3ERMQ30993UF1CW4VMSQI1T6280GL8LX555DZUNAGI0M2NRGFLVRTI9RMF15N');

/**
 * Fetch page content using ScrapingBee API.
 * @param {string} url - The URL to scrape.
 * @param {Object|null} scenario - Optional scenario for custom interactions.
 * @returns {Promise<string|null>} - The HTML content of the page or null if there's an error.
 */
async function fetchPageContent(url, scenario = null) {
    try {
        const params = {
            render_js: true,        // Enable JavaScript rendering
            premium_proxy: true,    // Use high-quality proxies
            block_ads: true,        // Block ads to speed up loading
            country_code: 'de'      // Simulate a German user (change as needed)
        };

        if (scenario) {
            params.js_scenario = JSON.stringify(scenario);
        }

        console.debug(`Requesting ${url} with params: ${JSON.stringify(params)}`);
        const response = await client.get({ url, params });

        if (response.status === 200) {
            return response.data;
        } else {
            console.error(`ScrapingBee error ${response.status}: ${response.statusText}`);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching ${url}:`, error.message);
        return null;
    }
}

/**
 * Simulates a human-like delay between actions.
 * @param {number} min - Minimum milliseconds.
 * @param {number} max - Maximum milliseconds.
 */
async function humanDelay(min = 1000, max = 3000) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

module.exports = { fetchPageContent, humanDelay };