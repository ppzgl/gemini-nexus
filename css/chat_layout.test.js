import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readCss = (file) => readFile(new URL(`./${file}`, import.meta.url), 'utf8');

describe('chat message layout styles', () => {
    it('keeps message entrance animation from trapping opacity at 0', async () => {
        const chatCss = await readCss('chat.css');

        // Base rule must not hard-set opacity (invisible if animation never runs).
        expect(chatCss).toMatch(/\.msg\s*{[^}]*animation:\s*fadeIn[^;]*both/s);
        const msgRule = chatCss.match(/\.msg\s*{([^}]+(?:\{[^}]*\}[^}]*)*)}/s)?.[1] || '';
        // Strip comments before asserting — prose may mention opacity.
        const msgDecls = msgRule.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(msgDecls).not.toMatch(/\bopacity\s*:/);
        expect(msgDecls).not.toMatch(/\btransform\s*:/);
        expect(chatCss).toMatch(/@keyframes\s+fadeIn\s*{[\s\S]*?from\s*{[\s\S]*?opacity:\s*0/s);
        expect(chatCss).toMatch(/prefers-reduced-motion:\s*reduce/);
        expect(chatCss).toMatch(
            /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.msg[\s\S]*?animation:\s*none/s
        );
    });

    it('keeps normal bubbles close to AMC message presentation', async () => {
        const chatCss = await readCss('chat.css');
        const markdownCss = await readCss('chat_markdown.css');

        expect(chatCss).toMatch(/\.msg-row\s*{[^}]*display:\s*flex/s);
        expect(chatCss).toMatch(/\.msg-row\s*{[^}]*gap:\s*16px/s);
        expect(chatCss).toMatch(/\.message-content-container\s*{[^}]*min-width:\s*0/s);
        expect(chatCss).toMatch(/\.message-content-container\s*{[^}]*transition/s);
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.message-content-container\s*{[^}]*max-width:\s*80%/s
        );
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.message-content-container\s*{[^}]*padding:\s*14px 18px/s
        );
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.message-content-container\s*{[^}]*border-radius:\s*var\(--radius-md\) 4px var\(--radius-md\) var\(--radius-md\)/s
        );
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.message-content-container\s*{[^}]*box-shadow:\s*var\(--shadow-sm\)/s
        );
        expect(chatCss).toMatch(/\.msg\.ai\s+\.message-content-container\s*{[^}]*width:\s*100%/s);
        expect(chatCss).toMatch(
            /\.msg\.ai\s+\.message-content-container\s*{[^}]*background:\s*transparent/s
        );
        expect(chatCss).toMatch(/\.message-action-rail\s*{[^}]*width:\s*40px/s);
        // Coarse pointers keep actions visible; fine+hover may hide until hover.
        expect(chatCss).toMatch(/\.message-actions\s*{[^}]*opacity:\s*1/s);
        expect(chatCss).toMatch(
            /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*\.message-actions\s*{[^}]*opacity:\s*0/s
        );
        expect(chatCss).toMatch(/\.msg:hover\s+\.message-actions/s);
        expect(chatCss).toMatch(
            /#chat-history\s*>\s*:not\(\[hidden\]\)\s*\+\s*\.msg\.msg-grouped\s*{[^}]*margin-top:\s*6px/s
        );
        expect(chatCss).toMatch(
            /\.msg\.msg-grouped\s+\.message-avatar\s*{[^}]*visibility:\s*hidden/s
        );
        expect(markdownCss).toContain('.message-content-container .msg-content');
        expect(markdownCss).toMatch(
            /\.message-content-container\s+\.msg-content\s*{[^}]*overflow-wrap:\s*anywhere/s
        );
    });

    it('keeps generated images constrained to the message width', async () => {
        const mediaCss = await readCss('chat_media.css');

        expect(mediaCss).toMatch(
            /\.generated-images-grid\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
        );
        expect(mediaCss).toMatch(/\.generated-images-grid\s*{[^}]*min-width:\s*0/s);
        expect(mediaCss).toMatch(/\.generated-images-grid\s*{[^}]*max-width:\s*100%/s);
        expect(mediaCss).toMatch(/\.generated-image\s*{[^}]*display:\s*block/s);
        expect(mediaCss).toMatch(/\.generated-image\s*{[^}]*width:\s*100%/s);
        expect(mediaCss).toMatch(/\.generated-image\s*{[^}]*max-width:\s*100%/s);
        expect(mediaCss).toMatch(/\.generated-image\s*{[^}]*box-sizing:\s*border-box/s);
    });

    it('aligns tool process cards with the assistant content column', async () => {
        const chatCss = await readCss('chat.css');

        expect(chatCss).toMatch(/\.msg\.user\.msg-tool-status\s*{[^}]*background:\s*transparent/s);
        expect(chatCss).toMatch(/\.msg\.user\.msg-tool-status\s*{[^}]*padding:\s*0/s);
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.tool-message-row\s*{[^}]*justify-content:\s*flex-start/s
        );
        expect(chatCss).toMatch(
            /\.tool-message-content-container\s*{[^}]*background:\s*transparent/s
        );
        expect(chatCss).toMatch(/\.tool-message-rail\s*{[^}]*visibility:\s*hidden/s);
    });

    it('keeps diagram previews expanded and compact on errors', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        expect(markdownCss).toMatch(
            /\.live-artifact-preview\[data-live-artifact-kind='html'\]\s*{[^}]*background:\s*transparent/s
        );
        expect(markdownCss).toMatch(/\.live-artifact-body-html\s*{[^}]*min-height:\s*0/s);
        expect(markdownCss).toMatch(/\.live-artifact-body-html\s*{[^}]*background:\s*transparent/s);
        expect(markdownCss).toMatch(
            /\.live-artifact-body-html\s+\.live-artifact-frame\s*{[^}]*min-height:\s*120px/s
        );
        expect(markdownCss).toMatch(
            /\.live-artifact-body-mermaid,[\s\S]*\.live-artifact-body-graphviz\s*{[^}]*max-height:\s*none/s
        );
        expect(markdownCss).toMatch(
            /\.live-artifact-body-mermaid svg,[\s\S]*\.live-artifact-body-graphviz svg\s*{[^}]*max-width:\s*100%/s
        );
        expect(markdownCss).toMatch(/\.live-artifact-body-error\s*{[^}]*min-height:\s*72px/s);
        expect(markdownCss).toMatch(/\.live-artifact-error\s*{[^}]*overflow-wrap:\s*anywhere/s);
        expect(markdownCss).toMatch(/\.live-artifact-error\s*{[^}]*white-space:\s*pre-wrap/s);
    });
});
