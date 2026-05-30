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
        "/api/v1": {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
