const puppeteer = require('puppeteer');

async function initBrowser() {
    return puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-software-rasterizer'
        ],
        executablePath: process.env.CHROMIUM_PATH || puppeteer.executablePath()
    });
}

module.exports = { initBrowser };