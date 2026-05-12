// Stub — EduCrawl doesn't need CORS proxy (server handles LLM)
import type { StreamFn } from "@earendil-works/pi-agent-core";

export function createStreamFn(_getProxyUrl: () => Promise<string | undefined>): StreamFn {
  throw new Error("EduCrawl uses WebSocket, not proxy-based streaming");
}

export function isCorsError(_err: any): boolean {
  return false;
}
