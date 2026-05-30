import type { TemplateResult } from "lit";
import type { SseToolEndFrame } from "../core/edu-types.js";

export interface ToolRenderResult {
	content: TemplateResult;
	isCustom: boolean;
}

export interface ToolRenderer<TParams = any> {
	render(
		params: TParams | undefined,
		result: SseToolEndFrame | undefined,
		isStreaming?: boolean,
	): ToolRenderResult;
}
