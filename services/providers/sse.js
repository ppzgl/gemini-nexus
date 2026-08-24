export async function readSseJson(response, onEvent, signal) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const MAX_BUFFER = 5 * 1024 * 1024;
    let cancelled = false;
    const onAbort = () => {
        cancelled = true;
        reader.cancel().catch(() => {});
    };
    if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
        while (true) {
            if (cancelled) break;
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > MAX_BUFFER) {
                throw new Error('SSE buffer overflow');
            }

            const lines = buffer.split(/\r\n|\n|\r/);
            buffer = lines.pop() || '';

            // Accumulate multi-data lines per event (SSE spec)
            let pendingData = [];
            const dispatch = async () => {
                if (pendingData.length === 0) return;
                const dataStr = pendingData.join('\n');
                pendingData = [];
                if (dataStr === '[DONE]') return;
                let eventPayload;
                try {
                    eventPayload = JSON.parse(dataStr);
                } catch {
                    return;
                }
                await onEvent(eventPayload);
            };

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed === '') {
                    await dispatch();
                    continue;
                }
                if (trimmed.startsWith(':')) continue; // comment / keep-alive
                if (trimmed.startsWith('data:')) {
                    const dataStr = trimmed.replace(/^data:\s?/, '');
                    pendingData.push(dataStr);
                    continue;
                }
                // ignore event/id/retry for generic JSON streaming
                if (
                    trimmed.startsWith('event:') ||
                    trimmed.startsWith('id:') ||
                    trimmed.startsWith('retry:')
                ) {
                    continue;
                }
            }
            // If no empty line delimiter, but we have accumulated data, dispatch on next chunk boundary
            // For single-line JSON events (common), dispatch immediately per line
            if (pendingData.length > 0 && lines.length > 0) {
                await dispatch();
            }
        }
        // Flush remaining buffer if it contains a final data: without trailing newline
        const tail = buffer.trim();
        if (tail.startsWith('data:')) {
            const dataStr = tail.replace(/^data:\s?/, '');
            if (dataStr && dataStr !== '[DONE]') {
                try {
                    const eventPayload = JSON.parse(dataStr);
                    await onEvent(eventPayload);
                } catch {}
            }
        } else if (tail) {
            try {
                const eventPayload = JSON.parse(tail);
                await onEvent(eventPayload);
            } catch {}
        }
    } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        try {
            reader.releaseLock();
        } catch {}
    }
}
