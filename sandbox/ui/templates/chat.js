export const ChatTemplate = `
    <!-- CHAT AREA -->
    <div id="chat-history"></div>
    <div id="chat-empty" class="chat-empty" aria-hidden="true">
        <div class="chat-empty-content">
            <div class="chat-empty-mark" aria-hidden="true">
                <img class="chat-empty-logo" src="../logo.png" alt="" width="56" height="56">
            </div>
            <div class="chat-empty-title" data-i18n="chatEmptyTitle">Gemini Nexus</div>
            <div class="chat-empty-hint" data-i18n="chatEmptyHint">Ready when you are.</div>
            <ul class="chat-empty-tips">
                <li><button type="button" class="chat-empty-tip" data-empty-action="page-context" data-i18n="chatEmptyTip1">Turn on Page to chat with this website</button></li>
                <li><button type="button" class="chat-empty-tip" data-empty-action="capture" data-i18n="chatEmptyTip2">Use Capture for OCR, translate, or image ask</button></li>
                <li><button type="button" class="chat-empty-tip" data-empty-action="browser-control" data-i18n="chatEmptyTip3">Enable Control to let the model browse for you</button></li>
                <li><button type="button" class="chat-empty-tip chat-empty-tip-star" data-empty-action="github-star" data-i18n="chatEmptyTipStar">Star Gemini Nexus on GitHub (auto browser control)</button></li>
            </ul>
        </div>
    </div>
`;
