import type { KnownProvider } from "./types.js";

/**
 * Stub for browser environment - no env API keys available.
 * lit-ui uses server-side auth via WebSocket proxy.
 */
export function findEnvKeys(_provider: KnownProvider | string): string[] | undefined {
	return undefined;
}

export function getEnvApiKey(_provider: KnownProvider | string): string | undefined {
	return undefined;
}
