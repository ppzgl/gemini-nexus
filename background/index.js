import { GeminiSessionManager } from './managers/session_manager.js';
import { ImageManager } from './managers/image_manager.js';
import { BrowserControlManager } from './managers/control_manager.js';
import { McpRemoteManager } from './managers/mcp_remote_manager.js';
import { LogManager, setupConsoleInterception } from './managers/log_manager.js';
import { NativeLoggerSink } from './managers/native_logger_sink.js';
import { SidePanelScopeManager } from './managers/sidepanel_scope_manager.js';
import { setupContextMenus } from './menus.js';
import { setupMessageListener } from './messages.js';
import { keepAliveManager } from './managers/keep_alive.js';
import { setupContentScriptInjection } from './content_injection.js';
import { setupPageShortcutCommands } from './page_shortcut_commands.js';
import {
    showQuickAskForTab,
    startAreaOcrForTab as startAreaOcrForTabWithManager,
} from './page_shortcut_tab_actions.js';

// Unpacked (dev) loads default native logging ON so local agents can tail
// ~/Library/Logs/gemini-nexus.log without a settings UI. Store-built packages
// (manifest has update_url) stay off until geminiNativeLogEnabled is set true.
function isUnpackedExtension() {
    try {
        return !('update_url' in chrome.runtime.getManifest());
    } catch {
        return false;
    }
}

const defaultNativeLogEnabled = isUnpackedExtension();
const nativeLoggerSink = new NativeLoggerSink({
    minLevel: 'info',
    enabled: defaultNativeLogEnabled,
});
const logManager = new LogManager([nativeLoggerSink]);

chrome.storage.local.get(['geminiNativeLogEnabled', 'geminiNativeLogLevel'], (result) => {
    if (result.geminiNativeLogEnabled === false) {
        nativeLoggerSink.setEnabled(false);
    } else if (result.geminiNativeLogEnabled === true || defaultNativeLogEnabled) {
        nativeLoggerSink.setEnabled(true);
        // Persist the unpacked default so storage matches runtime and reloads stay on.
        if (result.geminiNativeLogEnabled !== true && defaultNativeLogEnabled) {
            chrome.storage.local.set({ geminiNativeLogEnabled: true });
        }
    } else {
        nativeLoggerSink.setEnabled(false);
    }
    if (result.geminiNativeLogLevel) nativeLoggerSink.setMinLevel(result.geminiNativeLogLevel);
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.geminiNativeLogEnabled) {
        nativeLoggerSink.setEnabled(changes.geminiNativeLogEnabled.newValue === true);
    }
    if (changes.geminiNativeLogLevel) {
        nativeLoggerSink.setMinLevel(changes.geminiNativeLogLevel.newValue);
    }
});

setupConsoleInterception(logManager);

console.info('[Gemini Nexus] Background Service Worker Started');

const sessionManager = new GeminiSessionManager();
const imageManager = new ImageManager();
const controlManager = new BrowserControlManager();
const sidePanelScopeManager = new SidePanelScopeManager();
const mcpManager = new McpRemoteManager({
    clientName: 'gemini-nexus',
    clientVersion: chrome.runtime.getManifest().version,
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
sidePanelScopeManager.init();
chrome.action.onClicked.addListener((tab) => {
    if (!tab?.id || !tab.windowId) return;
    sidePanelScopeManager.toggleForTab(tab.id, tab.windowId).catch((error) => {
        console.error('Could not toggle side panel from action click:', error);
    });
});

async function startAreaOcrForTab(tab) {
    await startAreaOcrForTabWithManager(tab, imageManager);
}

chrome.commands?.onCommand?.addListener((command, tab) => {
    if (command === 'quick-ask') {
        showQuickAskForTab(tab).catch((error) => {
            console.error('Could not open quick ask from command:', error);
        });
        return;
    }

    if (command === 'area-ocr') {
        startAreaOcrForTab(tab).catch((error) => {
            console.error('Could not start area OCR from command:', error);
        });
    }
});

setupPageShortcutCommands({
    showQuickAskForTab,
    startAreaOcrForTab,
});

setupContextMenus();
setupContentScriptInjection();
setupMessageListener(
    sessionManager,
    imageManager,
    controlManager,
    mcpManager,
    logManager,
    sidePanelScopeManager
);

// Keep-alive 401/403 must invalidate AuthManager memory as well as storage;
// otherwise getOrFetchContext keeps serving the dead in-memory tokens.
keepAliveManager.setSessionExpiredHandler(() => sessionManager.clearContext());
keepAliveManager.init();

// Detach the debugger before the MV3 service worker is terminated so the
// controlled tab is not left stuck on the "Started debugging" infobar with no
// live SW to detach it. After restart, connection.attached is false and a
// leaked attachment has no recovery path (the user had to close the tab).
// chrome.runtime.onSuspend is an Event object — register the callback with
// addListener, not by calling onSuspend(cb) (the latter throws
// "chrome.runtime.onSuspend is not a function").
chrome.runtime.onSuspend?.addListener?.(() => {
    try {
        controlManager.suspendCleanup();
    } catch (error) {
        console.warn('[Gemini Nexus] onSuspend cleanup failed:', error);
    }
});
