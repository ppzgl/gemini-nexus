# Native 动作日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Gemini-Nexus 现有日志系统加一个 native messaging 出口,把所有 background 动作日志持续 append 到 `~/Library/Logs/gemini-nexus.log`,Claude 可用 `tail/grep` 读取。

**Architecture:** 复用现有 `LogManager` + `setupConsoleInterception`(已全局拦截所有 background `console.*`、已脱敏、已分级)。新增一个 `NativeLoggerSink`:`LogManager.add()` 时把 entry 通过 `chrome.runtime.connectNative` 发给本地 Node host,host append 到日志文件(>10MB 轮转)。安装器从 `manifest.json` 的 `key` 算扩展 ID,生成 native messaging host manifest。开关用 storage key `geminiNativeLogEnabled`(默认关),`chrome.storage.onChanged` 实时响应。

**Tech Stack:** MV3 Chrome 扩展(vite 构建,ES modules),Node native messaging host(stdio framed JSON),vitest 测试。

## Global Constraints

- 仅 macOS:日志路径固定 `~/Library/Logs/gemini-nexus.log`;native messaging host manifest 路径 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`。
- 扩展 ID 由 `manifest.json` 的 `key` 字段算出,实测为 `ccmbheekkhlgfggi`(算法:对 key 的 base64 DER 做 SHA256,取前 16 字节,每字节 `97 + (byte % 16)` 映射到 `a-p`)。
- 默认关:`geminiNativeLogEnabled` 默认 `false`;默认脱敏沿用现有 `setupConsoleInterception` 的 `[REDACTED]` 逻辑(prompt 正文不会被 `console.*` 拦截路径额外记录,密钥已被 redact)。
- 日志 entry 形状沿用现有标准:`{ timestamp, level, context, message, data? }`(见 `formatLogDownloadText`),行格式 `[ISO] [LEVEL] [context] message {data}`。
- 测试用 vitest,运行单文件:`npx vitest run <path>`。
- 提交信息沿用项目惯例(`feat:` / `chore:` 前缀)。
- 平台脚本目录 `scripts/native-logger/` 内放 host;安装器在 `scripts/`。

## File Structure

**新增**:
- `scripts/native-logger/host.js` — Node native messaging host:读 stdin framed JSON,格式化行,append 日志文件,>10MB 轮转。导出纯函数便于测试。
- `scripts/native-logger/host.test.js`
- `scripts/install-native-logger.mjs` — 落 host 脚本 + 写 NativeMessagingHosts manifest。导出 `extensionIdFromKey` / `buildHostManifest` / `install` / `uninstall`。
- `scripts/install-native-logger.test.js`
- `background/managers/native_logger_sink.js` — `NativeLoggerSink` 类:lazy `connectNative`、断开重连、缓冲补发、级别过滤。
- `background/managers/native_logger_sink.test.js`

**修改**:
- `background/managers/log_manager.js` — `LogManager` 构造接收 `sinks=[]`;`add()` 通知 sinks。
- `background/managers/log_manager.test.js` — 新增 sinks 测试。
- `background/index.js` — 实例化 sink、传入 LogManager、读 storage 配置、监听 `storage.onChanged`。
- `manifest.json` — `permissions` 加 `"nativeMessaging"`。

**后续(不在本计划)**:设置页正式 UI 开关(走 standalone bridge + sandbox/ui template 双体系),文档化对外开关 API。

---

### Task 1: Native host(`scripts/native-logger/host.js`)

**Files:**
- Create: `scripts/native-logger/host.js`
- Test: `scripts/native-logger/host.test.js`

**Interfaces:**
- Produces: `formatLogLine(entry)`, `appendLogEntry(entry, filePath)`, `rotateIfNeeded(filePath, maxBytes)`, `readFramedMessages(buffer)`, `main(logFilePath)`. Entry 形状 `{timestamp, level, context, message, data?}`。

- [ ] **Step 1: Write the failing test**

Create `scripts/native-logger/host.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
        expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[browser_control\.click\] 点击元素$/);
    });

    it('appends compact data json when data present', () => {
        const line = formatLogLine({ level: 'warn', context: 'X', message: 'm', data: { ok: true, n: 3 } });
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
        appendLogEntry({ level: 'info', message: 'new' }, f);
        expect(readFileSync(join(dir, 'out.log.1'), 'utf8').length).toBe(50);
        expect(readFileSync(f, 'utf8')).toContain('new');
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('readFramedMessages', () => {
    it('parses complete 4-byte-LE-length-prefixed JSON frames', () => {
        const a = Buffer.from(JSON.stringify({ message: 'a' }), 'utf8');
        const b = Buffer.from(JSON.stringify({ message: 'b' }), 'utf8');
        const buf = Buffer.concat([Buffer.from([a.length, 0, 0, 0]), a, Buffer.from([b.length, 0, 0, 0]), b]);
        const { messages, rest } = readFramedMessages(buf);
        expect(messages).toEqual([{ message: 'a' }, { message: 'b' }]);
        expect(rest.length).toBe(0);
    });

    it('keeps incomplete tail as rest', () => {
        const a = Buffer.from(JSON.stringify({ message: 'a' }), 'utf8');
        const partial = Buffer.from([5, 0, 0, 0]); // claims 5 bytes, none follow
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/native-logger/host.test.js`
Expected: FAIL — `Cannot find module './host.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/native-logger/host.js`:

```js
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
    const data = entry?.data ? ` {${JSON.stringify(entry.data)}}` : '';
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

export function appendLogEntry(entry, filePath = DEFAULT_LOG_PATH) {
    try {
        rotateIfNeeded(filePath);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/native-logger/host.test.js`
Expected: PASS (all `describe` blocks green).

- [ ] **Step 5: Commit**

```bash
git add scripts/native-logger/host.js scripts/native-logger/host.test.js
git commit -m "feat: add native logging host that appends framed JSON to a log file"
```

---

### Task 2: 安装器(`scripts/install-native-logger.mjs`)

**Files:**
- Create: `scripts/install-native-logger.mjs`
- Test: `scripts/install-native-logger.test.js`

**Interfaces:**
- Consumes: `scripts/native-logger/host.js`(作为 source host 复制到稳定路径);`manifest.json` 的 `key` 字段。
- Produces: `extensionIdFromKey(keyBase64) → string`,`buildHostManifest({extensionId, hostScriptPath, name?, description?}) → object`,`install({extensionId?, hostScriptPath?, manifestDir?, sourceHost?}) → {extensionId, hostScriptPath, manifestPath}`,`uninstall({manifestDir?, hostScriptPath?})`。

- [ ] **Step 1: Write the failing test**

Create `scripts/install-native-logger.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extensionIdFromKey, buildHostManifest, install, uninstall } from './install-native-logger.mjs';

// Gemini-Nexus manifest.json 的 key 字段(实测对应扩展 ID ccmbheekkhlgfggi)
const GN_KEY =
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8Tkiv3U7GyFUNtXT6vE1OxnZpHwbTDeSYinDy/G4Nh1480o1VTll9MpwJhJlvze2Yb8jDTsEHdL/UkLj5wov8E9GdNT0Moegpi1hvnKZeHqQGA1AnFKmfucM+OXPWeQsRcS/FcbL/TPeXeit7mfNKE8Vfcf9CeD25JszJyp9K6guNIksmxX27sQC34BNZU1MTzi8l3jm3ORHQ3pRcb66XD2RkW8QcoklRlRzZ7z6FgMB/AJPxHczRVQV2x7BGtbgudWF7EYxjeL6edtG7U+9GtOmentqGaRNkitFsd8SP6ZYoI+lxssDqp2PtyYjj6Ki6+/t9q5Q0WOR6ib0w2VVCwIDAQAB';

describe('extensionIdFromKey', () => {
    it('derives the known Gemini-Nexus extension ID', () => {
        expect(extensionIdFromKey(GN_KEY)).toBe('ccmbheekkhlgfggi');
    });

    it('is a 16-char lowercase a-p string', () => {
        expect(extensionIdFromKey(GN_KEY)).toMatch(/^[a-p]{16}$/);
    });
});

describe('buildHostManifest', () => {
    it('produces a stdio host manifest with the extension origin allowed', () => {
        const m = buildHostManifest({ extensionId: 'ccmbheekkhlgfggi', hostScriptPath: '/Users/x/.gemini-nexus/native-logger.js' });
        expect(m).toEqual({
            name: 'com.gemini_nexus.logger',
            description: 'Gemini Nexus action logger',
            type: 'stdio',
            path: '/Users/x/.gemini-nexus/native-logger.js',
            allowed_origins: ['chrome-extension://ccmbheekkhlgfggi/'],
        });
    });

    it('allows overriding name and description', () => {
        const m = buildHostManifest({ extensionId: 'abcdefghijklmnop', hostScriptPath: '/p', name: 'other', description: 'd' });
        expect(m.name).toBe('other');
        expect(m.description).toBe('d');
    });
});

describe('install / uninstall', () => {
    it('copies host and writes host manifest into target dirs', () => {
        const work = mkdtempSync(join(tmpdir(), 'gn-install-'));
        const hostDir = join(work, 'host');
        const hostScriptPath = join(hostDir, 'native-logger.js');
        const manifestDir = join(work, 'manifest');
        const sourceHost = new URL('./native-logger/host.js', import.meta.url).pathname;

        const result = install({ extensionId: 'ccmbheekkhlgfggi', hostScriptPath, manifestDir, sourceHost });
        expect(existsSync(hostScriptPath)).toBe(true);
        expect(result.manifestPath).toBe(join(manifestDir, 'com.gemini_nexus.logger.json'));
        const written = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
        expect(written.allowed_origins).toEqual(['chrome-extension://ccmbheekkhlgfggi/']);
        expect(written.path).toBe(hostScriptPath);

        uninstall({ manifestDir, hostScriptPath });
        expect(existsSync(result.manifestPath)).toBe(false);
        expect(existsSync(hostScriptPath)).toBe(false);
        rmSync(work, { recursive: true, force: true });
    });

    it('is idempotent on repeat install', () => {
        const work = mkdtempSync(join(tmpdir(), 'gn-install-'));
        const opts = {
            extensionId: 'ccmbheekkhlgfggi',
            hostScriptPath: join(work, 'native-logger.js'),
            manifestDir: join(work, 'manifest'),
            sourceHost: new URL('./native-logger/host.js', import.meta.url).pathname,
        };
        install(opts);
        expect(() => install(opts)).not.toThrow();
        rmSync(work, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/install-native-logger.test.js`
Expected: FAIL — `Cannot find module './install-native-logger.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/install-native-logger.mjs`:

```js
#!/usr/bin/env node
// Installs the Gemini Nexus native logger host: copies host.js to a stable
// path under ~/.gemini-nexus/ and writes the Chrome NativeMessagingHosts
// manifest whose allowed_origins pins this extension's ID. Run with --uninstall
// to remove. Run from the project root so manifest.json's key can be read.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.gemini_nexus.logger';
export const DEFAULT_HOST_DIR = join(homedir(), '.gemini-nexus');
export const DEFAULT_HOST_SCRIPT = join(DEFAULT_HOST_DIR, 'native-logger.js');
export const DEFAULT_SOURCE_HOST = fileURLToPath(new URL('./native-logger/host.js', import.meta.url));
export const DEFAULT_MANIFEST_DIR = join(
    homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts'
);
export const DEFAULT_MANIFEST_PATH = join(DEFAULT_MANIFEST_DIR, `${HOST_NAME}.json`);

export function extensionIdFromKey(keyBase64) {
    const der = Buffer.from(keyBase64, 'base64');
    const hash = createHash('sha256').update(der).digest();
    let id = '';
    for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (hash[i] % 16));
    return id;
}

export function buildHostManifest({ extensionId, hostScriptPath, name = HOST_NAME, description = 'Gemini Nexus action logger' }) {
    return {
        name,
        description,
        type: 'stdio',
        path: hostScriptPath,
        allowed_origins: [`chrome-extension://${extensionId}/`],
    };
}

function readManifestKey(manifestPath) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest.key) {
        throw new Error(`${manifestPath} has no "key" field; pass an explicit --extension-id.`);
    }
    return manifest.key;
}

export function install({
    extensionId,
    hostScriptPath = DEFAULT_HOST_SCRIPT,
    manifestDir = DEFAULT_MANIFEST_DIR,
    sourceHost = DEFAULT_SOURCE_HOST,
    manifestPath = join(process.cwd(), 'manifest.json'),
} = {}) {
    if (!extensionId) {
        extensionId = extensionIdFromKey(readManifestKey(manifestPath));
    }
    mkdirSync(dirname(hostScriptPath), { recursive: true });
    copyFileSync(sourceHost, hostScriptPath);
    mkdirSync(manifestDir, { recursive: true });
    const writtenPath = join(manifestDir, `${HOST_NAME}.json`);
    writeFileSync(writtenPath, `${JSON.stringify(buildHostManifest({ extensionId, hostScriptPath }), null, 2)}\n`, 'utf8');
    return { extensionId, hostScriptPath, manifestPath: writtenPath };
}

export function uninstall({
    manifestDir = DEFAULT_MANIFEST_DIR,
    hostScriptPath = DEFAULT_HOST_SCRIPT,
} = {}) {
    rmSync(join(manifestDir, `${HOST_NAME}.json`), { force: true });
    rmSync(hostScriptPath, { force: true });
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--uninstall')) {
        uninstall();
        console.log('Native logger host uninstalled.');
        return;
    }
    const idIdx = args.indexOf('--extension-id');
    const result = install({ extensionId: idIdx !== -1 ? args[idIdx + 1] : undefined });
    console.log('Installed native logger host.');
    console.log(`  Extension ID:  ${result.extensionId}`);
    console.log(`  Host script:   ${result.hostScriptPath}`);
    console.log(`  Host manifest: ${result.manifestPath}`);
    console.log('  Log file:      ~/Library/Logs/gemini-nexus.log');
}

const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;
if (invokedAsScript) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/install-native-logger.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-native-logger.mjs scripts/install-native-logger.test.js
git commit -m "feat: add native logger host installer that derives the extension ID from manifest key"
```

---

### Task 3: Native sink(`background/managers/native_logger_sink.js`)

**Files:**
- Create: `background/managers/native_logger_sink.js`
- Test: `background/managers/native_logger_sink.test.js`

**Interfaces:**
- Consumes: `chrome.runtime.connectNative`(构造时注入,便于测试 mock);entry 形状 `{timestamp, level, context, message, data?}`。
- Produces: `class NativeLoggerSink { constructor({runtime?, hostName?, minLevel?, enabled?}); setEnabled(bool); setMinLevel(level); log(entry) }`。

- [ ] **Step 1: Write the failing test**

Create `background/managers/native_logger_sink.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run background/managers/native_logger_sink.test.js`
Expected: FAIL — `Cannot find module './native_logger_sink.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `background/managers/native_logger_sink.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run background/managers/native_logger_sink.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add background/managers/native_logger_sink.js background/managers/native_logger_sink.test.js
git commit -m "feat: add NativeLoggerSink forwarding log entries to the native host"
```

---

### Task 4: 集成 sink 到 LogManager + manifest 权限 + background 接线

**Files:**
- Modify: `background/managers/log_manager.js`
- Modify: `background/managers/log_manager.test.js`
- Modify: `background/index.js:5`(import)及 `:27` 附近(实例化)
- Modify: `manifest.json`(`permissions` 数组)

**Interfaces:**
- Consumes: `NativeLoggerSink`(Task 3);现有 `LogManager` + `setupConsoleInterception`。
- Produces: `LogManager(sinks = [])` 构造;`LogManager.add()` 会把 entry 推给每个 sink 的 `log(entry)`。Background 启动时按 storage `geminiNativeLogEnabled` / `geminiNativeLogEnabled` 配置 sink,并监听 `chrome.storage.onChanged`。

- [ ] **Step 1: Write the failing test (LogManager sinks)**

Append to `background/managers/log_manager.test.js`(在文件末尾追加,保留现有 import 与 describe):

```js
import { LogManager } from './log_manager.js';

describe('LogManager sinks', () => {
    it('notifies registered sinks on add()', () => {
        const sink = { log: vi.fn() };
        const manager = new LogManager([sink]);
        // avoid hitting real chrome.storage in unit test
        manager._save = () => {};
        manager.add({ level: 'INFO', context: 'X', message: 'm' });
        expect(sink.log).toHaveBeenCalledTimes(1);
        expect(sink.log.mock.calls[0][0]).toMatchObject({ level: 'INFO', context: 'X', message: 'm' });
    });

    it('works with no sinks (backward compatible)', () => {
        const manager = new LogManager();
        manager._save = () => {};
        expect(() => manager.add({ level: 'INFO', message: 'm' })).not.toThrow();
    });

    it('keeps working if a sink throws', () => {
        const broken = { log: () => { throw new Error('boom'); } };
        const ok = { log: vi.fn() };
        const manager = new LogManager([broken, ok]);
        manager._save = () => {};
        manager.add({ level: 'INFO', message: 'm' });
        expect(ok.log).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run background/managers/log_manager.test.js`
Expected: FAIL — `manager.add` does not call sinks / `LogManager` ignores constructor arg.

- [ ] **Step 3: Modify `log_manager.js` to accept and notify sinks**

In `background/managers/log_manager.js`:

Change constructor signature and add sink fan-out. Replace the existing `constructor()` and `add(entry)` methods:

```js
    constructor(sinks = []) {
        this.logs = [];
        this.MAX_LOGS = 5000;
        this.STORAGE_KEY = 'gemini_nexus_logs';
        this.sinks = Array.isArray(sinks) ? sinks : [];
        this.init();
    }
```

```js
    add(entry) {
        if (!entry.timestamp) entry.timestamp = Date.now();

        this.logs.push(entry);

        if (this.logs.length > this.MAX_LOGS) {
            this.logs = this.logs.slice(-this.MAX_LOGS);
        }

        this._save();

        for (const sink of this.sinks) {
            try {
                sink.log(entry);
            } catch {
                // a sink must never break logging
            }
        }
    }
```

(Leave `init`, `_save`, `getLogs`, `clear`, and `setupConsoleInterception` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run background/managers/log_manager.test.js`
Expected: PASS (existing redaction tests + new sink tests).

- [ ] **Step 5: Add nativeMessaging permission to manifest**

In `manifest.json`, add `"nativeMessaging"` to the `permissions` array (after `"tabGroups"`):

```json
    "permissions": [
        "sidePanel",
        "storage",
        "contextMenus",
        "scripting",
        "alarms",
        "debugger",
        "tabs",
        "tabGroups",
        "nativeMessaging"
    ],
```

- [ ] **Step 6: Wire sink into background/index.js**

In `background/index.js`, add the import next to the existing `log_manager.js` import (line 5 area):

```js
import { LogManager, setupConsoleInterception } from './managers/log_manager.js';
import { NativeLoggerSink } from './managers/native_logger_sink.js';
```

Replace the block:
```js
const logManager = new LogManager();

setupConsoleInterception(logManager);
```
with:
```js
const nativeLoggerSink = new NativeLoggerSink({ minLevel: 'info', enabled: false });
const logManager = new LogManager([nativeLoggerSink]);

chrome.storage.local.get(['geminiNativeLogEnabled', 'geminiNativeLogLevel'], (result) => {
    nativeLoggerSink.setEnabled(result.geminiNativeLogEnabled === true);
    if (result.geminiNativeLogLevel) nativeLoggerSink.setMinLevel(result.geminiNativeLogLevel);
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.geminiNativeLogEnabled) {
        nativeLoggerSink.setEnabled(changes.geminiNativeLogEnabled.newValue === true);
    }
    if (changes.geminiNativeLogLevel) {
        nativeLoggerSink.setMinLevel(changes.geminiNativeLogLevel.newValue);
    }
});

setupConsoleInterception(logManager);
```

- [ ] **Step 7: Verify build + tests**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add background/managers/log_manager.js background/managers/log_manager.test.js background/index.js manifest.json
git commit -m "feat: fan LogManager entries out to NativeLoggerSink and gate on storage"
```

---

### Task 5: 安装、打包、手动集成验证

**Files:**
- Run: `scripts/install-native-logger.mjs`
- Run: `npm run package:extension`
- (No code edits — verification task.)

**Interfaces:**
- Consumes: Task 1 host, Task 2 installer, Task 3 sink, Task 4 wiring + permission.

- [ ] **Step 1: Install the native host**

Run: `node scripts/install-native-logger.mjs`
Expected stdout includes:
```
Installed native logger host.
  Extension ID:  ccmbheekkhlgfggi
  Host script:   /Users/<user>/.gemini-nexus/native-logger.js
  Host manifest: /Users/<user>/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.gemini_nexus.logger.json
```

Verify the host manifest's `allowed_origins` is `["chrome-extension://ccmbheekkhlgfggi/"]`:
Run: `cat "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.gemini_nexus.logger.json"`

- [ ] **Step 2: Make host script executable**

Run: `chmod +x ~/.gemini-nexus/native-logger.js`

- [ ] **Step 3: Package the extension**

Run: `npm run package:extension`
Expected: ends with `Extension package prepared at artifacts/chrome-extension`.

Verify the new permission and a built-in sink reference made it into the artifact:
Run: `grep -c nativeMessaging artifacts/chrome-extension/manifest.json` → expect `1`.
Run: `grep -l "com.gemini_nexus.logger" artifacts/chrome-extension/background/index.js` → expect a match.

- [ ] **Step 4: Reload extension and enable logging**

Manual: open `chrome://extensions`, reload Gemini Nexus, click into the service worker DevTools console. In **any** extension page console (e.g. the service worker console, or a sidepanel page), run:
```js
chrome.storage.local.set({ geminiNativeLogEnabled: true })
```
Expected: no error. `chrome.runtime.lastError` is undefined.

- [ ] **Step 5: Trigger an action and confirm the log file**

Manual: perform any browser-control action (e.g. ask the AI to click something) so background emits `console.*` calls that route through `LogManager.add` → sink → host.

Run: `tail -n 20 ~/Library/Logs/gemini-nexus.log`
Expected: lines shaped `[2026-06-23T...Z] [INFO] [System] ...`. Secret values appear as `[REDACTED]`.

- [ ] **Step 6: Confirm Claude can read it**

Run: `grep -c '\[INFO\]' ~/Library/Logs/gemini-nexus.log`
Expected: a non-zero integer.

- [ ] **Step 7: Document and commit**

Append a short section to the bottom of `docs/native-action-logging-design.md` recording: install command, enable command (`chrome.storage.local.set({ geminiNativeLogEnabled: true })`), log path, disable command (`set({ geminiNativeLogEnabled: false })`), uninstall command (`node scripts/install-native-logger.mjs --uninstall`).

Run:
```bash
git add docs/native-action-logging-design.md
git commit -m "docs: record native logger install/enable/disable commands"
```

---

## Self-Review Notes

**Spec coverage**: spec §4.1–4.5 — logger/sink/host/installer/manifest all map to Tasks 1–4. Spec §6 行格式 → Task 1 `formatLogLine`. Spec §7 配置默认值(default off / redaction) → Task 4 storage gating + 现有 redaction 复用. Spec §8 安装 → Task 5. Spec §9 文件清单 → 本 plan File Structure(设置页 UI 明确列为后续). Spec §5 埋点 — 无需新埋点,现有 `setupConsoleInterception` 已捕获 background 全部 `console.*`(浏览器控制/工具循环/光标/API/错误均在 background)。

**Placeholder scan**: 无 TBD/TODO;每步含完整代码或确切命令与预期输出。

**Type/名称一致性**: entry 形状 `{timestamp, level, context, message, data?}` 在 host/sink/LogManager 间一致;`geminiNativeLogEnabled` / `geminiNativeLogLevel` 在 sink、background/index.js、Task 5 验证命令间一致;host name `com.gemini_nexus.logger` 在 install/sink/验证间一致;扩展 ID `ccmbheekkhlgfggi` 在 install 测试断言、manifest origin、Task 5 验证间一致。

**Scope**: 单一可交付 feature(让我能 tail 日志文件)。设置页正式 UI、content/sidepanel 动作转发、Linux/Windows 平台路径列为后续。

## 后续工作(独立 plan)

- 设置页正式 UI 开关(standalone bridge `SAVE_NATIVE_LOG` + sandbox/ui template checkbox + i18n)。
- content script / sidepanel 动作转发到 background(目前只覆盖 background 层动作,已含浏览器控制、工具循环、光标、API、错误)。
- 非 macOS 平台的日志路径与 host manifest 目录分支。
- 日志按模块(context)过滤的能力(目前 context 多为 `System`,可鼓励动作代码用 `logManager.add({context:'browser_control.click', ...})` 带 context)。
