import { describe, expect, it, vi } from 'vitest';
import { NativeLoggerSink } from './native_logger_sink.js';

function makeMockRuntime({ connectThrows = false } = {}) {
    const listeners = { disconnect: null };
    const port = {
        postMessage: vi.fn(),
        disconnect: vi.fn(() => listeners.disconnect?.()),
        onDisconnect: { addListener: (fn) => (listeners.disconnect = fn) },
    };
    const connectNative = vi.fn(() => {
        if (connectThrows) throw new Error('no host');
        return port;
    });
    return { runtime: { connectNative }, port, listeners };
}

describe('NativeLoggerSink', () => {
    it('does nothing when disabled', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: false });
        sink.log({ level: 'info', message: 'x' });
        expect(runtime.connectNative).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('connects lazily and posts when enabled', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', context: 'C', message: 'hi' });
        expect(runtime.connectNative).toHaveBeenCalledWith('com.gemini_nexus.logger');
        expect(port.postMessage).toHaveBeenCalledTimes(1);
        const sent = port.postMessage.mock.calls[0][0];
        expect(sent.message).toBe('hi');
        expect(sent.context).toBe('C');
        expect(typeof sent.timestamp).toBe('number');
    });

    it('reuses a single port across entries', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'a' });
        sink.log({ level: 'info', message: 'b' });
        expect(runtime.connectNative).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
    });

    it('filters below minLevel', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true, minLevel: 'warn' });
        sink.log({ level: 'debug', message: 'skip' });
        sink.log({ level: 'info', message: 'skip' });
        sink.log({ level: 'warn', message: 'keep' });
        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(port.postMessage.mock.calls[0][0].level).toBe('warn');
    });

    it('buffers while disconnected and flushes on reconnect', () => {
        const listeners = { disconnect: null };
        let connectFails = true;
        const port = {
            postMessage: vi.fn(),
            disconnect: vi.fn(),
            onDisconnect: { addListener: (fn) => (listeners.disconnect = fn) },
        };
        const runtime = {
            connectNative: vi.fn(() => {
                if (connectFails) throw new Error('down');
                return port;
            }),
        };
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'queued' }); // connect fails → buffered
        expect(port.postMessage).not.toHaveBeenCalled();

        connectFails = false;
        sink.log({ level: 'info', message: 'live' }); // connects → flush buffered + this
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        const msgs = port.postMessage.mock.calls.map((c) => c[0].message);
        expect(msgs).toEqual(['queued', 'live']);
    });

    it('drops internal port on disconnect, reconnects next log', () => {
        const { runtime, port, listeners } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'one' });
        listeners.disconnect(); // simulate host disconnect
        sink.log({ level: 'info', message: 'two' });
        expect(runtime.connectNative).toHaveBeenCalledTimes(2);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
    });

    it('setEnabled(false) disconnects and stops sending', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'x' });
        sink.setEnabled(false);
        expect(port.disconnect).toHaveBeenCalled();
        sink.log({ level: 'info', message: 'y' });
        expect(port.postMessage).toHaveBeenCalledTimes(1); // only 'x'
    });
});
