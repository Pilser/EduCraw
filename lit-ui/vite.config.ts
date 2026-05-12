import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@earendil-works/pi-agent-core": path.resolve(
          __dirname,
          "../pi/packages/agent/dist/browser.js",
        ),
        "@earendil-works/pi-ai": path.resolve(
          __dirname,
          "../pi/packages/ai/dist/index.js",
        ),
        "@earendil-works/pi-web-ui": path.resolve(
          __dirname,
          "../pi/packages/web-ui/dist/index.js",
        ),
      },
    },
    optimizeDeps: {
      exclude: [
        "@earendil-works/pi-agent-core",
        "@earendil-works/pi-ai",
        "@earendil-works/pi-web-ui",
      ],
    },
    server: {
      port: 5174,
      proxy: {
        "/auth": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/sessions": {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
