/**
 * Stub for browser environment - partial-json not installed.
 * lit-ui uses ws-stream-fn for streaming, not proxy.ts.
 */
export function repairJson(json: string): string {
	return json;
}

export function parseJsonWithRepair<T>(json: string): T {
	return JSON.parse(json) as T;
}

export function parseStreamingJson<T = Record<string, unknown>>(partialJson: string | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}
	try {
		return JSON.parse(partialJson) as T;
	} catch {
		return {} as T;
	}
}
