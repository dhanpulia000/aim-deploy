const path = require('path');

module.exports = {
  apps: [
    {
      name: 'aimforglobal-backend',
      script: 'server.js',
      cwd: path.join(__dirname, 'backend'), // backend/.env 로드되도록 작업 디렉터리 지정
      exec_mode: 'fork', // better-sqlite3 또는 단일 PG 풀·워커 사용 시 cluster 모드 금지
      instances: 1, // fork 모드에서는 1개만 실행
      max_memory_restart: '1G', // 크롤링(Playwright 등) 고려해 여유 있게 설정. 1G 초과 시에만 재시작
      
      // 로그 설정 (원본 프로젝트와 로그 파일 분리)
      log_file: path.join(__dirname, 'logs', 'aimglobal-combined.log'),
      out_file: path.join(__dirname, 'logs', 'aimglobal-combined.log'),
      error_file: path.join(__dirname, 'logs', 'aimglobal-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // 자동 재시작 설정
      autorestart: true,
      watch: false, // 프로덕션에서는 watch 비활성화
      max_restarts: 10, // 최대 재시작 횟수
      min_uptime: '10s', // 최소 실행 시간 (이 시간보다 짧게 종료되면 에러로 간주)
      
      // 환경 변수 (크롤링 서버: Heap 여유 확보, 무한 증가만 방지)
      // NODE_ENV=development 로 로컬 기동 (JWT_SECRET 미설정 시에도 기동 가능. 프로덕션 배포 시 .env에 JWT_SECRET 설정 후 production 사용)
      env: {
        NODE_ENV: 'development',
        NODE_OPTIONS: '--max-old-space-size=1024',
        TZ: 'Asia/Seoul',
        PORT: '9080',
        WS_PORT: '9081'
      },
      
      // 추가 옵션
      kill_timeout: 5000, // 종료 대기 시간 (ms)
      listen_timeout: 10000, // 시작 대기 시간 (ms)
      shutdown_with_message: true
    }
  ]
};











