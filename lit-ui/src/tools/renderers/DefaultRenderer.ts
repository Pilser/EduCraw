import type { WsToolEndFrame } from "../../core/edu-types.js";
import { html } from "lit";
import { Code } from "lucide";
import { i18n } from "../../utils/i18n.js";
import { renderHeader } from "../renderer-registry.js";
import type { ToolRenderer, ToolRenderResult } from "../types.js";

export class DefaultRenderer implements ToolRenderer {
	render(params: any | undefined, result: WsToolEndFrame | undefined, isStreaming?: boolean): ToolRenderResult {
		const state = result ? (result.status === "failed" ? "error" : "complete") : isStreaming ? "inprogress" : "complete";

		let paramsJson = "";
		if (params) {
			try {
				paramsJson = JSON.stringify(JSON.parse(params), null, 2);
			} catch {
				try {
					paramsJson = JSON.stringify(params, null, 2);
				} catch {
					paramsJson = String(params);
				}
			}
		}

		if (result) {
			let outputJson = result.stdout || "";
			if (result.stderr) {
				outputJson += (outputJson ? "\n" : "") + "[stderr]\n" + result.stderr;
			}
			if (!outputJson) outputJson = i18n("(no output)");
			let outputLanguage = "text";

			try {
				const parsed = JSON.parse(outputJson);
				outputJson = JSON.stringify(parsed, null, 2);
				outputLanguage = "json";
			} catch {
				// Not valid JSON
			}

			return {
				content: html`
					<div class="space-y-3">
						${renderHeader(state, Code, "Tool Call")}
						${
							paramsJson
								? html`<div>
							<div class="text-xs font-medium mb-1 text-muted-foreground">${i18n("Input")}</div>
							<code-block .code=${paramsJson} language="json"></code-block>
						</div>`
								: ""
						}
						<div>
							<div class="text-xs font-medium mb-1 text-muted-foreground">${i18n("Output")}</div>
							<code-block .code=${outputJson} language="${outputLanguage}"></code-block>
						</div>
					</div>
				`,
				isCustom: false,
			};
		}

		if (params) {
			if (isStreaming && (!paramsJson || paramsJson === "{}" || paramsJson === "null")) {
				return {
					content: html`
						<div>
							${renderHeader(state, Code, "Preparing tool parameters...")}
						</div>
					`,
					isCustom: false,
				};
			}

			return {
				content: html`
					<div class="space-y-3">
						${renderHeader(state, Code, "Tool Call")}
						<div>
							<div class="text-xs font-medium mb-1 text-muted-foreground">${i18n("Input")}</div>
							<code-block .code=${paramsJson} language="json"></code-block>
						</div>
					</div>
				`,
				isCustom: false,
			};
		}

		return {
			content: html`
				<div>
					${renderHeader(state, Code, "Preparing tool...")}
				</div>
			`,
			isCustom: false,
		};
	}
}
