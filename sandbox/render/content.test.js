// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { renderContent } from './content.js';

vi.mock('./pipeline.js', () => ({
    transformMarkdown: (text) => `<pre>${text}</pre>`,
}));

vi.mock('./artifacts.js', () => ({
    cleanupLiveArtifacts: vi.fn(),
    enhanceLiveArtifacts: vi.fn(),
}));

vi.mock('../core/i18n.js', () => ({
    formatT: (key, values = {}) => {
        const templates = {
            callLabel: 'Call {index}/{count}',
            collapseTool: 'Collapse {name}',
            durationLabel: '{duration}',
            expandTool: 'Expand {name}',
            stepLabel: 'Step {step}',
            toolStatusCancelled: 'Cancelled {name}',
            toolStatusFailed: 'Failed {name}',
            toolStatusRunning: 'Using {name}...',
            toolStatusUsed: 'Used {name}',
        };
        return (templates[key] || key).replace(/\{(\w+)\}/g, (_, name) =>
            String(values[name] ?? '')
        );
    },
    t: (key) =>
        ({
            rawTool: 'Raw tool',
            toolBadgeDone: 'Done',
            toolBadgeFailed: 'Failed',
            toolBadgeRunning: 'Running',
            toolBadgeCancelled: 'Cancelled',
            toolFallbackName: 'tool',
        })[key] || key,
}));

vi.mock('../../shared/utils/index.js', () => ({
    createPrefixedId: (prefix) => `${prefix}-test`,
}));

describe('renderContent tool disclosure', () => {
    it('renders tool duration in disclosure metadata', () => {
        const contentDiv = document.createElement('div');

        renderContent(contentDiv, '{"ok":true}', 'tool-output', {
            toolName: 'click',
            toolStatus: 'completed',
            toolDurationMs: 1500,
            toolCallText: '{"tool":"click","args":{"uid":"1_2"}}',
        });

        expect(contentDiv.querySelector('.tool-disclosure-meta')?.textContent).toContain('1.5s');
    });

    it('renders an action icon for every browser-control tool card', () => {
        const toolNames = [
            'navigate_page',
            'new_page',
            'close_page',
            'list_pages',
            'select_page',
            'click',
            'hover',
            'fill',
            'fill_form',
            'press_key',
            'type_text',
            'attach_file',
            'take_snapshot',
            'wait_for',
            'handle_dialog',
            'evaluate_script',
        ];

        for (const toolName of toolNames) {
            const contentDiv = document.createElement('div');

            renderContent(contentDiv, '{"ok":true}', 'tool-status', {
                toolName,
                toolStatus: 'running',
                toolCallText: JSON.stringify({ tool: toolName, args: {} }),
            });

            const icon = contentDiv.querySelector('.tool-disclosure-icon');
            expect(icon, toolName).not.toBeNull();
            expect(icon?.dataset.toolIcon, toolName).toBeTruthy();
            expect(icon?.querySelector('svg'), toolName).not.toBeNull();
        }
    });

    it('uses keyword icons for routed MCP tools and a plug fallback for unknown tools', () => {
        const searchDiv = document.createElement('div');
        renderContent(searchDiv, 'results', 'tool-output', {
            toolName: 'browser_mcp__search_query',
            toolStatus: 'completed',
        });

        const unknownDiv = document.createElement('div');
        renderContent(unknownDiv, 'done', 'tool-output', {
            toolName: 'custom_tool',
            toolStatus: 'completed',
        });

        expect(searchDiv.querySelector('.tool-disclosure-icon')?.dataset.toolIcon).toBe('search');
        expect(unknownDiv.querySelector('.tool-disclosure-icon')?.dataset.toolIcon).toBe('tool');
    });
});
