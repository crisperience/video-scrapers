module.exports = {
    videoItem: 'div.media-item-card_mediaItemCard__rrO3C',
    title: 'h1.content-title_heading__Umnug div',
    description: 'div.content-summary_html_raw_content__5bz2F.content-summary_not_compact___yCfw',
    personalities: 'a.tag_tag__ZWglu',
    // Duration is only available on the search page
    duration: 'div.media-item-card_mediaItemCard__info__qWdCB p',
    publishedDate: 'span:has-text("Event date:")',
    // Selector for the "Download" tab that needs to be clicked
    downloadButton: 'a:has-text("Download")',
    // Selector for the actual download link (inside the downloads list)
    downloadLink: 'div.downloads-tab-content_downloadlist__button__vPzY_ a',
    // Selector for video ID (labeled "Reference:" on the detailed page)
    reference: 'span:has-text("Reference:")'
};