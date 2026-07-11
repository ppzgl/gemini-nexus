/**
 * Maps string tool names to executable actions.
 * Decouples logic from the main ControlManager.
 */
export class ToolDispatcher {
    static DEBUGGER_OPTIONAL_TOOL_NAMES = new Set([
        'navigate_page',
        'new_page',
        'close_page',
        'list_pages',
        'select_page',
    ]);

    static LOCAL_TOOL_NAMES = new Set([
        // Navigation
        'navigate_page',
        'new_page',
        'close_page',
        'list_pages',
        'select_page',

        // Interaction
        'click',
        'hover',
        'fill',
        'fill_form',
        'press_key',
        'type_text',
        'attach_file',
        'drag',
        'scroll',

        // Observation & Logic
        'take_snapshot',
        'wait_for',
        'handle_dialog',
        'evaluate_script',
        'take_screenshot',
        'wait_for_url',
        'wait_for_load_state',
        'wait_for_timeout',

        // Composite
        'run_steps',
    ]);

    static SNAPSHOT_OPTIONAL_TOOL_NAMES = new Set([
        'click',
        'hover',
        'fill',
        'fill_form',
        'press_key',
        'type_text',
        'attach_file',
        'drag',
        'scroll',
    ]);

    // Maps a local tool name to the BrowserActions method that implements it.
    // Shared by ToolDispatcher.dispatch and CompositeActions.runSteps so the two
    // paths can never drift apart on which method backs a given tool. The one
    // entry without a `method` (`take_snapshot`) is served by the snapshot
    // manager directly and is flagged `snapshot: true` so callers route it there.
    static TOOL_METHOD_MAP = {
        // Navigation
        navigate_page: { method: 'navigatePage' },
        new_page: { method: 'newPage' },
        close_page: { method: 'closePage' },
        list_pages: { method: 'listPages' },
        select_page: { method: 'selectPage' },

        // Interaction
        click: { method: 'clickElement' },
        hover: { method: 'hoverElement' },
        fill: { method: 'fillElement' },
        fill_form: { method: 'fillForm' },
        press_key: { method: 'pressKey' },
        type_text: { method: 'typeText' },
        attach_file: { method: 'attachFile' },
        drag: { method: 'dragElement' },
        scroll: { method: 'scrollElement' },

        // Observation & Logic
        take_snapshot: { snapshot: true },
        wait_for: { method: 'waitFor' },
        handle_dialog: { method: 'handleDialog' },
        evaluate_script: { method: 'evaluateScript' },
        take_screenshot: { method: 'takeScreenshot' },
        wait_for_url: { method: 'waitForUrl' },
        wait_for_load_state: { method: 'waitForLoadState' },
        wait_for_timeout: { method: 'waitForTimeout' },

        // Composite
        run_steps: { method: 'runSteps' },
    };

    static isLocalTool(name) {
        return ToolDispatcher.LOCAL_TOOL_NAMES.has(name);
    }

    static requiresDebugger(name) {
        return !ToolDispatcher.DEBUGGER_OPTIONAL_TOOL_NAMES.has(name);
    }

    // Tools that switch the locked tab (new_page/close_page/select_page) and so
    // can only be the FINAL step of a composite run — see CompositeActions.
    static isTabSwitchingTool(name) {
        return ToolDispatcher.DEBUGGER_OPTIONAL_TOOL_NAMES.has(name) && name !== 'navigate_page';
    }

    constructor(actions, snapshotManager, connection = null) {
        this.actions = actions;
        this.snapshotManager = snapshotManager;
        this.connection = connection;
    }

    getOpenDialogText() {
        const dialog = this.connection?.getDialog?.();
        if (!dialog) return '';

        const defaultValue =
            dialog.type === 'prompt' && dialog.defaultPrompt
                ? ` (default value: "${dialog.defaultPrompt}")`
                : '';
        return `# Open dialog\n${dialog.type}: ${dialog.message}${defaultValue}.\nCall handle_dialog to handle it before continuing.`;
    }

    maybeAppendDialogHint(name, result) {
        if (name === 'handle_dialog' || typeof result !== 'string') return result;

        const dialogText = this.getOpenDialogText();
        if (!dialogText || result.includes('# Open dialog')) return result;

        return `${result}\n\n${dialogText}`;
    }

    async maybeAppendSnapshot(name, args, result) {
        if (
            !ToolDispatcher.SNAPSHOT_OPTIONAL_TOOL_NAMES.has(name) ||
            args?.includeSnapshot !== true ||
            typeof result !== 'string' ||
            result.startsWith('Error')
        ) {
            return result;
        }

        const dialogText = this.getOpenDialogText();
        if (dialogText) {
            return `${result}\n\n${dialogText}`;
        }

        const snapshot = await this.snapshotManager.takeSnapshot();
        return `${result}\n\n## Latest page snapshot\n${snapshot}`;
    }

    async dispatch(name, args) {
        let result;
        const entry = ToolDispatcher.TOOL_METHOD_MAP[name];

        if (entry?.snapshot) {
            result = await this.snapshotManager.takeSnapshot(args);
        } else if (entry?.method) {
            result = await this.actions[entry.method](args);
        } else {
            return `Error: Unknown tool '${name}'`;
        }

        result = await this.maybeAppendSnapshot(name, args, result);
        return this.maybeAppendDialogHint(name, result);
    }
}
