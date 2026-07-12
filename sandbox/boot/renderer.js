import { ensureMarkdownDependencies } from './loader.js';
import { transformMarkdown } from '../render/pipeline.js';
import { createPrefixedId, getHighResImageUrl } from '../../shared/utils/index.js';
import { t } from '../core/i18n.js';

let rendererMessageHandler = null;

function escapeAttribute(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function initRendererMode() {
    document.body.innerHTML = ''; // Clear UI

    // Kick off dependency load immediately; each RENDER also awaits readiness.
    // Unlike sidepanel app mode, toolbar renderer has no MARKDOWN_READY re-render,
    // so we must wait for marked itself (not the soft 5s loadLibs timeout).
    const dependencyLoadPromise = ensureMarkdownDependencies();

    if (rendererMessageHandler) {
        window.removeEventListener('message', rendererMessageHandler);
    }

    rendererMessageHandler = async (event) => {
        const message = event.data || {};
        if (!message || typeof message !== 'object') return;

        if (message.action === 'RENDER') {
            const { text, reqId, images } = message;

            try {
                await dependencyLoadPromise;
                // Re-check in case the first load failed and a later import succeeded.
                await ensureMarkdownDependencies();

                let html = transformMarkdown(text);

                if (typeof katex !== 'undefined') {
                    html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, content) => {
                        try {
                            return katex.renderToString(content, {
                                displayMode: true,
                                throwOnError: false,
                            });
                        } catch {
                            return match;
                        }
                    });
                    html = html.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$/g, (match, content) => {
                        try {
                            return katex.renderToString(content, {
                                displayMode: false,
                                throwOnError: false,
                            });
                        } catch {
                            return match;
                        }
                    });
                }

                const fetchTasks = [];
                if (images && Array.isArray(images) && images.length > 0) {
                    let imageHtml = '<div class="generated-images-grid">';
                    const displayImages = images.filter(
                        (imageData) =>
                            imageData &&
                            typeof imageData === 'object' &&
                            typeof imageData.url === 'string'
                    );

                    displayImages.forEach((imageData) => {
                        const imageRequestId = createPrefixedId('gen_img');
                        const targetUrl = getHighResImageUrl(imageData.url);
                        const alt = escapeAttribute(imageData.alt || t('generatedImage'));

                        imageHtml += `<img class="generated-image loading" alt="${alt}" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjwvc3ZnPg==" data-req-id="${imageRequestId}">`;

                        fetchTasks.push({ reqId: imageRequestId, url: targetUrl });
                    });
                    imageHtml += '</div>';
                    html += imageHtml;
                }

                event.source.postMessage(
                    { action: 'RENDER_RESULT', html, reqId, fetchTasks },
                    { targetOrigin: '*' }
                );
            } catch (error) {
                console.error('Render error', error);
                event.source.postMessage(
                    { action: 'RENDER_RESULT', html: text, reqId },
                    { targetOrigin: '*' }
                );
            }
        }
    };

    window.addEventListener('message', rendererMessageHandler);
}
