import { icon } from "@mariozechner/mini-lit";
import { html } from "lit";
import { FileCode2 } from "lucide";
export function ArtifactPill(filename) {
    return html `
		<span
			class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-muted/50 border border-border rounded"
		>
			${icon(FileCode2, "sm")}
			<span class="text-foreground">${filename}</span>
		</span>
	`;
}
