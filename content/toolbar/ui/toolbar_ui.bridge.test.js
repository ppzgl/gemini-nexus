// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ToolbarUI renderer bridge lifecycle', () => {
    let bridgeInstances;

    beforeEach(async () => {
        vi.resetModules();
        document.body.innerHTML = '';
        bridgeInstances = [];

        window.GeminiToolbarDOM = class {
            create() {
                const host = document.createElement('div');
                host.id = 'gemini-nexus-toolbar-host';
                document.body.appendChild(host);
                const shadow = host.attachShadow({ mode: 'open' });
                this.host = host;
                this.shadow = shadow;
                return { host, shadow };
            }

            rerender() {
                if (!this.shadow) return;
                this.shadow.innerHTML = '';
            }
        };

        window.GeminiToolbarView = class {
            constructor(shadow) {
                this.shadow = shadow;
                this.elements = {
                    askWindow: document.createElement('div'),
                    askHeader: document.createElement('div'),
                    toolbar: document.createElement('div'),
                    toolbarDrag: document.createElement('div'),
                };
            }

            setSelectedTranslationTargets() {}
        };

        window.GeminiUIGrammar = class {
            constructor() {}
        };

        window.GeminiRendererBridge = class {
            constructor(host) {
                this.host = host;
                this.destroyed = false;
                bridgeInstances.push(this);
            }

            destroy() {
                this.destroyed = true;
            }
        };

        window.GeminiUIRenderer = class {
            constructor(view, bridge) {
                this.view = view;
                this.bridge = bridge;
            }
        };

        window.GeminiToolbarUIActions = class {
            constructor() {}
        };

        window.GeminiCodeCopyHandler = class {
            constructor() {}
        };

        window.GeminiCustomSelectionToolsUI = class {
            constructor() {}
            render() {}
            getTools() {
                return [];
            }
            setTools() {}
        };

        window.GeminiTranslationTargetStore = class {
            getTargets() {
                return ['auto'];
            }
            setTargets(targets) {
                return targets;
            }
            restore() {
                return Promise.resolve(['auto']);
            }
            normalizeTargets() {}
        };

        window.GeminiDragController = class {
            constructor() {}
        };

        window.GeminiToolbarEvents = class {
            bind() {}
            disconnect() {}
        };

        window.GeminiViewLayout = {
            rememberOffsetFromDrag() {},
            resetOffset() {},
        };

        await import('./toolbar_ui.js');
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete window.GeminiToolbarUI;
        delete window.GeminiToolbarDOM;
        delete window.GeminiToolbarView;
        delete window.GeminiUIGrammar;
        delete window.GeminiRendererBridge;
        delete window.GeminiUIRenderer;
        delete window.GeminiToolbarUIActions;
        delete window.GeminiCodeCopyHandler;
        delete window.GeminiCustomSelectionToolsUI;
        delete window.GeminiTranslationTargetStore;
        delete window.GeminiDragController;
        delete window.GeminiToolbarEvents;
        delete window.GeminiViewLayout;
    });

    it('creates a Markdown renderer bridge on first build', () => {
        const ui = new window.GeminiToolbarUI();
        ui.build();

        expect(bridgeInstances).toHaveLength(1);
        expect(bridgeInstances[0].destroyed).toBe(false);
        expect(ui.bridge).toBe(bridgeInstances[0]);
        expect(ui.renderer.bridge).toBe(bridgeInstances[0]);
    });

    it('recreates the Markdown renderer bridge after language rebuild', () => {
        const ui = new window.GeminiToolbarUI();
        ui.build();
        const firstBridge = bridgeInstances[0];

        ui.rebuildForLanguageChange();

        expect(firstBridge.destroyed).toBe(true);
        expect(bridgeInstances).toHaveLength(2);
        expect(bridgeInstances[1].destroyed).toBe(false);
        expect(ui.bridge).toBe(bridgeInstances[1]);
        expect(ui.renderer.bridge).toBe(bridgeInstances[1]);
    });
});
