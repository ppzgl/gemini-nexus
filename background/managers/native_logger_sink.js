// Forwards log entries to the native logger host via chrome.runtime.connectNative.
// Lazy-connects on first send, drops the port on disconnect, reconnects on the
// next send, and buffers a small backlog while disconnected so service-worker
// restarts and host hiccups don't drop entries. Never throws — logging must
// never break the caller.

const DEFAULT_HOST_NAME = 'com.gemini_nexus.logger';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const BUFFER_LIMIT = 200;

export class NativeLoggerSink {
    constructor({ runtime, hostName = DEFAULT_HOST_NAME, minLevel = 'info', enabled = false } = {}) {
        this.runtime = runtime ?? (typeof chrome !== 'undefined' ? chrome.runtime : undefined);
        this.hostName = hostName;
        this.minLevel = LEVELS[minLevel] ?? LEVELS.info;
        this.enabled = !!enabled;
        this._port = null;
        this._buffer = [];
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (!this.enabled) this._disconnect();
    }

    setMinLevel(level) {
        if (LEVELS[level] != null) this.minLevel = LEVELS[level];
    }

    log(entry) {
        if (!this.enabled) return;
        if (!entry || !this._passesLevel(entry)) return;
        this._send(entry);
    }

    _passesLevel(entry) {
        const lvl = LEVELS[String(entry.level).toLowerCase()] ?? LEVELS.info;
        return lvl >= this.minLevel;
    }

    _serialize(entry) {
        return {
            timestamp: entry.timestamp ?? Date.now(),
            level: entry.level || 'INFO',
            context: entry.context || 'System',
            message: entry.message ?? '',
            ...(entry.data != null ? { data: entry.data } : {}),
        };
    }

    _send(entry) {
        if (!this.runtime?.connectNative) return;
        const port = this._getPort();
        if (!port) {
            this._pushBuffer(entry);
            return;
        }
        try {
            port.postMessage(this._serialize(entry));
        } catch {
            this._port = null;
            this._pushBuffer(entry);
        }
    }

    _getPort() {
        if (this._port) return this._port;
        try {
            const port = this.runtime.connectNative(this.hostName);
            port.onDisconnect?.addListener(() => {
                this._port = null;
            });
            this._port = port;
            this._flushBuffer();
            return port;
        } catch {
            this._port = null;
            return null;
        }
    }

    _disconnect() {
        try {
            this._port?.disconnect();
        } catch {
            // ignore
        }
        this._port = null;
        this._buffer = [];
    }

    _pushBuffer(entry) {
        this._buffer.push(entry);
        if (this._buffer.length > BUFFER_LIMIT) this._buffer.shift();
    }

    _flushBuffer() {
        if (!this._port || this._buffer.length === 0) return;
        const pending = this._buffer.splice(0);
        for (const entry of pending) {
            try {
                this._port.postMessage(this._serialize(entry));
            } catch {
                this._buffer.push(entry);
                break;
            }
        }
    }
}
