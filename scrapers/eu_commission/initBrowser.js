const { chromium } = require('playwright');

async function initBrowser() {
    return await chromium.launch({
        headless: true
    });
}

module.exports = { initBrowser };