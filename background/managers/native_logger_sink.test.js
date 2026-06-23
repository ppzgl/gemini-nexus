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

    it('_serialize cleans circular/unclonable data so postMessage never throws', () => {
        const sink = new NativeLoggerSink({ runtime: { connectNative: () => {} }, enabled: true });
        const circular = { a: 1 };
        circular.self = circular;
        const fn = () => {};
        const serialized = sink._serialize({ level: 'info', message: 'm', data: { circular, fn } });
        // 模拟 postMessage 的结构化克隆:能 JSON round-trip 即可克隆
        expect(() => JSON.parse(JSON.stringify(serialized))).not.toThrow();
        expect(serialized.message).toBe('m');
    });

    it('flush re-queues the failing entry AND all later entries (none lost, order kept)', () => {
        let connectOk = false;
        const goodPort = {
            postMessage: vi.fn((e) => {
                if (e.message === 'fail') throw new Error('clone err');
            }),
            disconnect: vi.fn(),
            onDisconnect: { addListener: () => {} },
        };
        const runtime = {
            connectNative: vi.fn(() => {
                if (!connectOk) throw new Error('down');
                return goodPort;
            }),
        };
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'a' });   // buffer (connect down)
        sink.log({ level: 'info', message: 'fail' }); // buffer
        sink.log({ level: 'info', message: 'b' });   // buffer
        connectOk = true;
        sink.log({ level: 'info', message: 'c' });   // connect ok → flush then send c

        const sent = goodPort.postMessage.mock.calls.map((c) => c[0].message);
        expect(sent).toEqual(['a', 'fail', 'c']); // a flushed ok; fail attempted but threw; c sent via _send
        expect(sent).not.toContain('b'); // b never attempted — re-queued after the failing entry
        expect(sink._buffer.map((e) => e.message)).toEqual(['fail', 'b']); // both re-queued in order
    });
});
