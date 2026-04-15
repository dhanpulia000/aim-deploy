/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const defaultBackend = 'http://127.0.0.1:9080'
const defaultForumMonitoring = 'http://127.0.0.1:9090'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.VITE_BACKEND_URL || defaultBackend
  const forumMonitoringTarget = env.VITE_FORUM_MONITORING_URL || defaultForumMonitoring

  return {
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
  },
  server: {
    // 원본 Vite(5173)와 동시에 띄울 수 있도록 AIMGLOBAL 전용 포트
    port: Number(env.VITE_DEV_PORT) || 5175,
    strictPort: true, // 포트가 사용 중이면 에러 발생 (자동 변경 방지)
    host: true, // 0.0.0.0 - 같은 네트워크 다른 기기에서 접속 가능
    open: true,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
        timeout: 600000,
        proxyTimeout: 600000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('[Proxy Error]', err);
          });
          proxy.on('proxyReq', (proxyReq, _req, _res) => {
            // 파트너 영상 아카이빙 등 장시간 요청 허용 (10분)
            proxyReq.setTimeout(600000);
          });
        }
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
        timeout: 600000,
        proxyTimeout: 600000,
      }
      ,
      '/forum-api': {
        target: forumMonitoringTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/forum-api/, ''),
        timeout: 600000,
        proxyTimeout: 600000,
      }
    },
    // WebSocket을 백엔드로 직접 프록시하지 않고, 백엔드 URL 사용
    // useRealtime.ts에서 동적 URL 구성을 사용하므로 환경 변수로 제공
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
};
})

