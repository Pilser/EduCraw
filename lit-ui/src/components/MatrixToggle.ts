import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { icon } from "@mariozechner/mini-lit";
import { html, LitElement } from "lit";
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

@customElement("matrix-toggle")
export class MatrixToggle extends LitElement {
  @state() private enabled = false;

  constructor() {
    super();
    this.enabled = localStorage.getItem(MATRIX_KEY) === "true";
  }

  createRenderRoot() {
    return this;
  }

  private toggle() {
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
}
