#!/usr/bin/env node
// Native messaging host for Gemini Nexus action logging.
// Reads 4-byte-LE-length-prefixed JSON log entries from stdin, appends each as
// a single line to the log file, with size-based rotation. Pure helpers are
// exported so the logic can be unit-tested without a real stdin.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_LOG_PATH = join(homedir(), 'Library', 'Logs', 'gemini-nexus.log');
export const ROTATE_BYTES = 10 * 1024 * 1024;

export function formatLogLine(entry) {
    const ts = entry?.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString();
    const level = String(entry?.level || 'INFO').toUpperCase();
    const ctx = entry?.context || 'System';
    const msg = entry?.message ?? '';
    const data = entry?.data ? ` ${JSON.stringify(entry.data)}` : '';
    return `[${ts}] [${level}] [${ctx}] ${msg}${data}`;
}

export function rotateIfNeeded(filePath, maxBytes = ROTATE_BYTES) {
    if (!existsSync(filePath)) return;
    let size = 0;
    try {
        size = statSync(filePath).size;
    } catch {
        return;
    }
    if (size >= maxBytes) {
        try {
            renameSync(filePath, `${filePath}.1`);
        } catch {
            // best-effort rotation; ignore failure
        }
    }
}

export function appendLogEntry(entry, filePath = DEFAULT_LOG_PATH, maxBytes = ROTATE_BYTES) {
    try {
        rotateIfNeeded(filePath, maxBytes);
        const dir = dirname(filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        appendFileSync(filePath, `${formatLogLine(entry)}\n`, 'utf8');
    } catch (error) {
        process.stderr.write(`[native-logger] append failed: ${error?.message ?? error}\n`);
    }
}

export function readFramedMessages(buffer) {
    const messages = [];
    let offset = 0;
    while (offset + 4 <= buffer.length) {
        const length = buffer.readUInt32LE(offset);
        if (length <= 0 || offset + 4 + length > buffer.length) break;
        const raw = buffer.subarray(offset + 4, offset + 4 + length).toString('utf8');
        try {
            messages.push(JSON.parse(raw));
        } catch {
            // skip unparseable frame
        }
        offset += 4 + length;
    }
    return { messages, rest: buffer.subarray(offset) };
}

export function main(logFilePath = DEFAULT_LOG_PATH) {
    let pending = Buffer.alloc(0);
    process.stdin.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        const { messages, rest } = readFramedMessages(pending);
        pending = rest;
        for (const entry of messages) appendLogEntry(entry, logFilePath);
    });
    process.stdin.on('end', () => process.exit(0));
}

const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;
if (invokedAsScript) main();
