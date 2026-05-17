import { getToolRenderer, registerToolRenderer } from "./renderer-registry.js";
import { BashRenderer } from "./renderers/BashRenderer.js";
import { DefaultRenderer } from "./renderers/DefaultRenderer.js";
import { TodoRenderer } from "./renderers/TodoRenderer.js";
registerToolRenderer("bash", new BashRenderer());
registerToolRenderer("todo__todo_write", new TodoRenderer());
const defaultRenderer = new DefaultRenderer();
let showJsonMode = false;
export function setShowJsonMode(enabled) {
    showJsonMode = enabled;
}
export function renderTool(toolName, params, result, isStreaming) {
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
