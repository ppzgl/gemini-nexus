import { sendToBackground } from '../../shared/messaging/index.js';
import { t } from '../core/i18n.js';

export function getToolsPageScrollDistance(toolsRow) {
    return Math.max(160, toolsRow.clientWidth - 24);
}

function bindToolsRowNavigation() {
    const toolsRow = document.getElementById('tools-row');
    const scrollLeftBtn = document.getElementById('tools-scroll-left');
    const scrollRightBtn = document.getElementById('tools-scroll-right');

    if (!toolsRow || !scrollLeftBtn || !scrollRightBtn) return;

    const updateToolsScrollState = () => {
        const maxScrollLeft = Math.max(0, toolsRow.scrollWidth - toolsRow.clientWidth);
        const hasLeft = toolsRow.scrollLeft > 1;
        const hasRight = toolsRow.scrollLeft < maxScrollLeft - 1;

        toolsRow.parentElement.classList.toggle('has-overflow-left', hasLeft);
        toolsRow.parentElement.classList.toggle('has-overflow-right', hasRight);
        scrollLeftBtn.disabled = !hasLeft;
        scrollRightBtn.disabled = !hasRight;
    };

    scrollLeftBtn.addEventListener('click', () => {
        toolsRow.scrollBy({ left: -getToolsPageScrollDistance(toolsRow), behavior: 'smooth' });
    });
    scrollRightBtn.addEventListener('click', () => {
        toolsRow.scrollBy({ left: getToolsPageScrollDistance(toolsRow), behavior: 'smooth' });
    });
    toolsRow.addEventListener('scroll', updateToolsScrollState, { passive: true });
    window.addEventListener('resize', updateToolsScrollState);
    requestAnimationFrame(updateToolsScrollState);
    setTimeout(updateToolsScrollState, 300);
}

function bindCaptureButton(buttonId, app, ui, mode, getStatusText) {
    document.getElementById(buttonId).addEventListener('click', () => {
        app.setCaptureMode(mode);
        sendToBackground({ action: 'INITIATE_CAPTURE', mode, source: 'sidepanel' });
        ui.updateStatus(getStatusText());
    });
}

export function bindToolButtonEvents(app, ui) {
    bindToolsRowNavigation();

    const browserControlBtn = document.getElementById('browser-control-btn');
    if (browserControlBtn) {
        browserControlBtn.addEventListener('click', () => {
            app.toggleBrowserControl();
            if (ui.inputFn) ui.inputFn.focus();
        });
    }

    const liveArtifactsBtn = document.getElementById('live-artifacts-btn');
    if (liveArtifactsBtn) {
        liveArtifactsBtn.addEventListener('click', () => {
            app.toggleLiveArtifacts();
            if (ui.inputFn) ui.inputFn.focus();
        });
    }

    document.getElementById('quote-btn').addEventListener('click', () => {
        sendToBackground({ action: 'GET_ACTIVE_SELECTION' });
        if (ui.inputFn) ui.inputFn.focus();
    });

    bindCaptureButton('ocr-btn', app, ui, 'ocr', () => t('selectOcr'));
    bindCaptureButton('screenshot-translate-btn', app, ui, 'screenshot_translate', () =>
        t('selectTranslate')
    );

    document.getElementById('screen-capture-btn').addEventListener('click', () => {
        app.setCaptureMode('screen_capture');
        // Chrome extension sandbox 环境限制:postMessage 必须使用 '*'
        window.parent.postMessage({ action: 'REQUEST_SCREEN_CAPTURE' }, '*');
        ui.updateStatus(t('selectScreenCapture'));
    });

    bindCaptureButton('snip-btn', app, ui, 'snip', () => t('selectSnip'));

    const contextBtn = document.getElementById('page-context-btn');
    if (contextBtn) {
        contextBtn.addEventListener('click', () => {
            app.togglePageContext();
            if (ui.inputFn) ui.inputFn.focus();
        });
    }
}
