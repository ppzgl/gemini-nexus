import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

    it('makes the host script executable so Chrome can exec it', () => {
        const work = mkdtempSync(join(tmpdir(), 'gn-install-'));
        const hostScriptPath = join(work, 'native-logger.js');
        install({
            extensionId: 'ccmbheekkhlgfggi',
            hostScriptPath,
            manifestDir: join(work, 'manifest'),
            sourceHost: new URL('./native-logger/host.js', import.meta.url).pathname,
        });
        expect(statSync(hostScriptPath).mode & 0o111).toBeTruthy(); // any execute bit
        rmSync(work, { recursive: true, force: true });
    });
});
