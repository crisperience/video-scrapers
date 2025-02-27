module.exports = {
    apps: [
        {
            name: "eu_commission",
            script: "scrapers/eu_commission/index.js",
            watch: false,
            autorestart: false
        },
        {
            name: "eu_parliament",
            script: "scrapers/eu_parliament/index.js",
            watch: false,
            autorestart: false
        }
    ]
};