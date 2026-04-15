// Line Messaging API 서비스

const axios = require('axios');
const logger = require('../utils/logger');

class LineService {
  /**
   * Line Channel Access Token 가져오기
   */
  getChannelAccessToken() {
    return process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }

  /**
   * 실제 전송·연결 테스트에 쓸 수 있는 토큰인지 (미설정·플레이스홀더·헤더 불가 문자 제외)
   * @returns {string|null}
   */
  getUsableAccessToken() {
    const raw = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (raw == null) return null;
    const t = String(raw).trim();
    if (!t) return null;
    // HTTP Authorization 헤더에 넣을 수 없는 문자
    if (/[\r\n\x00-\x1f\x7f]/.test(t)) return null;
    const lower = t.toLowerCase();
    if (lower.includes('여기에') || lower.includes('channel_access_token')) return null;
    if (/^your[_\s-]/i.test(t) || /^change_me/i.test(t)) return null;
    return t;
  }

  /** LINE 메시징을 쓰는 환경인지 (토큰이 유효해 보일 때만) */
  isLineMessagingConfigured() {
    return this.getUsableAccessToken() != null;
  }

  /**
   * Line Channel Secret 가져오기
   */
  getChannelSecret() {
    return process.env.LINE_CHANNEL_SECRET;
  }

  /**
   * Line 메시지 전송 (Push Message)
   * @param {string} channelId - Line 채널 ID (Group ID 또는 User ID)
   * @param {string|Array} messages - 전송할 메시지 (텍스트 문자열 또는 메시지 객체 배열)
   * @returns {Promise<Object>} 전송 결과
   */
  async sendMessage(channelId, messages) {
    const channelAccessToken = this.getUsableAccessToken();

    if (!channelAccessToken) {
      throw new Error('LINE_CHANNEL_ACCESS_TOKEN이 설정되지 않았거나 플레이스홀더입니다.');
    }

    if (!channelId) {
      throw new Error('Line 채널 ID가 필요합니다.');
    }

    // 메시지 형식 변환 (문자열이면 객체 배열로 변환)
    let messageArray = [];
    if (typeof messages === 'string') {
      messageArray = [{
        type: 'text',
        text: messages
      }];
    } else if (Array.isArray(messages)) {
      messageArray = messages;
    } else {
      throw new Error('메시지는 문자열 또는 메시지 객체 배열이어야 합니다.');
    }

    try {
      const response = await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
          to: channelId,
          messages: messageArray
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${channelAccessToken}`
          },
          timeout: 10000 // 10초 타임아웃
        }
      );

      if (response.status === 200) {
        try {
          const lineUsageService = require('./lineUsage.service');
          // 발송 횟수는 API 호출 1회 = 1건으로 집계 (사용자 인지 "몇 번 보냈는지"와 일치)
          lineUsageService.recordSend(1);
        } catch (e) {
          // 사용량 기록 실패해도 전송 결과에는 영향 없음
        }
        logger.info('[LineService] Line message sent successfully', {
          channelId,
          messageCount: messageArray.length
        });
        return { success: true, response: response.data };
      } else {
        throw new Error(`Line API returned status ${response.status}`);
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      const errorCode = error.response?.data?.errorCode || error.code;
      const statusCode = error.response?.status;
      
      logger.error('[LineService] Failed to send Line message', {
        error: errorMessage,
        errorCode,
        channelId,
        status: statusCode,
        isRateLimit: statusCode === 429
      });

      // Line API 에러 코드별 메시지 매핑
      const errorMessages = {
        '400': '잘못된 요청입니다. 채널 ID와 메시지 형식을 확인해주세요.',
        '401': '인증에 실패했습니다. LINE_CHANNEL_ACCESS_TOKEN을 확인해주세요.',
        '403': '권한이 없습니다. 봇이 해당 채널에 추가되어 있는지 확인해주세요.',
        '404': '채널을 찾을 수 없습니다. 채널 ID를 확인해주세요.',
        '429': 'API 호출 제한에 도달했습니다. 월간 한도가 초과되었습니다. 다음 달까지 전송이 중단됩니다.',
        '500': 'Line 서버 오류가 발생했습니다.'
      };

      const userMessage = errorMessages[statusCode] || errorMessage;
      
      // 429 에러인 경우 특별한 에러 객체 생성
      const customError = new Error(userMessage);
      customError.isRateLimit = statusCode === 429;
      customError.statusCode = statusCode;
      throw customError;
    }
  }

  /**
   * 업무 알림 메시지 포맷팅
   * @param {string} workName - 업무명
   * @param {string} date - 날짜 (YYYY-MM-DD)
   * @param {string} time - 시간 (HH:mm)
   * @param {string} additionalMessage - 추가 메시지 (선택)
   * @returns {Array} Line 메시지 객체 배열
   */
  formatWorkNotificationMessage(workName, date, time, additionalMessage = null) {
    const messages = [];

    // 메인 메시지
    let mainText = `📋 업무 알림\n\n`;
    mainText += `업무명: ${workName}\n`;
    mainText += `날짜: ${date}\n`;
    mainText += `시간: ${time}`;

    if (additionalMessage) {
      mainText += `\n\n${additionalMessage}`;
    }

    messages.push({
      type: 'text',
      text: mainText
    });

    return messages;
  }

  /**
   * 업무 알림 전송
   * @param {string} channelId - Line 채널 ID
   * @param {string} workName - 업무명
   * @param {string} date - 날짜 (YYYY-MM-DD)
   * @param {string} time - 시간 (HH:mm)
   * @param {string} additionalMessage - 추가 메시지 (선택)
   * @returns {Promise<Object>} 전송 결과
   */
  async sendWorkNotification(channelId, workName, date, time, additionalMessage = null) {
    const messages = this.formatWorkNotificationMessage(workName, date, time, additionalMessage);
    return await this.sendMessage(channelId, messages);
  }

  /**
   * Line API 연결 테스트
   * @returns {Promise<Object>} 테스트 결과
   */
  async testConnection() {
    const channelAccessToken = this.getUsableAccessToken();

    if (!channelAccessToken) {
      return {
        ok: true,
        skipped: true,
        reason: 'LINE_CHANNEL_ACCESS_TOKEN 미설정 또는 플레이스홀더'
      };
    }

    try {
      // Line API의 validate endpoint 사용 (또는 간단한 API 호출)
      const response = await axios.get(
        'https://api.line.me/v2/bot/info',
        {
          headers: {
            'Authorization': `Bearer ${channelAccessToken}`
          },
          timeout: 5000
        }
      );

      if (response.status === 200) {
        logger.info('[LineService] Line API connection test successful', {
          botName: response.data?.displayName
        });
        return {
          ok: true,
          botName: response.data?.displayName,
          botId: response.data?.userId
        };
      } else {
        return {
          ok: false,
          error: `Line API returned status ${response.status}`
        };
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      logger.warn('[LineService] Line API connection test failed', {
        error: errorMessage
      });
      return {
        ok: false,
        error: errorMessage
      };
    }
  }
}

module.exports = new LineService();
