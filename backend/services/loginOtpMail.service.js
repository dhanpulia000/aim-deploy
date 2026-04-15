const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

/**
 * SMTP 환경 변수가 로그인 OTP 발송에 필요한 최소 구성인지 확인
 */
function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST
    && process.env.SMTP_PORT
    && process.env.SMTP_USER
    && process.env.SMTP_PASS
    && process.env.SMTP_FROM
  );
}

function createTransport() {
  if (!isSmtpConfigured()) {
    return null;
  }
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

/**
 * 로그인 OTP 이메일 발송
 * @param {string} toEmail
 * @param {string} code - 6자리 숫자 문자열
 */
async function sendLoginOtp(toEmail, code) {
  const transport = createTransport();
  if (!transport) {
    const err = new Error('SMTP not configured');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const from = process.env.SMTP_FROM;
  try {
    await transport.sendMail({
      from,
      to: toEmail,
      subject: '[AIMGLOBAL] 로그인 인증 코드',
      text:
        '로그인 인증 코드입니다.\n\n'
        + `${code}\n\n`
        + '10분 이내에 입력해 주세요.\n'
        + '본인이 요청한 것이 아니면 이 메일을 무시하세요.'
    });
  } catch (e) {
    logger.error('Failed to send login OTP email', { error: e.message, to: toEmail });
    const err = new Error('SMTP send failed');
    err.code = 'SMTP_SEND_FAILED';
    err.cause = e;
    throw err;
  }
}

module.exports = {
  isSmtpConfigured,
  sendLoginOtp
};
