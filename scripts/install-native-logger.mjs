#!/usr/bin/env node
// Installs the Gemini Nexus native logger host: copies host.js to a stable
// path under ~/.gemini-nexus/ and writes the Chrome NativeMessagingHosts
// manifest whose allowed_origins pins this extension's ID. Run with --uninstall
// to remove. Run from the project root so manifest.json's key can be read.

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
