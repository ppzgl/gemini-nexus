import { createPrefixedId } from '../../shared/utils/index.js';
import {
    LIVE_ARTIFACT_FOLLOWUP_EVENT,
    LIVE_ARTIFACT_HTML_LANGUAGE,
    LIVE_ARTIFACT_MESSAGE_CHANNEL,
    normalizeLiveArtifactFollowupPayload,
} from '../core/live_artifacts.js';
import { t } from '../core/i18n.js';

const HTML_LANGUAGES = new Set([LIVE_ARTIFACT_HTML_LANGUAGE]);
const SVG_LANGUAGES = new Set(['svg']);
const MERMAID_LANGUAGES = new Set(['mermaid', 'mmd']);
const GRAPHVIZ_LANGUAGES = new Set(['graphviz', 'dot']);
const TEXT_LANGUAGES = new Set(['', 'plaintext', 'text', 'txt']);
const DANGEROUS_TAGS = new Set([
    'applet',
    'base',
    'embed',
    'iframe',
    'link',
    'meta',
    'object',
    'script',
]);
const BLOCKED_ATTRS = new Set(['srcdoc']);
const URI_ATTRS = new Set([
    'action',
    'background',
    'cite',
    'formaction',
    'href',
    'poster',
    'src',
    'xlink:href',
]);
const ARTIFACT_BRIDGE_SCRIPT = `<script>
(() => {
  const channel = ${JSON.stringify(LIVE_ARTIFACT_MESSAGE_CHANNEL)};
  const notify = (event, payload) => {
    try {
      parent.postMessage(payload === undefined ? { channel, event } : { channel, event, payload }, '*');
    } catch {}
  };
  const notifyResize = () => {
    try {
      const body = document.body;
      const root = document.documentElement;
      const height = Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        root ? root.scrollHeight : 0,
        root ? root.offsetHeight : 0
      );
      parent.postMessage({ channel, event: 'resize', height }, '*');
    } catch {}
  };
  let resizeFrame = 0;
  const scheduleResize = () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      notifyResize();
    });
  };
  if (document.readyState === 'complete') {
    Promise.resolve().then(scheduleResize);
  } else {
    window.addEventListener('load', scheduleResize, { once: true });
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleResize);
    if (document.documentElement) observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  }
  if ('MutationObserver' in window) {
    const observer = new MutationObserver(scheduleResize);
    observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
  }
  window.addEventListener('resize', scheduleResize);
  const parseFollowupPayload = (rawPayload) => {
    const trimmedPayload = String(rawPayload || '').trim();
    if (!trimmedPayload) return null;
    try {
      const parsedPayload = JSON.parse(trimmedPayload);
      if (typeof parsedPayload === 'string') {
        const instruction = parsedPayload.trim();
        return instruction ? { instruction } : null;
      }
      return parsedPayload;
    } catch {
      if (/^[{[]/.test(trimmedPayload)) return null;
      return { instruction: trimmedPayload };
    }
  };
  const resolveFollowupScope = (trigger) => {
    const scopeSelector = trigger.getAttribute('data-amc-followup-scope');
    if (scopeSelector && scopeSelector.trim()) {
      try {
        return document.querySelector(scopeSelector) || trigger.closest(scopeSelector) || document;
      } catch {
        return document;
      }
    }
    return trigger.closest('[data-amc-followup-scope]') || document;
  };
  const readStateValue = (element) => {
    if (element instanceof HTMLInputElement) {
      const inputType = element.type.toLowerCase();
      if (inputType === 'checkbox') return element.checked;
      if (inputType === 'radio') return element.checked ? element.value || true : undefined;
      if (inputType === 'number' || inputType === 'range') {
        return element.value === '' || Number.isNaN(element.valueAsNumber) ? element.value : element.valueAsNumber;
      }
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      if (element.multiple) return Array.from(element.selectedOptions).map((option) => option.value);
      return element.value;
    }
    if (element instanceof HTMLTextAreaElement) return element.value;
    const stateValue = element.getAttribute('data-amc-state-value');
    if (stateValue !== null) {
      const isToggleLike =
        element.hasAttribute('aria-pressed') ||
        element.hasAttribute('aria-selected') ||
        element.hasAttribute('aria-checked');
      if (!isToggleLike) return stateValue;
      const isActive =
        element.getAttribute('aria-pressed') === 'true' ||
        element.getAttribute('aria-selected') === 'true' ||
        element.getAttribute('aria-checked') === 'true';
      return isActive ? stateValue : undefined;
    }
    const textValue = element.textContent ? element.textContent.trim() : '';
    return textValue || undefined;
  };
  const appendStateValue = (state, key, value) => {
    if (value === undefined) return;
    if (Object.prototype.hasOwnProperty.call(state, key)) {
      state[key] = Array.isArray(state[key]) ? [...state[key], value] : [state[key], value];
      return;
    }
    state[key] = value;
  };
  const collectFollowupState = (trigger) => {
    const scope = resolveFollowupScope(trigger);
    const state = {};
    const stateElements = [];
    if (scope instanceof Element && scope.matches('[data-amc-state-key]')) stateElements.push(scope);
    stateElements.push(...Array.from(scope.querySelectorAll('[data-amc-state-key]')));
    stateElements.forEach((element) => {
      const key = element.getAttribute('data-amc-state-key');
      if (!key || element.disabled) return;
      appendStateValue(state, key, readStateValue(element));
    });
    return state;
  };
  const mergeFollowupState = (payload, collectedState) => {
    if (!collectedState || Object.keys(collectedState).length === 0) return payload;
    const existingState =
      payload && typeof payload.state === 'object' && !Array.isArray(payload.state)
        ? payload.state
        : payload && payload.state !== undefined
          ? { value: payload.state }
          : {};
    return {
      ...payload,
      state: {
        ...existingState,
        ...collectedState,
      },
    };
  };
  const readFollowupPayload = (target) => {
    if (!(target instanceof Element)) return null;
    const trigger = target.closest('[data-amc-followup]');
    if (!trigger) return null;
    const payload = parseFollowupPayload(trigger.getAttribute('data-amc-followup'));
    return payload ? mergeFollowupState(payload, collectFollowupState(trigger)) : null;
  };
  document.addEventListener('click', (event) => {
    const payload = readFollowupPayload(event.target);
    if (!payload) return;
    event.preventDefault();
    notify('followup', payload);
  });
})();
</script>`;

