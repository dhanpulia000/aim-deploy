// Express 앱 설정

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const lineWebhookController = require('./controllers/lineWebhook.controller');

// 미들웨어
const { handleNotFound, handleError, requestLogger } = require('./middlewares/error.middleware');
const { validateResponse } = require('./middlewares/response.middleware');

// 라우터
const apiRoutes = require('./routes');

// Express 앱 생성
const app = express();

// 정적 파일 서빙 (보안 정책의 영향을 덜 받도록 가장 먼저 처리)
// CORS 헤더 설정: 업로드 파일은 읽기 전용이므로 GET만 허용
app.use('/uploads', (req, res, next) => {
  // 프로덕션 환경에서는 CORS 정책을 더 엄격하게 적용
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : (process.env.NODE_ENV === 'production' ? [] : '*');
  
  if (process.env.NODE_ENV === 'production' && allowedOrigins.length > 0) {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    // 이미지 파일에 대한 캐시 헤더 설정
    if (filePath.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1년
    }
  }
}));

// 프론트엔드 빌드 파일 서빙 (dist 폴더)
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// 기본 미들웨어 설정
app.use(helmet({ 
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"], // 상대 경로 사용 시 'self'만으로 충분
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(compression());
/**
 * LINE Webhook
 * - MUST use raw body to validate x-line-signature
 * - MUST be registered before express.json()
 */
app.post(
  '/api/line/webhook',
  express.raw({ type: 'application/json' }),
  lineWebhookController.handleWebhook
);
// CORS 설정: 환경에 따라 다른 정책 적용
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : (process.env.NODE_ENV === 'production' ? [] : true); // 프로덕션에서는 명시적 허용 목록 필요

app.use(cors({
  origin: (origin, callback) => {
    // 개발 환경 또는 허용 목록이 비어있으면 모든 오리진 허용
    if (process.env.NODE_ENV !== 'production' || allowedOrigins === true) {
      return callback(null, true);
    }
    
    // 프로덕션 환경: 허용 목록 확인
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      const logger = require('./utils/logger');
      logger.warn('CORS: Blocked origin', { origin, allowedOrigins });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24시간 preflight 캐시
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 요청 로깅 미들웨어
app.use(requestLogger);

// API 응답 표준화 미들웨어 (개발 환경에서만 검증)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', validateResponse);
}

// 파비콘 요청 무시 (브라우저 자동 요청으로 404 로그 방지)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// API 라우트
app.use('/api', apiRoutes);

// 기본 라우트: 프론트엔드 index.html 서빙 (API 경로가 아닌 경우)
app.get('*', (req, res, next) => {
  // API 경로는 제외
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  
  // 모바일 최적화: HTML 파일 캐시 방지 (iOS WebKit 크래시 방지)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // dist/index.html 반환
  const indexPath = path.join(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      // dist 폴더가 없거나 index.html이 없는 경우 (개발 환경)
      if (process.env.NODE_ENV !== 'production') {
        res.json({
          message: 'Wallboard API Server',
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          note: 'Frontend not built. Run "npm run build" to build the frontend.',
          endpoints: {
            api: '/api',
            health: '/api/health',
            info: '/api/info'
          }
        });
      } else {
        next(err);
      }
    }
  });
});

// 404 에러 처리
app.use(handleNotFound);

// 글로벌 에러 처리
app.use(handleError);

module.exports = app;

