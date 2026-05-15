import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    plugins: [tailwindcss()],
    server: {
      port: 5175,
      proxy: {
        "/auth": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/admin": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/sessions": {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
        },
        "/files": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/cohorts": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/me": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/health": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/models": {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