let mermaidLoader = () => import('mermaid');
let mermaidModulePromise = null;
let graphvizLoader = () => import('@viz-js/viz');
let graphvizInstancePromise = null;
const graphvizCache = new Map();

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeLanguage(language) {
    return String(language || '')
        .trim()
        .split(/\s+/)[0]
        .toLowerCase();
}

function getCodeLanguage(wrapper) {
    const dataLang = wrapper.dataset?.codeLang;
    if (dataLang) return dataLang;

    const labelLang = wrapper.querySelector('.code-lang')?.textContent;
    if (labelLang) return labelLang;

    const code = wrapper.querySelector('pre code');
    const languageClass = Array.from(code?.classList || []).find((className) =>
        className.startsWith('language-')
    );
    return languageClass ? languageClass.slice('language-'.length) : '';
}

function looksLikeSvg(code) {
    return /^\s*<svg(?:\s|>)/i.test(code);
}

function looksLikeHtml(code) {
    return /^\s*(?:<!doctype\s+html|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)|<(?:article|button|canvas|div|form|main|section|style|table)(?:\s|>))/i.test(
        code
    );
}

function stripMermaidComments(code) {
    return String(code || '')
        .replace(/^(?:\s*%%[^\n]*(?:\n|$))+/, '')
        .trim();
}

function looksLikeMermaid(code) {
    return /^(?:c4component|c4container|c4context|classdiagram|erdiagram|flowchart|gantt|gitgraph|graph|journey|mindmap|pie|quadrantchart|requirementdiagram|sequencediagram|statediagram(?:-v2)?|timeline)\b/i.test(
        stripMermaidComments(code)
    );
}

