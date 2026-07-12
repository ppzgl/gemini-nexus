// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { FooterTemplate } from './footer.js';

describe('FooterTemplate', () => {
    it('renders an AMC-style composer shell with textarea above the action row', () => {
        document.body.innerHTML = FooterTemplate;

        const inputWrapper = document.querySelector('.input-wrapper');
        const textareaShell = inputWrapper.querySelector('.composer-textarea-shell');
        const actions = inputWrapper.querySelector('.composer-actions');
        const leftActions = actions.querySelector('.composer-actions-left');
        const rightActions = actions.querySelector('.composer-actions-right');

        expect(inputWrapper.querySelector('#image-preview')).not.toBeNull();
        expect(textareaShell.querySelector('#prompt')).not.toBeNull();
        expect(leftActions.querySelector('#upload-btn')).not.toBeNull();
        expect(leftActions.querySelector('.tools-container')).not.toBeNull();
        expect(leftActions.querySelector('#live-artifacts-btn')).not.toBeNull();
        expect(leftActions.querySelector('#youtube-summary-btn')).toBeNull();
        expect(rightActions.querySelector('#send')).not.toBeNull();

        expect(inputWrapper.contains(document.querySelector('.tools-container'))).toBe(true);
        expect(document.querySelector('.input-row')).toBeNull();
        expect(
            textareaShell.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('keeps context-aware flags only on tools that need page selection', () => {
        document.body.innerHTML = FooterTemplate;

        // page-context and quote still depend on a webpage being bound.
        ['page-context-btn', 'quote-btn'].forEach((buttonId) => {
            expect(document.getElementById(buttonId).classList.contains('context-aware')).toBe(
                true
            );
        });

        // Capture tools live in the always-visible dropdown and are never hidden.
        [
            'browser-control-btn',
            'live-artifacts-btn',
            'screen-capture-btn',
            'ocr-btn',
            'screenshot-translate-btn',
            'snip-btn',
        ].forEach((buttonId) => {
            expect(document.getElementById(buttonId).classList.contains('context-aware')).toBe(
                false
            );
        });
    });

    it('groups the three area-capture tools under a single dropdown', () => {
        document.body.innerHTML = FooterTemplate;

        const dropdown = document.querySelector('.capture-dropdown');
        expect(dropdown).not.toBeNull();
        expect(dropdown.querySelector('#capture-menu-btn')).not.toBeNull();
        const menu = dropdown.querySelector('#capture-menu');
        expect(menu).not.toBeNull();
        // The three capture tools live inside the dropdown menu.
        ['ocr-btn', 'screenshot-translate-btn', 'snip-btn'].forEach((buttonId) => {
            expect(menu.querySelector(`#${buttonId}`)).not.toBeNull();
        });
    });
});
