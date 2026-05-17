/**
 * Stub for browser environment - no env API keys available.
 * lit-ui uses server-side auth via WebSocket proxy.
 */
export function findEnvKeys(_provider) {
    return undefined;
}
export function getEnvApiKey(_provider) {
    return undefined;
}
