// scrapers/eu_commission/selectors.js

module.exports = {
    SEARCH_RESULTS: "section.avs-file a.ecl-link",
    VIDEO_TITLE: "span.description",
    VIDEO_DATE: "span.meta",
    VIDEO_DURATION: ".avs-video-duration",

    // Details
    DETAIL_TITLE: "h1.details-main-title.ng-binding",
    DETAIL_DATE: "//div[contains(@class, 'avs-media-details')]//p[.//strong[contains(text(),'Date:')]]",
    DETAIL_DURATION: "//div[contains(@class, 'avs-media-details')]//p[.//strong[contains(text(),'Duration:')]]",
    DETAIL_DESCRIPTION: "p[ng-bind-html*='video.summary']",
    DETAIL_PERSONALITIES: "p.ecl-paragraph.ecl-paragraph--m.ng-scope[ng-if*='video.personalities'] a.ecl-link.ng-binding",
    DETAIL_DOWNLOAD_LINK: "#downloadlink"
};
