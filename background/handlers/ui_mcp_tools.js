import { respondWithUiTask } from './ui_async.js';

async function loadMcpTools(mcpManager, request, fallbackServerId) {
    if (!mcpManager) throw new Error('MCP manager not available');

    const url = (request.url || '').trim();
    const transport = (request.transport || 'sse').toLowerCase();
    if (!url) throw new Error('Server URL is empty');

    const tools = await mcpManager.listTools({
        enableMcpTools: true,
        mcpTransport: transport,
        mcpServerUrl: url,
        mcpServerId: request.serverId || fallbackServerId,
        mcpHeaders: request.headers,
    });

    return { tools, transport, url };
}

export function handleMcpTestConnection(mcpManager, request, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            const { tools, transport, url } = await loadMcpTools(mcpManager, request, '_test_');

            return {
                action: 'MCP_TEST_RESULT',
                ok: true,
                serverId: request.serverId || null,
                transport,
                url,
                toolsCount: Array.isArray(tools) ? tools.length : 0,
            };
        },
        {
            errorResponse: (error) => ({
                action: 'MCP_TEST_RESULT',
                ok: false,
                serverId: request.serverId || null,
                transport: request.transport || 'sse',
                url: request.url || '',
                error: error.message || String(error),
            }),
        }
    );
}

export function handleMcpListTools(mcpManager, request, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            const { tools, transport, url } = await loadMcpTools(mcpManager, request, '_tools_');

            return {
                action: 'MCP_TOOLS_RESULT',
                ok: true,
                serverId: request.serverId || null,
                requestKey: request.requestKey || null,
                transport,
                url,
                tools: toSafeMcpTools(tools),
            };
        },
        {
            errorResponse: (error) => ({
                action: 'MCP_TOOLS_RESULT',
                ok: false,
                serverId: request.serverId || null,
                requestKey: request.requestKey || null,
                transport: request.transport || 'sse',
                url: request.url || '',
                error: error.message || String(error),
                tools: [],
            }),
        }
    );
}

// Disconnect the live transport (and clear its tool-list cache) for one or
// more MCP servers. Called by the settings UI when a server is removed,
// disabled, or its transport/URL/headers change on save — without this the
// old SSE/WebSocket/streamable-HTTP transport stays open in the background's
// connection map and the UI keeps showing stale tools for a server that no
// longer exists or was reconfigured. disconnect() is a no-op if the server
// was never connected, so it is safe to call speculatively.
export function handleMcpDisconnect(mcpManager, request, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            if (!mcpManager) throw new Error('MCP manager not available');
            const serverIds = Array.isArray(request?.serverIds)
                ? request.serverIds.filter(Boolean)
                : request?.serverId
                  ? [request.serverId]
                  : [];
            await Promise.all(
                serverIds.map((serverId) =>
                    mcpManager.disconnect(serverId).catch((error) => {
                        console.warn(
                            '[MCP] Failed to disconnect server',
                            serverId,
                            error?.message || error
                        );
                    })
                )
            );
            return { action: 'MCP_DISCONNECT_RESULT', ok: true, serverIds };
        },
        {
            errorResponse: (error) => ({
                action: 'MCP_DISCONNECT_RESULT',
                ok: false,
                serverIds: request?.serverIds || (request?.serverId ? [request.serverId] : []),
                error: error.message || String(error),
            }),
        }
    );
}

function toSafeMcpTools(tools) {
    return Array.isArray(tools)
        ? tools.map((tool) => ({
              name: tool.name,
              description: tool.description || '',
          }))
        : [];
}
