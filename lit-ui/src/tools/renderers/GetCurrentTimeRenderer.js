import { html } from "lit";
import { Clock } from "lucide";
import { i18n } from "../../utils/i18n.js";
import { renderHeader } from "../renderer-registry.js";
export class GetCurrentTimeRenderer {
    render(params, result) {
        const state = result ? (result.status === "failed" ? "error" : "complete") : "inprogress";
        if (result && params) {
            const output = result.stdout || "";
            const headerText = params.timezone
                ? `${i18n("Getting current time in")} ${params.timezone}`
                : i18n("Getting current date and time");
            if (result.status === "failed") {
                return {
                    content: html `
						<div class="space-y-3">
							${renderHeader(state, Clock, headerText)}
							<div class="text-sm text-destructive">${output}</div>
						</div>
					`,
                    isCustom: false,
                };
            }
            return { content: renderHeader(state, Clock, `${headerText}: ${output}`), isCustom: false };
        }
        if (result) {
            const output = result.stdout || "";
            if (result.status === "failed") {
                return {
                    content: html `
						<div class="space-y-3">
							${renderHeader(state, Clock, i18n("Getting current date and time"))}
							<div class="text-sm text-destructive">${output}</div>
						</div>
					`,
                    isCustom: false,
                };
            }
            return {
                content: renderHeader(state, Clock, `${i18n("Getting current date and time")}: ${output}`),
                isCustom: false,
            };
        }
        if (params?.timezone) {
            return {
                content: renderHeader(state, Clock, `${i18n("Getting current time in")} ${params.timezone}`),
                isCustom: false,
            };
        }
        if (params) {
            return { content: renderHeader(state, Clock, i18n("Getting current date and time")), isCustom: false };
        }
        return { content: renderHeader(state, Clock, i18n("Getting time...")), isCustom: false };
    }
}
