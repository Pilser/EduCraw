import type { WsToolEndFrame } from "../core/edu-types.js";
import { getToolRenderer, registerToolRenderer } from "./renderer-registry.js";
import { BashRenderer } from "./renderers/BashRenderer.js";
import { DefaultRenderer } from "./renderers/DefaultRenderer.js";
import type { ToolRenderResult } from "./types.js";

registerToolRenderer("bash", new BashRenderer());

const defaultRenderer = new DefaultRenderer();

let showJsonMode = false;

export function setShowJsonMode(enabled: boolean): void {
	showJsonMode = enabled;
}

export function renderTool(
	toolName: string,
	params: any | undefined,
	result: WsToolEndFrame | undefined,
	isStreaming?: boolean,
): ToolRenderResult {
	if (showJsonMode) {
		return defaultRenderer.render(params, result, isStreaming);
	}

	const renderer = getToolRenderer(toolName);
	if (renderer) {
		return renderer.render(params, result, isStreaming);
	}
	return defaultRenderer.render(params, result, isStreaming);
}

export { getToolRenderer, registerToolRenderer };
