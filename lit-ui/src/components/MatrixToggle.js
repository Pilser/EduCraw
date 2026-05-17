var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { icon } from "@mariozechner/mini-lit";
import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Terminal } from "lucide";
const MATRIX_KEY = "educlaw_matrix";
function applyMatrix() {
    const enabled = localStorage.getItem(MATRIX_KEY) === "true";
    document.documentElement.classList.toggle("matrix", enabled);
}
if (typeof window !== "undefined") {
    applyMatrix();
}
let MatrixToggle = class MatrixToggle extends LitElement {
    constructor() {
        super();
        this.enabled = false;
        this.enabled = localStorage.getItem(MATRIX_KEY) === "true";
    }
    createRenderRoot() {
        return this;
    }
    toggle() {
        this.enabled = !this.enabled;
        localStorage.setItem(MATRIX_KEY, String(this.enabled));
        applyMatrix();
    }
    render() {
        return Button({
            variant: this.enabled ? "default" : "ghost",
            size: "icon",
            onClick: () => this.toggle(),
            title: this.enabled ? "Matrix on" : "Matrix off",
            children: icon(Terminal, "sm"),
        });
    }
};
__decorate([
    state()
], MatrixToggle.prototype, "enabled", void 0);
MatrixToggle = __decorate([
    customElement("matrix-toggle")
], MatrixToggle);
export { MatrixToggle };