function looksLikeGraphviz(code) {
    return /^\s*(?:strict\s+)?(?:di)?graph(?:\s+[\w\d_"]+)?\s*\{/i.test(code);
}

export function getArtifactKind(language, code = '') {
    const normalizedLanguage = normalizeLanguage(language);
    const trimmedCode = String(code || '').trim();

    if (HTML_LANGUAGES.has(normalizedLanguage)) return looksLikeHtml(trimmedCode) ? 'html' : null;
    if (SVG_LANGUAGES.has(normalizedLanguage)) return 'svg';
    if (MERMAID_LANGUAGES.has(normalizedLanguage)) return 'mermaid';
    if (GRAPHVIZ_LANGUAGES.has(normalizedLanguage)) return 'graphviz';
    if (looksLikeSvg(trimmedCode)) return 'svg';

    if (TEXT_LANGUAGES.has(normalizedLanguage)) {
        if (looksLikeMermaid(trimmedCode)) return 'mermaid';
        if (looksLikeGraphviz(trimmedCode)) return 'graphviz';
    }

    return null;
}

function isSafePreviewUrl(value) {
    const normalized = String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, '')
        .trim();

    if (!normalized || normalized.startsWith('#')) return true;
    return /^(https?:|data:image\/(?:gif|jpe?g|png|svg\+xml|webp);base64,|blob:|\/)/i.test(
        normalized
    );
}

function sanitizeCssText(cssText) {
    return String(cssText || '')
        .replace(/@import\s+[^;]+;?/gi, '')
        .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote, url) =>
            isSafePreviewUrl(url) ? match : ''
        )
        .replace(/expression\s*\([^)]*\)/gi, '')
        .replace(/-moz-binding\s*:[^;]+;?/gi, '')
        .replace(/javascript\s*:/gi, '');
}

function sanitizePreviewElement(element, kind) {
    const tagName = element.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tagName) || (kind === 'svg' && tagName === 'foreignobject')) {
        element.remove();
        return;
    }

    Array.from(element.attributes || []).forEach((attr) => {
        const attrName = attr.name.toLowerCase();
        if (attrName.startsWith('on') || BLOCKED_ATTRS.has(attrName)) {
            element.removeAttribute(attr.name);
            return;
        }

        if (URI_ATTRS.has(attrName) && !isSafePreviewUrl(attr.value)) {
            element.removeAttribute(attr.name);
            return;
        }

        if (attrName === 'style') {
            const sanitizedStyle = sanitizeCssText(attr.value);
            if (sanitizedStyle.trim()) {
                element.setAttribute(attr.name, sanitizedStyle);
            } else {
                element.removeAttribute(attr.name);
            }
        }
    });

    if (tagName === 'style') {
        element.textContent = sanitizeCssText(element.textContent || '');
    }
}

function sanitizePreviewContainer(container, kind) {
    Array.from(container.querySelectorAll('*')).forEach((element) =>
        sanitizePreviewElement(element, kind)
    );
}

export function sanitizeArtifactMarkup(markup, kind = 'html') {
    if (typeof document === 'undefined') return escapeHtml(markup);

    const source = String(markup || '');
    if (kind === 'html') {
        const parsed = new DOMParser().parseFromString(source, 'text/html');
        sanitizePreviewContainer(parsed, 'html');

        const styleHtml = Array.from(parsed.head.querySelectorAll('style'))
            .map((style) => style.outerHTML)
            .join('');
        return `${styleHtml}${parsed.body.innerHTML}`.trim();
    }

    const template = document.createElement('template');
    template.innerHTML = source;
    sanitizePreviewContainer(template.content, 'svg');
    const svg = template.content.querySelector('svg');
    return svg ? svg.outerHTML : template.innerHTML.trim();
}

