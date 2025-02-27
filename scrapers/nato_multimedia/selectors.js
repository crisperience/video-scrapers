// selectors.js
module.exports = {
    // Login selectors
    loginButton: 'button[data-target="#login"]',
    loginForm: 'form#f48',
    emailField: 'input#f49',
    passwordField: 'input#f50',
    submitButton: 'button[name="login@action"]',

    // Video list and details selectors
    videoResult: 'div.media.video.result',
    // Video detail page selectors:
    title: 'h2.col-md-8',
    description: 'div.col-md-12 div.metaValue',
    publishedDate: 'div.meta.col-md-4 div.asset-metadata-value',
    duration: 'div.type span',

    // Download button selector
    downloadLink: 'button#openDownload'
};