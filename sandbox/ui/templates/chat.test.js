// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { ChatTemplate } from './chat.js';

describe('chat template', () => {
    it('renders a lightweight empty state outside the scrollable message list', () => {
        document.body.innerHTML = ChatTemplate;

        expect(document.getElementById('chat-history')).toBeTruthy();
        const empty = document.getElementById('chat-empty');
        expect(empty).toBeTruthy();
        expect(empty.previousElementSibling.id).toBe('chat-history');
        expect(empty.querySelector('[data-i18n="chatEmptyTitle"]')).toBeTruthy();
        expect(empty.querySelector('[data-i18n="chatEmptyHint"]')).toBeTruthy();
        expect(empty.querySelector('.chat-empty-logo')).toBeTruthy();
        expect(empty.querySelectorAll('.chat-empty-tips li')).toHaveLength(4);
        expect(empty.querySelector('[data-i18n="chatEmptyTip1"]')).toBeTruthy();
        expect(empty.querySelector('[data-empty-action="github-star"]')).toBeTruthy();
        expect(empty.querySelector('[data-i18n="chatEmptyTipStar"]')).toBeTruthy();
    });
});
