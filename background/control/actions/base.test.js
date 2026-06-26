import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseActionHandler } from './base.js';

function createHandler() {
    const connection = { sendCommand: vi.fn(() => Promise.resolve({})) };
    return { handler: new BaseActionHandler(connection, {}, {}), connection };
}

describe('BaseActionHandler.bringPageToFront', () => {
    beforeEach(() => {
        globalThis.chrome = { storage: { local: { get: vi.fn(() => Promise.resolve({})) } } };
    });
    afterEach(() => {
        delete globalThis.chrome;
        vi.restoreAllMocks();
    });

    it('sends Page.bringToFront when BACKGROUND_INTERACTION_ENABLED is unset (default false)', async () => {
        const { handler, connection } = createHandler();
        await handler.bringPageToFront();
        expect(connection.sendCommand).toHaveBeenCalledWith('Page.bringToFront', {});
    });

    it('skips Page.bringToFront when BACKGROUND_INTERACTION_ENABLED is true', async () => {
        globalThis.chrome.storage.local.get = vi.fn(() =>
            Promise.resolve({ BACKGROUND_INTERACTION_ENABLED: true })
        );
        const { handler, connection } = createHandler();
        await handler.bringPageToFront();
        expect(connection.sendCommand).not.toHaveBeenCalled();
    });

    it('caches the focus-steal flag so repeated calls hit storage once', async () => {
        const get = vi.fn(() => Promise.resolve({}));
        globalThis.chrome.storage.local.get = get;
        const { handler } = createHandler();
        await handler._shouldSuppressFocusSteal();
        await handler._shouldSuppressFocusSteal();
        await handler._shouldSuppressFocusSteal();
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('does not let a missing chrome.runtime crash the action', async () => {
        delete globalThis.chrome;
        const { handler, connection } = createHandler();
        await handler.bringPageToFront();
        // Falls open: storage read fails -> suppress=false -> still brings to front.
        expect(connection.sendCommand).toHaveBeenCalledWith('Page.bringToFront', {});
    });
});
