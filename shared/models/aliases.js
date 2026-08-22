/**
 * Model ID aliases for the Gemini Official API.
 * Externalized so model renames don't require code changes.
 */
export const OFFICIAL_MODEL_ALIASES = Object.freeze({
    'gemini-3-pro': 'gemini-3.1-pro-preview',
    'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
});

/**
 * Resolve a model alias to its canonical Official API model ID.
 */
export function normalizeOfficialModelId(model) {
    return OFFICIAL_MODEL_ALIASES[model] ?? model;
}
