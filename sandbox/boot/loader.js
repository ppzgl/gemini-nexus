import 'katex/dist/katex.min.css';
import 'highlight.js/styles/atom-one-dark.css';
import 'highlight.js/styles/atom-one-light.css';
import { debugLog } from '../../shared/logging/debug.js';
import { configureMarkdown } from '../render/config.js';

export const MARKDOWN_READY_EVENT = 'gemini-markdown-ready';

let dependencyLoadPromise = null;
let markdownReady = false;

function emitMarkdownReady() {
    if (typeof globalThis.marked === 'undefined') return;

    configureMarkdown();

    if (!markdownReady) {
        markdownReady = true;
        window.dispatchEvent(new CustomEvent(MARKDOWN_READY_EVENT));
    }
}

async function loadBundledDependencies() {
    const [markedModule, highlightModule, katexModule, autoRenderModule] = await Promise.all([
        import('marked'),
        import('highlight.js/lib/common'),
        import('katex'),
        import('katex/contrib/auto-render'),
    ]);

    globalThis.marked = markedModule.marked || markedModule.default || markedModule;
    globalThis.hljs = highlightModule.default || highlightModule;
    globalThis.katex = katexModule.default || katexModule;
    globalThis.renderMathInElement =
        autoRenderModule.default || autoRenderModule.renderMathInElement;
    emitMarkdownReady();
}

export async function loadLibs() {
    try {
        if (!dependencyLoadPromise) {
            dependencyLoadPromise = loadBundledDependencies().catch((error) => {
                dependencyLoadPromise = null;
                throw error;
            });
        }

        // Race against a timeout so app startup is never blocked by dependency initialization.
        let timedOut = false;
        let timeoutId = null;
        const dependencyPromise = dependencyLoadPromise
            .then(() => true)
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                console.warn('Markdown dependency load issue:', message);
                return false;
            });

        await Promise.race([
            dependencyPromise,
            new Promise((resolve) => {
                timeoutId = setTimeout(() => {
                    timedOut = true;
                    resolve(false);
                }, 5000);
            }),
        ]);

        if (timeoutId) clearTimeout(timeoutId);

        if (timedOut && typeof globalThis.marked === 'undefined') {
            console.warn('Markdown dependency load issue:', 'Initialization timeout');
        }

        debugLog('Lazy dependencies loading...');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('Deferred loading failed', message);
    }
}
