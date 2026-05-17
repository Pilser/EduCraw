/**
 * Stub for browser environment - partial-json not installed.
 * lit-ui uses ws-stream-fn for streaming, not proxy.ts.
 */
export function repairJson(json) {
    return json;
}
export function parseJsonWithRepair(json) {
    return JSON.parse(json);
}
export function parseStreamingJson(partialJson) {
    if (!partialJson || partialJson.trim() === "") {
        return {};
    }
    try {
        return JSON.parse(partialJson);
    }
    catch {
        return {};
    }
}
