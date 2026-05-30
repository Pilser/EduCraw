import type { SseToolEndFrame } from "../../core/edu-types.js";
import { html } from "lit";
import { SquareTerminal } from "lucide";
import { i18n } from "../../utils/i18n.js";
import { renderHeader } from "../renderer-registry.js";
import type { ToolRenderer, ToolRenderResult } from "../types.js";

interface BashParams {
	command: string;
}

export class BashRenderer implements ToolRenderer<BashParams> {
	render(params: BashParams | undefined, result: SseToolEndFrame | undefined): ToolRenderResult {
		const state = result ? (result.status === "failed" ? "error" : "complete") : "inprogress";

		if (result && params?.command) {
			const output = result.stdout ? (result.stderr ? `${result.stdout}\n[stderr]\n${result.stderr}` : result.stdout) : "";
			const combined = output ? `> ${params.command}\n\n${output}` : `> ${params.command}`;
			return {
				content: html`
					<div class="space-y-3">
						${renderHeader(state, SquareTerminal, i18n("Running command..."))}
						<console-block .content=${combined} .variant=${result.status === "failed" ? "error" : "default"}></console-block>
					</div>
				`,
				isCustom: false,
			};
		}

		if (params?.command) {
			return {
				content: html`
					<div class="space-y-3">
						${renderHeader(state, SquareTerminal, i18n("Running command..."))}
						<console-block .content=${`> ${params.command}`}></console-block>
					</div>
				`,
				isCustom: false,
			};
		}

		return { content: renderHeader(state, SquareTerminal, i18n("Waiting for command...")), isCustom: false };
	}
}