export function buildArtifactSrcDoc(kind, code) {
    const sanitizedMarkup = sanitizeArtifactMarkup(code, kind);
    const bodyClass = kind === 'svg' ? 'artifact-svg' : 'artifact-html';
    const bridgeScript = kind === 'html' ? ARTIFACT_BRIDGE_SCRIPT : '';

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'unsafe-inline'; connect-src https: data: blob:; media-src https: data: blob:; form-action 'none'; base-uri 'none'">
<style>
html,body{min-height:100%;margin:0;background:transparent;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{box-sizing:border-box;overflow:hidden}
body.artifact-html{padding:0}
body.artifact-svg{display:grid;place-items:center;padding:16px}
*,*::before,*::after{box-sizing:border-box}
img,svg,canvas,video{max-width:100%}
svg{height:auto}
</style>
</head>
<body class="${bodyClass}">${sanitizedMarkup}${bridgeScript}</body>
</html>`;
}

async function loadMermaidModule() {
    if (!mermaidModulePromise) {
        mermaidModulePromise = mermaidLoader().then((module) => module.default || module);
    }
    return mermaidModulePromise;
}

async function loadGraphvizInstance() {
    if (!graphvizInstancePromise) {
        graphvizInstancePromise = graphvizLoader()
            .then((module) => {
                const createInstance = module.instance || module.default?.instance;
                if (typeof createInstance !== 'function') {
                    throw new Error(t('liveArtifactPreviewFailed'));
                }
                return createInstance();
            })
            .catch((error) => {
                graphvizInstancePromise = null;
                throw error;
            });
    }
    return graphvizInstancePromise;
}

async function renderMermaidToSvg(code) {
    const mermaid = await loadMermaidModule();
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
        fontFamily: 'inherit',
        flowchart: {
            htmlLabels: false,
            useMaxWidth: true,
        },
    });

    if (typeof mermaid.parse === 'function') {
        const parseResult = await mermaid.parse(code, { suppressErrors: false });
        if (parseResult === false) {
            throw new Error(t('liveArtifactPreviewFailed'));
        }
    }

    const result = await mermaid.render(createPrefixedId('mermaid_svg'), code);
    return result?.svg || '';
}

function isMermaidErrorSvg(svg) {
    const text = String(svg || '').toLowerCase();
    return (
        /class=["'][^"']*error-icon/i.test(svg) ||
        (text.includes('syntax error in text') && text.includes('mermaid version'))
    );
}

function getGraphvizThemeKey() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function getGraphvizLayoutDirection(code) {
    const match = String(code || '').match(/rankdir\s*=\s*(["']?)(LR|TB|RL|BT)\1/i);
    if (!match) return 'LR';

    const direction = match[2].toUpperCase();
    if (direction === 'TB' || direction === 'BT') return 'TB';
    return 'LR';
}

function prepareGraphvizCode(code, themeKey = getGraphvizThemeKey()) {
    let processedCode = String(code || '');
    const effectiveLayout = getGraphvizLayoutDirection(processedCode);
    const rankdirRegex = /(rankdir\s*=\s*)(["']?)(LR|TB|RL|BT)\2/gi;

    if (rankdirRegex.test(processedCode)) {
        processedCode = processedCode.replace(rankdirRegex, `$1"${effectiveLayout}"`);
    } else {
        const graphMatch = processedCode.match(
            /(\s*(?:strict\s+)?(?:di)?graph\s+[\w\d_"]*\s*\{|\s*(?:strict\s+)?(?:di)?graph\s*\{)/i
        );
        if (graphMatch) {
            processedCode = processedCode.replace(
                graphMatch[0],
                `${graphMatch[0]}\n  rankdir="${effectiveLayout}";`
            );
        }
    }

    const color = themeKey === 'dark' ? '#e4e4e7' : '#374151';
    const themeDefaults = `
        graph [bgcolor="transparent" fontcolor="${color}" margin="0"];
        node [color="${color}" fontcolor="${color}"];
        edge [color="${color}" fontcolor="${color}"];
      `;

    const openBraceIndex = processedCode.indexOf('{');
    if (openBraceIndex !== -1) {
        processedCode =
            processedCode.slice(0, openBraceIndex + 1) +
            themeDefaults +
            processedCode.slice(openBraceIndex + 1);
    }

    return {
        code: processedCode,
        layout: effectiveLayout,
        theme: themeKey,
    };
}

async function renderGraphvizToSvg(code) {
    const source = String(code || '');
    if (!source.trim()) return '';

    const prepared = prepareGraphvizCode(source);
    const cacheKey = `${prepared.theme}::${prepared.layout}::${source}`;
    if (graphvizCache.has(cacheKey)) return graphvizCache.get(cacheKey);

    const vizInstance = await loadGraphvizInstance();
    const svgElement = await vizInstance.renderSVGElement(prepared.code);
    svgElement.style.maxWidth = '100%';
    svgElement.style.height = 'auto';
    svgElement.style.display = 'block';

    const svg = svgElement.outerHTML;
    graphvizCache.set(cacheKey, svg);
    return svg;
}

function setPreviewLoading(body) {
    body.classList.remove('live-artifact-body-error');
    body.classList.add('live-artifact-body-loading');
    body.setAttribute('aria-busy', 'true');
    body.textContent = t('liveArtifactRendering');
}

function setPreviewError(body, message) {
    body.classList.remove('live-artifact-body-loading');
    body.classList.add('live-artifact-body-error');
    body.removeAttribute('aria-busy');
    body.innerHTML = '';

    const error = document.createElement('div');
    error.className = 'live-artifact-error';
    error.textContent = message || t('liveArtifactPreviewFailed');
    body.appendChild(error);
}

function setPreviewSvg(body, svg) {
    body.classList.remove('live-artifact-body-loading', 'live-artifact-body-error');
    body.removeAttribute('aria-busy');
    body.innerHTML = svg;
}

function renderMermaidPreview(body, code, renderMermaid = renderMermaidToSvg, options = {}) {
    const deferErrors = options.deferErrors === true;
    setPreviewLoading(body);

    Promise.resolve(renderMermaid(code))
        .then((svg) => {
            if (!body.isConnected) return;
            if (isMermaidErrorSvg(svg)) {
                throw new Error(t('liveArtifactPreviewFailed'));
            }

            const sanitizedSvg = sanitizeArtifactMarkup(svg, 'svg');
            if (!sanitizedSvg) {
                setPreviewError(body, t('liveArtifactPreviewFailed'));
                return;
            }

            setPreviewSvg(body, sanitizedSvg);
        })
        .catch((error) => {
            if (!body.isConnected) return;
            if (deferErrors) {
                setPreviewLoading(body);
                return;
            }

            const errorMessage = error instanceof Error ? error.message : '';
            setPreviewError(body, errorMessage || t('liveArtifactPreviewFailed'));
        });
}

function formatGraphvizErrorMessage(error) {
    const message = error instanceof Error ? error.message : '';
    return message.replace(/.*error:\s*/i, '') || t('liveArtifactPreviewFailed');
}

function renderGraphvizPreview(body, code, renderGraphviz = renderGraphvizToSvg, options = {}) {
    const deferErrors = options.deferErrors === true;
    setPreviewLoading(body);

    Promise.resolve(renderGraphviz(code))
        .then((svg) => {
            if (!body.isConnected) return;
            const sanitizedSvg = sanitizeArtifactMarkup(svg, 'svg');
            if (!sanitizedSvg && String(code || '').trim()) {
                setPreviewError(body, t('liveArtifactPreviewFailed'));
                return;
            }

            setPreviewSvg(body, sanitizedSvg);
        })
        .catch((error) => {
            if (!body.isConnected) return;
            if (deferErrors) {
                setPreviewLoading(body);
                return;
            }

            setPreviewError(body, formatGraphvizErrorMessage(error));
        });
}

export function createLiveArtifactPreview(kind, code, options = {}) {
    const preview = document.createElement('section');
    preview.className = 'live-artifact-preview';
    preview.dataset.liveArtifactKind = kind;

    if (kind !== 'html') {
        const header = document.createElement('div');
        header.className = 'live-artifact-header';

        const title = document.createElement('span');
        title.className = 'live-artifact-title';
        title.textContent = t('liveArtifactPreview');

        const badge = document.createElement('span');
        badge.className = 'live-artifact-badge';
        badge.textContent = kind.toUpperCase();

        header.appendChild(title);
        header.appendChild(badge);
        preview.appendChild(header);
    }

    const body = document.createElement('div');
    body.className = `live-artifact-body live-artifact-body-${kind}`;
    preview.appendChild(body);

    if (kind === 'mermaid') {
        renderMermaidPreview(body, code, options.renderMermaid, {
            deferErrors: options.deferMermaidErrors === true,
        });
        return preview;
    }

    if (kind === 'graphviz') {
        renderGraphvizPreview(body, code, options.renderGraphviz, {
            deferErrors: options.deferGraphvizErrors === true,
        });
        return preview;
    }

    const frame = document.createElement('iframe');
    frame.className = 'live-artifact-frame';
    frame.title = `${t('liveArtifactPreviewTitle')} (${kind.toUpperCase()})`;
    frame.setAttribute('sandbox', kind === 'html' ? 'allow-scripts allow-forms' : '');
    frame.referrerPolicy = 'no-referrer';
    frame.loading = 'lazy';
    frame.srcdoc = buildArtifactSrcDoc(kind, code);
    body.appendChild(frame);

    if (kind === 'html') {
        const handleMessage = (event) => {
            if (event.source !== frame.contentWindow) return;
            const data = event.data || {};
            if (data.channel !== LIVE_ARTIFACT_MESSAGE_CHANNEL) return;

            if (data.event === 'followup') {
                const payload = normalizeLiveArtifactFollowupPayload(data.payload);
                if (payload) {
                    if (typeof options.onFollowUp === 'function') {
                        options.onFollowUp(payload);
                    } else {
                        window.dispatchEvent(
                            new CustomEvent(LIVE_ARTIFACT_FOLLOWUP_EVENT, { detail: payload })
                        );
                    }
                }
                return;
            }

            if (data.event === 'resize' && typeof data.height === 'number') {
                const height = Math.max(120, Math.ceil(data.height));
                frame.style.height = `${height}px`;
            }
        };
        window.addEventListener('message', handleMessage);
        preview.__liveArtifactCleanup = () => {
            window.removeEventListener('message', handleMessage);
        };
    }

    return preview;
}

function replaceCodeBlockWithPreview(wrapper, preview) {
    preview.dataset.liveArtifactEnhanced = 'true';

    if (wrapper.parentNode) {
        wrapper.replaceWith(preview);
        return;
    }

    wrapper.className = 'live-artifact-inline-wrapper';
    wrapper.innerHTML = '';
    wrapper.appendChild(preview);
}

export function cleanupLiveArtifacts(root) {
    if (!root || typeof document === 'undefined') return;
    const nodes = root.querySelectorAll?.('[data-live-artifact-enhanced="true"]');
    if (!nodes) return;
    nodes.forEach((node) => {
        const preview = node.querySelector?.('.live-artifact-preview') || node;
        if (typeof preview.__liveArtifactCleanup === 'function') {
            preview.__liveArtifactCleanup();
        }
    });
}

export function enhanceLiveArtifacts(root, options = {}) {
    if (!root || typeof document === 'undefined') return;

    const wrappers = root.matches?.('.code-block-wrapper')
        ? [root]
        : Array.from(root.querySelectorAll?.('.code-block-wrapper') || []);

    wrappers.forEach((wrapper) => {
        if (wrapper.dataset.liveArtifactEnhanced === 'true') return;

        const codeElement = wrapper.querySelector('pre code');
        const code = codeElement?.textContent || '';
        const kind = getArtifactKind(getCodeLanguage(wrapper), code);
        if (!kind) return;

        const preview = createLiveArtifactPreview(kind, code, options);
        if (kind === 'html') {
            replaceCodeBlockWithPreview(wrapper, preview);
            return;
        }

        wrapper.dataset.liveArtifactEnhanced = 'true';
        wrapper.appendChild(preview);
    });
}

export function setMermaidLoaderForTest(loader) {
    mermaidLoader = typeof loader === 'function' ? loader : () => import('mermaid');
    mermaidModulePromise = null;
}

export function setGraphvizLoaderForTest(loader) {
    graphvizLoader = typeof loader === 'function' ? loader : () => import('@viz-js/viz');
    graphvizInstancePromise = null;
    graphvizCache.clear();
}
