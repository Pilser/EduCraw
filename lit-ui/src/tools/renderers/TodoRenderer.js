import { html } from "lit";
import { Check, ListTodo } from "lucide";
import { icon } from "@mariozechner/mini-lit";
import { renderHeader } from "../renderer-registry.js";
function parseTodoItems(content) {
    const lines = content.split("\n");
    const items = [];
    for (const line of lines) {
        const trimmed = line.trim();
        const checkMatch = trimmed.match(/^[-*]\s*\[([xX\s])\]\s*(.*)/);
        if (checkMatch) {
            items.push({
                text: checkMatch[2] || trimmed,
                completed: checkMatch[1].toLowerCase() === "x",
            });
        }
        else if (trimmed) {
            items.push({ text: trimmed, completed: false });
        }
    }
    return items;
}
export class TodoRenderer {
    render(params, result, isStreaming) {
        const state = result
            ? result.status === "failed"
                ? "error"
                : "complete"
            : isStreaming
                ? "inprogress"
                : "complete";
        const content = params?.content;
        if (!content) {
            return {
                content: html `<div>${renderHeader(state, ListTodo, "Updating task list...")}</div>`,
                isCustom: false,
            };
        }
        const items = parseTodoItems(content);
        const completedCount = items.filter((i) => i.completed).length;
        const totalCount = items.length;
        return {
            content: html `
        <div class="space-y-3">
          ${renderHeader(state, ListTodo, `Task List (${completedCount}/${totalCount})`)}
          <div class="space-y-1.5">
            ${items.map((item) => html `
                <div class="flex items-start gap-2 text-sm ${item.completed ? "text-muted-foreground line-through" : "text-foreground"}">
                  <span class="inline-flex items-center justify-center w-4 h-4 mt-0.5 shrink-0 rounded border ${item.completed ? "border-green-500 bg-green-500/20 text-green-600" : "border-border bg-muted"}">
                    ${item.completed ? icon(Check, "xs") : ""}
                  </span>
                  <span>${item.text}</span>
                </div>
              `)}
          </div>
        </div>
      `,
            isCustom: false,
        };
    }
}
