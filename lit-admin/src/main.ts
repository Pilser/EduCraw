import "./app.css";
import "./pages/admin-login-page.js";
import "./pages/admin-dashboard.js";
import "./app.js";
import { html, render } from "lit";

const app = document.getElementById("app");
if (app) {
  render(html`<admin-app></admin-app>`, app);
}
