// common/logger.js

// Simple logging utility
const logger = {
    info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
    error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
    debug: (msg) => console.debug(`[DEBUG] ${new Date().toISOString()} - ${msg}`)
};

module.exports = logger;
