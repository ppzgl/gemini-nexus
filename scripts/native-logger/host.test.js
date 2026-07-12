import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatLogLine, appendLogEntry, rotateIfNeeded, readFramedMessages } from './host.js';

describe('formatLogLine', () => {
    it('formats a standard entry with ISO time, level, context, message', () => {
        const line = formatLogLine({
            timestamp: 1_718_000_000_000,
            level: 'info',
            context: 'browser_control.click',
            message: '点击元素',
        });
        expect(line).toMatch(
            /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[browser_control\.click\] 点击元素$/
        );
    });

    it('appends compact data json when data present', () => {
        const line = formatLogLine({
            level: 'warn',
            context: 'X',
            message: 'm',
            data: { ok: true, n: 3 },
        });
        expect(line).toMatch(/ \{"ok":true,"n":3\}$/);
    });

    it('omits data segment when absent', () => {
        expect(formatLogLine({ level: 'error', context: 'X', message: 'm' })).not.toContain('{');
    });

    it('uppercases level and defaults context/message', () => {
        expect(formatLogLine({ level: 'debug' })).toMatch(/\[DEBUG\] \[System\] $/);
    });
});

describe('rotateIfNeeded', () => {
    it('renames to .1 when file at or over maxBytes', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gn-host-'));
        const f = join(dir, 'a.log');
        writeFileSync(f, 'x'.repeat(100));
        rotateIfNeeded(f, 100);
        expect(readFileSync(join(dir, 'a.log.1'), 'utf8').length).toBe(100);
        rmSync(dir, { recursive: true, force: true });
    });

    it('leaves file untouched when under maxBytes', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gn-host-'));
        const f = join(dir, 'a.log');
        writeFileSync(f, 'small');
        rotateIfNeeded(f, 100);
        expect(readFileSync(f, 'utf8')).toBe('small');
        rmSync(dir, { recursive: true, force: true });
    });

    it('no-op when file does not exist', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gn-host-'));
        expect(() => rotateIfNeeded(join(dir, 'nope.log'), 1)).not.toThrow();
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('appendLogEntry', () => {
    it('appends one line per entry with trailing newline', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gn-host-'));
        const f = join(dir, 'sub', 'out.log');
        appendLogEntry({ level: 'info', context: 'C', message: 'first' }, f);
        appendLogEntry({ level: 'info', context: 'C', message: 'second' }, f);
        const text = readFileSync(f, 'utf8');
        expect(text.split('\n').filter(Boolean)).toHaveLength(2);
        expect(text).toContain('first');
        expect(text).toContain('second');
        rmSync(dir, { recursive: true, force: true });
    });

    it('rotates before append when over limit', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gn-host-'));
        const f = join(dir, 'out.log');
        writeFileSync(f, 'x'.repeat(50));
        appendLogEntry({ level: 'info', message: 'new' }, f, 10);
        expect(readFileSync(join(dir, 'out.log.1'), 'utf8').length).toBe(50);
        expect(readFileSync(f, 'utf8')).toContain('new');
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('readFramedMessages', () => {
    it('parses complete 4-byte-LE-length-prefixed JSON frames', () => {
        const a = Buffer.from(JSON.stringify({ message: 'a' }), 'utf8');
        const b = Buffer.from(JSON.stringify({ message: 'b' }), 'utf8');
        const buf = Buffer.concat([
            Buffer.from([a.length, 0, 0, 0]),
            a,
            Buffer.from([b.length, 0, 0, 0]),
            b,
        ]);
        const { messages, rest } = readFramedMessages(buf);
        expect(messages).toEqual([{ message: 'a' }, { message: 'b' }]);
        expect(rest.length).toBe(0);
    });

    it('keeps incomplete tail as rest', () => {
        const a = Buffer.from(JSON.stringify({ message: 'a' }), 'utf8');
        const partial = Buffer.from([5, 0, 0, 0]);
        const buf = Buffer.concat([Buffer.from([a.length, 0, 0, 0]), a, partial]);
        const { messages, rest } = readFramedMessages(buf);
        expect(messages).toEqual([{ message: 'a' }]);
        expect(rest.equals(partial)).toBe(true);
    });

    it('skips unparseable JSON frames', () => {
        const bad = Buffer.from('not-json', 'utf8');
        const buf = Buffer.concat([Buffer.from([bad.length, 0, 0, 0]), bad]);
        expect(readFramedMessages(buf).messages).toEqual([]);
    });
});
