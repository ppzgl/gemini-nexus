import { AuthManager } from './auth_manager.js';
import { getConnectionSettings } from './session/settings_store.js';
import { RequestDispatcher } from './session/request_dispatcher.js';
import { classifyProviderError, isUnavailableWebAuthError } from './session/error_classifier.js';

const REQUEST_CANCELLED_TEXT = 'Request cancelled.';

function createGeminiAuthLink(accountIndex) {
    const href = `https://gemini.google.com/u/${accountIndex}/`;
    return `<a href="${href}" target="_blank" class="gemini-auth-link">gemini.google.com/u/${accountIndex}/</a>`;
}

export class GeminiSessionManager {
    constructor() {
        this.auth = new AuthManager();
        this.dispatcher = new RequestDispatcher(this.auth);
        this.abortController = null;
    }

    async ensureInitialized() {
        await this.auth.ensureInitialized();
    }

    async handleSendPrompt(request, onUpdate) {
        // Cancel previous if exists
        this.cancelCurrentRequest();

        const abortController = new AbortController();
        this.abortController = abortController;
        const signal = abortController.signal;
        let thoughtsStartedAt = null;
        let thoughtsDurationSeconds = null;
        const trackedOnUpdate = (partialText, partialThoughts) => {
            if (typeof partialThoughts === 'string' && partialThoughts.trim()) {
                if (!thoughtsStartedAt) {
                    thoughtsStartedAt = Date.now();
                }
                thoughtsDurationSeconds = (Date.now() - thoughtsStartedAt) / 1000;
            }
            onUpdate(partialText, partialThoughts);
        };

        try {
            const settings = await getConnectionSettings({ provider: request.provider });

            // Normalize files
            let files = [];
            if (request.files && Array.isArray(request.files)) {
                files = request.files;
            } else if (request.image) {
                files = [
                    {
                        base64: request.image,
                        type: request.imageType,
                        name: request.imageName || 'image.png',
                    },
                ];
            }

            // Ensure Auth is ready for Web provider (Dispatcher relies on AuthManager)
            if (settings.provider === 'web') {
                await this.ensureInitialized();
            }

            const result = await this.dispatcher.dispatch(
                request,
                settings,
                files,
                trackedOnUpdate,
                signal
            );
            if (result?.thoughts) {
                result.thoughtsDurationSeconds = thoughtsStartedAt
                    ? (Date.now() - thoughtsStartedAt) / 1000
                    : (thoughtsDurationSeconds ?? 0);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                return {
                    action: 'GEMINI_REPLY',
                    sessionId: request.sessionId || null,
                    text: REQUEST_CANCELLED_TEXT,
                    status: 'cancelled',
                };
            }

            console.error('Gemini Error:', error);

            let errorMessage = error.message || 'Unknown error';
            const isZh = chrome.i18n.getUILanguage().startsWith('zh');

            // Handle common user-facing errors
            if (isUnavailableWebAuthError(errorMessage)) {
                this.auth.forceContextRefresh();
                try {
                    await chrome.storage.local.remove(['geminiContext']);
                } catch (storageError) {
                    console.warn(
                        '[Gemini Nexus] Failed to clear stale Web auth context:',
                        storageError
                    );
                }

                const currentIndex = this.auth.getCurrentIndex();
                const authLink = createGeminiAuthLink(currentIndex);
                if (isZh) {
                    errorMessage = `账号 (Index: ${currentIndex}) 未登录、会话已过期或 Gemini Web 请求参数不可用。请前往 ${authLink} 登录或刷新 Gemini 页面。`;
                } else {
                    errorMessage = `Account (Index: ${currentIndex}) is not logged in, the session expired, or Gemini Web request parameters are unavailable. Please log in at ${authLink} or refresh Gemini.`;
                }
            } else if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
                errorMessage = isZh
                    ? '请求过于频繁，请稍后再试 (429)'
                    : 'Too many requests, please try again later (429)';
            }

            const { kind: errorKind, retryable } = classifyProviderError(errorMessage);

            return {
                action: 'GEMINI_REPLY',
                sessionId: request.sessionId || null,
                text: 'Error: ' + errorMessage,
                status: 'error',
                errorKind,
                retryable,
            };
        } finally {
            if (this.abortController === abortController) {
                this.abortController = null;
            }
        }
    }

    cancelCurrentRequest() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            return true;
        }
        return false;
    }

    async setContext(context, model) {
        await this.auth.updateContext(context, model);
    }

    async resetContext() {
        await this.auth.resetContext();
    }
}
