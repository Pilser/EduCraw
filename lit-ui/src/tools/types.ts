import type { TemplateResult } from "lit";
import type { WsToolEndFrame } from "../core/edu-types.js";

export interface ToolRenderResult {
	content: TemplateResult;
	isCustom: boolean;
}

export interface ToolRenderer<TParams = any> {
	render(
		params: TParams | undefined,
		result: WsToolEndFrame | undefined,
		isStreaming?: boolean,
	): ToolRenderResult;
}
