const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { authenticate, rateLimit } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validation.middleware');
const {
  loginSchema,
  loginOtpSchema,
  loginOtpResendSchema,
  createUserSchema
} = require('../validators/auth.validator');

// 로그인 엔드포인트에 Rate Limit 적용 (1분에 5회)
router.post('/login', rateLimit(60000, 5), validate(loginSchema), authController.login);
// 구체적인 경로를 먼저 등록 (resend vs otp)
router.post(
  '/login/otp/resend',
  rateLimit(60000, 10),
  validate(loginOtpResendSchema),
  authController.resendLoginOtp
);
router.post('/login/otp', rateLimit(60000, 20), validate(loginOtpSchema), authController.loginOtp);
router.get('/me', authenticate, authController.me);
// 관리자만 User 계정 생성 가능 (인증 미들웨어 필요)
// 계정 생성도 Rate Limit 적용 (1분에 3회)
router.post('/users', rateLimit(60000, 3), authenticate, validate(createUserSchema), authController.createUser);

module.exports = router;


