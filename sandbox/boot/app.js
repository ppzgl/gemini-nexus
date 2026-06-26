import { renderLayout } from '../ui/layout.js';
import { applyTranslations, t } from '../core/i18n.js';
import { configureMarkdown } from '../render/config.js';
import { sendToBackground } from '../../shared/messaging/index.js';
import { loadLibs, MARKDOWN_READY_EVENT } from './loader.js';
import { AppMessageBridge } from './messaging.js';
import { bindAppEvents } from './events.js';

export function initAppMode() {
    // Render layout before querying DOM nodes.
    renderLayout();

    // Apply translations before signaling readiness.
    applyTranslations();

    // Chrome extension sandbox 环境限制:postMessage 必须使用 '*'
    // sandbox page 的 origin 为 'null',对非 sandbox window 使用精确 origin 无效
    window.parent.postMessage({ action: 'UI_READY' }, '*');

    const bridge = new AppMessageBridge();

    document.addEventListener('gemini-language-changed', () => {
        applyTranslations();
    });

    (async () => {
        // Load the heavier application modules after the shell is visible.
        const [{ ImageManager }, { SessionManager }, { UIController }, { AppController }] =
            await Promise.all([
                import('../core/image_manager.js'),
                import('../core/session_manager.js'),
                import('../ui/ui_controller.js'),
                import('../controllers/app_controller.js'),
            ]);

        const sessionManager = new SessionManager();

        const ui = new UIController({
            historyListEl: document.getElementById('history-list'),
            sidebar: document.getElementById('history-sidebar'),
            sidebarOverlay: document.getElementById('sidebar-overlay'),
            statusDiv: document.getElementById('status'),
            historyDiv: document.getElementById('chat-history'),
            inputFn: document.getElementById('prompt'),
            sendBtn: document.getElementById('send'),
            historyToggleBtn: document.getElementById('history-toggle'),
            closeSidebarBtn: document.getElementById('close-sidebar'),
            modelSelect: document.getElementById('model-select'),
        });

        const imageManager = new ImageManager(
            {
                imageInput: document.getElementById('image-input'),
                imagePreview: document.getElementById('image-preview'),
                inputWrapper: document.querySelector('.input-wrapper'),
                inputFn: document.getElementById('prompt'),
            },
            {
                onUrlDrop: (url) => {
                    ui.updateStatus(t('loadingImage'));
                    sendToBackground({ action: 'FETCH_IMAGE', url });
                },
            }
        );

        const app = new AppController(sessionManager, ui, imageManager);

        bridge.setUI(ui);
        bridge.setApp(app);

        bindAppEvents(app, ui, (resizeCallback) => bridge.setResizeCallback(resizeCallback));

        // Re-render restored sessions exactly when Markdown becomes available.
        window.addEventListener(MARKDOWN_READY_EVENT, () => {
            if (app) app.rerender();
        });

        // Trigger dependency load in parallel.
        loadLibs();

        // Initial pass may be skipped until marked is loaded.
        configureMarkdown();
    })();
}
