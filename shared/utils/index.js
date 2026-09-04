export { escapeHtml } from './escape.js';

export function extractFromHTML(variableName, html) {
    const regex = new RegExp(`"${variableName}":"([^"]+)"`);
    const match = regex.exec(html);
    return match?.[1];
}

export function generateUUID() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID().toUpperCase();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
        .replace(/[xy]/g, (placeholder) => {
            const randomNibble = (Math.random() * 16) | 0;
            const uuidNibble = placeholder === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
            return uuidNibble.toString(16);
        })
        .toUpperCase();
}

export function createPrefixedId(prefix) {
    const safePrefix = String(prefix || 'id')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `${safePrefix || 'id'}_${generateUUID()}`;
}

export async function dataUrlToBlob(dataUrl, maxBytes = 20 * 1024 * 1024) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        throw new Error('Invalid data URL: must be a string starting with "data:"');
    }

    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) {
        throw new Error('Invalid data URL: missing comma separator between header and data');
    }

    const header = dataUrl.slice(0, commaIndex);
    const base64Data = dataUrl.slice(commaIndex + 1);

    // Estimate before decoding: atob materializes several copies of the input
    // and an oversized payload would OOM the worker.
    const estimatedBytes = Math.floor(base64Data.replace(/\s+/g, '').length * 0.75);
    if (estimatedBytes > maxBytes) {
        throw new Error(
            `Data URL payload is too large (~${Math.round(estimatedBytes / 1048576)}MB); refusing to decode more than ${maxBytes / 1048576}MB.`
        );
    }

    const mimeMatch = header.match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) {
        throw new Error('Invalid data URL: could not extract MIME type from header');
    }

    const mimeType = mimeMatch[1];

    try {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);

        for (let index = 0; index < binaryString.length; index++) {
            bytes[index] = binaryString.charCodeAt(index);
        }

        return new Blob([bytes], { type: mimeType });
    } catch (error) {
        throw new Error('Failed to decode base64 data in data URL: ' + error.message);
    }
}

export function getHighResImageUrl(url) {
    if (!url) return null;

    // Robustly replace or append size parameter
    const parts = url.split('?');
    let base = parts[0];
    const query = parts.slice(1).join('?');

    // Remove any existing sizing parameter from the path, such as =w500-h500 or =s1024.
    base = base.replace(/=[a-zA-Z0-9_-]+$/, '');

    base += '=s0';

    return base + (query ? '?' + query : '');
}
