import type { SseToolEndFrame } from "../../core/edu-types.js";
import { html } from "lit";
import { Calculator } from "lucide";
import { i18n } from "../../utils/i18n.js";
import { renderHeader } from "../renderer-registry.js";
import type { ToolRenderer, ToolRenderResult } from "../types.js";

interface CalculateParams {
	expression: string;
}

export class CalculateRenderer implements ToolRenderer<CalculateParams> {
	render(params: CalculateParams | undefined, result: SseToolEndFrame | undefined): ToolRenderResult {
		const state = result ? (result.status === "failed" ? "error" : "complete") : "inprogress";

		if (result && params?.expression) {
			const output = result.stdout || "";

			if (result.status === "failed") {
				return {
					content: html`
						<div class="space-y-3">
							${renderHeader(state, Calculator, params.expression)}
							<div class="text-sm text-destructive">${output}</div>
						</div>
					`,
					isCustom: false,
				};
			}

			return { content: renderHeader(state, Calculator, `${params.expression} = ${output}`), isCustom: false };
		}

		if (params?.expression) {
			return {
				content: renderHeader(state, Calculator, `${i18n("Calculating")} ${params.expression}`),
				isCustom: false,
			};
		}

		if (params && !params.expression) {
			return { content: renderHeader(state, Calculator, i18n("Writing expression...")), isCustom: false };
		}

		return { content: renderHeader(state, Calculator, i18n("Waiting for expression...")), isCustom: false };
	}
}
