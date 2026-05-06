import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const bindAddr = env.BIND_ADDR || '127.0.0.1:8000'
  const bindHost = bindAddr.split(':')[0] === '0.0.0.0' ? '127.0.0.1' : bindAddr.split(':')[0]
  const bindPort = bindAddr.split(':')[1] || '8000'
  const backendTarget = env.VITE_DEV_PROXY_TARGET || env.EDUCLAW_SERVER_URL || `http://${bindHost}:${bindPort}`

  return {
    envDir: '..',
    plugins: [
      react(),
      tailwindcss(),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      // Proxy API and WS calls to the backend during development.
      proxy: {
        '/auth': backendTarget,
        '/api': backendTarget,
        '/admin': backendTarget,
        '/sessions': {
          target: backendTarget,
          ws: true,
        },
        '/files': backendTarget,
      },
    },
  }
})
