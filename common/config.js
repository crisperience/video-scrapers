// common/config.js

require('dotenv').config();

module.exports = {
    API_TOKEN: process.env.API_TOKEN,
    ANALYSIS_URL: process.env.ANALYSIS_URL
};
