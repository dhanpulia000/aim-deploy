// Global Type Definitions

export {};

// ============================================================================
// Node.js Types
// ============================================================================

declare global {
  declare namespace NodeJS {
    interface Timeout {
      // Timer ID for setTimeout/setInterval
    }
  }

// ============================================================================
// Vite Environment Variables
// ============================================================================

  interface ImportMetaEnv {
    readonly VITE_WS_PORT?: string;
    readonly VITE_WS_URL?: string;
    /** 백엔드 HTTP/WS 포트 (기본 9080 — 원본 프로젝트 8080과 분리) */
    readonly VITE_BACKEND_PORT?: string;
    /** Vite 프록시 대상 (기본 http://127.0.0.1:9080) */
    readonly VITE_BACKEND_URL?: string;
    /** Forum monitoring service base (default: /forum-api in dev) */
    readonly VITE_FORUM_MONITORING_BASE?: string;
    /** Vite proxy target for forum monitoring (default: http://127.0.0.1:9090) */
    readonly VITE_FORUM_MONITORING_URL?: string;
    /** 개발 서버 포트 (vite.config 의 VITE_DEV_PORT 와 별도, WS 판별용 쉼표 구분) */
    readonly VITE_DEV_FRONTEND_PORTS?: string;
    readonly DEV?: boolean;
    readonly PROD?: boolean;
    readonly MODE?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

// (No exports here: this file is for global ambient types)









