import { asHttpUrl, mergeHeaders } from './transport.js';
import { readSseStream } from './sse_stream.js';

export async function connectSse(conn, sseUrlStr, { onRpcMessage, clearPending }) {
    const sseUrl = new URL(sseUrlStr);
    const abort = new AbortController();
    conn.sseAbort = abort;
    conn.ssePostUrl = null;

    // Clear any handshake timer left over from a previous (e.g. abandoned)
    // connect attempt so it can't reject a stale promise after we've moved on.
    if (conn._sseEndpointTimer) {
        clearTimeout(conn._sseEndpointTimer);
        conn._sseEndpointTimer = null;
    }

    const endpointPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            conn._sseEndpointTimer = null;
            reject(new Error('MCP SSE endpoint handshake timeout'));
        }, 10000);
        conn._sseEndpointTimer = timeout;
        conn._resolveSseEndpoint = (url) => {
            if (conn._sseEndpointTimer === timeout) {
                clearTimeout(timeout);
                conn._sseEndpointTimer = null;
            }
            resolve(url);
        };
    });

    const response = await fetch(sseUrl.toString(), {
        method: 'GET',
        headers: mergeHeaders(
            { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
            conn.headers
        ),
        signal: abort.signal,
    });

    if (!response.ok)
        throw new Error(`MCP SSE connect failed (${response.status}): ${response.statusText}`);
    if (!response.body) throw new Error('MCP SSE response has no body');

    conn.sseReaderTask = readSseStream(conn, response.body.getReader(), sseUrl, {
        resolvePendingRpcMessage: (message) => onRpcMessage(conn, message),
        clearPending: (error) => clearPending(conn, error),
    }).catch(() => {});

    conn.ssePostUrl = await endpointPromise;
}

export async function ensureSseConnected({
    conn,
    serverId,
    url,
    normalizedHeaders,
    headerKey,
    disconnectState,
    initializeHandshake,
    bumpIdleClose,
    onRpcMessage,
    clearPending,
}) {
    const sseUrlStr = asHttpUrl(url);
    if (!sseUrlStr) throw new Error('Invalid MCP SSE URL');
    const key = `sse:${sseUrlStr}:${headerKey}`;

    if (conn.transport === 'sse' && conn.initialized && conn.configKey === key && conn.ssePostUrl) {
        bumpIdleClose(conn, serverId);
        return conn;
    }

    disconnectState(conn);
    conn.configKey = key;
    conn.transport = 'sse';
    conn.headers = normalizedHeaders;

    await connectSse(conn, sseUrlStr, { onRpcMessage, clearPending });
    await initializeHandshake(conn);
    bumpIdleClose(conn, serverId);
    return conn;
}
