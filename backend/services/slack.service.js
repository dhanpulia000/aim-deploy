// Slack 메시지 전송 서비스

const axios = require('axios');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { WebClient } = require('@slack/web-api');

/**
 * Slack 에러 코드별 메시지 매핑
 */
function getErrorMessage(errorCode, errorDetail) {
  const errorMessages = {
    'missing_scope': `필수 권한이 없습니다. 필요한 권한: ${errorDetail.needed || 'files:write'}`,
    'invalid_auth': 'Bot Token이 유효하지 않거나 만료되었습니다.',
    'channel_not_found': `채널을 찾을 수 없습니다. 채널 ID: ${errorDetail.provided || 'unknown'}`,
    'not_in_channel': '봇이 해당 채널에 초대되지 않았습니다.',
    'file_too_large': '파일 크기가 너무 큽니다. Slack은 최대 1GB까지 지원합니다.',
    'invalid_arguments': `잘못된 인자입니다. 제공된 값: ${JSON.stringify(errorDetail.provided)}`,
    'rate_limited': 'API 호출 제한에 도달했습니다. 잠시 후 다시 시도해주세요.',
    'server_error': 'Slack 서버 오류가 발생했습니다.',
    'unknown_error': `알 수 없는 오류: ${errorDetail.error || 'Unknown'}`
  };
  
  return errorMessages[errorCode] || `에러 코드: ${errorCode}`;
}

class SlackService {
  /**
   * Slack Webhook URL 또는 Bot Token 가져오기
   */
  getWebhookUrl() {
    return process.env.SLACK_WEBHOOK_URL;
  }

  /**
   * Slack Bot Token 가져오기
   */
  getBotToken() {
    return process.env.SLACK_BOT_TOKEN;
  }

  /**
   * Slack 사용자 목록 가져오기
   * @returns {Promise<Array<{id: string, name: string, realName?: string, displayName?: string, isBot?: boolean}>>}
   */
  async getUsers() {
    const botToken = this.getBotToken();
    if (!botToken) {
      logger.warn('[SlackService] SLACK_BOT_TOKEN not set; returning empty user list (Slack user picker disabled)');
      return [];
    }

    const client = new WebClient(botToken);
    const users = [];
    let cursor;

    try {
      do {
        const response = await client.users.list({
          limit: 200,
          cursor,
          // include_locale: true // 필요시 사용
        });

        if (!response.ok) {
          const errorCode = response.error || 'unknown_error';
          const errorMessage = getErrorMessage(errorCode, response);
          logger.error('[SlackService] Failed to fetch users', {
            errorCode,
            errorMessage,
            responseNeeded: errorCode === 'missing_scope' ? 'users:read scope is required' : undefined
          });
          
          // missing_scope 에러의 경우 더 자세한 안내 메시지 제공
          if (errorCode === 'missing_scope') {
            throw new Error('Slack Bot에 users:read 권한이 필요합니다. Slack 앱 설정에서 권한을 추가해주세요: https://api.slack.com/apps > Your App > OAuth & Permissions > Scopes > Bot Token Scopes > Add "users:read"');
          }
          
          throw new Error(errorMessage);
        }

        const members = response.members || [];
        for (const member of members) {
          // 비활성/봇 계정 제외
          if (member.deleted || member.is_bot || member.id === 'USLACKBOT') {
            continue;
          }
          const profile = member.profile || {};
          const displayName = profile.display_name || profile.real_name || member.name;
          users.push({
            id: member.id,
            name: member.name,
            realName: profile.real_name || undefined,
            displayName,
            isBot: member.is_bot || false
          });
        }

        cursor = response.response_metadata?.next_cursor || '';
      } while (cursor);

      logger.info('[SlackService] Slack users fetched', {
        count: users.length
      });

      return users;
    } catch (error) {
      logger.error('[SlackService] Error fetching Slack users', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 중요도에 따른 색상 결정
   * @param {number} severity - 심각도 (1=상, 2=중, 3=하)
   * @param {string} importance - 중요도 (HIGH, MEDIUM, LOW)
   * @returns {string} 색상 코드 (good, warning, danger)
   */
  getColorBySeverity(severity, importance) {
    if (severity === 1 || importance === 'HIGH') {
      return 'danger'; // 빨간색
    } else if (severity === 2 || importance === 'MEDIUM') {
      return 'warning'; // 노란색
    } else {
      return 'good'; // 파란색
    }
  }

  /**
   * 이슈 정보를 Slack 메시지 포맷으로 변환
   * @param {Object} issue - 이슈 객체
   * @param {Object} options - 옵션 (customMessage 등)
   * @returns {Object} Slack 메시지 객체
   */
  formatIssueMessage(issue, options = {}) {
    const { customMessage, shareForm, mentionedUserIds = [] } = options;
    
    // 상세 본문 정리: 요약이 앞에 중복되거나 동일 문장이 연속 반복될 때 하나로 정리
    const sanitizeDetail = (summary = '', detail = '') => {
      if (!detail) return '';
      let cleaned = detail;
      // 요약이 본문 앞에 중복되어 있으면 제거
      if (summary && cleaned.startsWith(summary)) {
        cleaned = cleaned.slice(summary.length).trimStart();
      }
      // 연속된 동일 라인 제거
      const lines = cleaned.split('\n');
      const deduped = [];
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (deduped.length === 0 || deduped[deduped.length - 1].trimEnd() !== trimmed) {
          deduped.push(trimmed);
        }
      }
      return deduped.join('\n').trim();
    };
    
    const cleanDetail = sanitizeDetail(issue.summary || '', issue.detail || '');
    
    // shareForm이 있으면 구조화된 메시지 포맷 사용
    if (shareForm) {
      return this.formatStructuredMessage(issue, shareForm, mentionedUserIds);
    }
    
    // 중요도 레이블
    const importanceMap = {
      'HIGH': '🔴 높음',
      'MEDIUM': '🟡 보통',
      'LOW': '🟢 낮음'
    };
    
    // 심각도 레이블
    const severityMap = {
      1: '🔴 상',
      2: '🟡 중',
      3: '🟢 하'
    };
    
    const importanceLabel = importanceMap[issue.importance] || '🟡 보통';
    const severityLabel = severityMap[issue.severity] || '🟢 하';
    const color = this.getColorBySeverity(issue.severity, issue.importance);
    
    // 카테고리 정보
    const categoryGroup = issue.categoryGroup?.name || '미분류';
    const category = issue.category?.name || '';
    const categoryText = category ? `${categoryGroup} > ${category}` : categoryGroup;
    
    // 담당자 정보
    const assignedAgent = issue.assignedAgent?.name || '미지정';
    
    // 발생 시간
    const createdAt = issue.createdAt ? new Date(issue.createdAt).toLocaleString('ko-KR') : '-';
    
    // 원본 링크
    const sourceUrl = issue.sourceUrl || issue.link || '';
    
    // 메시지 본문 구성
    const messageText = customMessage || issue.summary || cleanDetail || '내용 없음';
    
    // Slack Block Kit 형식으로 메시지 구성
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${importanceLabel} ${issue.summary || '이슈 제목 없음'}`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*심각도:*\n${severityLabel}`
          },
          {
            type: 'mrkdwn',
            text: `*분류:*\n${categoryText}`
          },
          {
            type: 'mrkdwn',
            text: `*담당자:*\n${assignedAgent}`
          },
          {
            type: 'mrkdwn',
            text: `*발생 시간:*\n${createdAt}`
          }
        ]
      }
    ];
    
    // 상세 내용 추가
    if (cleanDetail && cleanDetail !== issue.summary) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*상세 내용:*\n${cleanDetail.substring(0, 1000)}${cleanDetail.length > 1000 ? '...' : ''}`
        }
      });
    }
    
    // 사용자 지정 메시지가 있으면 추가
    if (customMessage) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*공유 메시지:*\n${customMessage}`
        }
      });
    }
    
    // 원본 링크 추가
    if (sourceUrl) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${sourceUrl}|원문 보기>`
        }
      });
    }
    
    // Attachment 형식 (레거시 호환)
    const attachments = [
      {
        color: color,
        title: `${importanceLabel} ${issue.summary || '이슈 제목 없음'}`,
        fields: [
          {
            title: '심각도',
            value: severityLabel,
            short: true
          },
          {
            title: '분류',
            value: categoryText,
            short: true
          },
          {
            title: '담당자',
            value: assignedAgent,
            short: true
          },
          {
            title: '발생 시간',
            value: createdAt,
            short: true
          }
        ],
        text: messageText.substring(0, 2000),
        ...(sourceUrl && {
          actions: [
            {
              type: 'button',
              text: '원문 보기',
              url: sourceUrl
            }
          ]
        })
      }
    ];
    
    return {
      blocks,
      attachments,
      text: `${importanceLabel} 이슈: ${issue.summary || '제목 없음'}`,
      color
    };
  }

  /**
   * 구조화된 메시지 포맷 (사용자 편집 가능)
   * @param {Object} issue - 이슈 객체
   * @param {Object} shareForm - 구조화된 폼 데이터
   * @param {Array<string>} mentionedUserIds - 멘션할 슬랙 사용자 ID 목록
   * @returns {Object} Slack 메시지 객체
   */
  formatStructuredMessage(issue, shareForm, mentionedUserIds = []) {
    // 상세 본문 정리: 요약이 앞에 중복되거나 동일 문장이 연속 반복될 때 하나로 정리
    const sanitizeDetail = (summary = '', detail = '') => {
      if (!detail) return '';
      let cleaned = detail;
      // 요약이 본문 앞에 중복되어 있으면 제거
      if (summary && cleaned.startsWith(summary)) {
        cleaned = cleaned.slice(summary.length).trimStart();
      }
      // 연속된 동일 라인 제거
      const lines = cleaned.split('\n');
      const deduped = [];
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (deduped.length === 0 || deduped[deduped.length - 1].trimEnd() !== trimmed) {
          deduped.push(trimmed);
        }
      }
      return deduped.join('\n').trim();
    };
    
    const blocks = [];
    
    // 헤더: 제목
    if (shareForm.title) {
      blocks.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: shareForm.title,
          emoji: true
        }
      });
    }
    
    // 필드 섹션: 보내는 사람, 받는 사람, 날짜, 시간
    const fields = [];
    if (shareForm.sender) {
      fields.push({
        type: 'mrkdwn',
        text: `*보내는 사람:*\n${shareForm.sender}`
      });
    }
    if (shareForm.receiver) {
      // 멘션할 사용자 ID가 있으면 <@USER_ID> 형식으로 변환
      let receiverText = shareForm.receiver;
      if (mentionedUserIds.length > 0) {
        // @이름 형식을 <@USER_ID> 형식으로 변환
        const mentions = mentionedUserIds.map(userId => `<@${userId}>`).join(' ');
        receiverText = mentions;
      }
      fields.push({
        type: 'mrkdwn',
        text: `*받는 사람:*\n${receiverText}`
      });
    }
    if (shareForm.date || shareForm.time) {
      const datetime = [shareForm.date, shareForm.time].filter(Boolean).join(' ');
      fields.push({
        type: 'mrkdwn',
        text: `*날짜/시간:*\n${datetime}`
      });
    }
    if (shareForm.userInfo) {
      fields.push({
        type: 'mrkdwn',
        text: `*유저정보:*\n${shareForm.userInfo}`
      });
    }
    
    if (fields.length > 0) {
      blocks.push({
        type: 'section',
        fields: fields.slice(0, 4) // 최대 4개 필드
      });
      if (fields.length > 4) {
        blocks.push({
          type: 'section',
          fields: fields.slice(4)
        });
      }
    }
    
    // 내용 (중복 제거 적용)
    if (shareForm.content) {
      const cleanContent = sanitizeDetail(issue.summary || '', shareForm.content);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*내용:*\n${cleanContent.substring(0, 3000)}${cleanContent.length > 3000 ? '...' : ''}`
        }
      });
    }
    
    // 관련 URL
    if (shareForm.relatedUrl) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${shareForm.relatedUrl}|관련 URL 보기>`
        }
      });
    }
    
    // 내부 테스트 결과 (중복 제거 적용)
    if (shareForm.testResult) {
      const cleanTestResult = sanitizeDetail(issue.summary || '', shareForm.testResult);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*내부 테스트 결과:*\n${cleanTestResult.substring(0, 3000)}${cleanTestResult.length > 3000 ? '...' : ''}`
        }
      });
    }
    
    // 텍스트 요약 (알림용)
    const textParts = [];
    if (shareForm.title) textParts.push(shareForm.title);
    if (shareForm.sender) textParts.push(`보낸 사람: ${shareForm.sender}`);
    if (shareForm.receiver) textParts.push(`받는 사람: ${shareForm.receiver}`);
    const text = textParts.length > 0 ? textParts.join(' | ') : '이슈 공유';
    
    return {
      blocks,
      text,
      attachments: [] // 구조화된 메시지는 blocks만 사용
    };
  }

  /**
   * Slack Webhook을 통해 메시지 전송
   * @param {Object} message - Slack 메시지 객체
   * @param {string} webhookUrl - Webhook URL
   * @returns {Promise<Object>} 전송 결과
   */
  async sendViaWebhook(message, webhookUrl) {
    try {
      const payload = {
        text: message.text,
        attachments: message.attachments,
        blocks: message.blocks
      };
      
      const response = await axios.post(webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10초 타임아웃
      });
      
      if (response.status === 200) {
        logger.info('Slack message sent via webhook', { 
          webhookUrl: webhookUrl.substring(0, 50) + '...',
          messageText: message.text?.substring(0, 100)
        });
        return { success: true, response: response.data };
      } else {
        throw new Error(`Slack webhook returned status ${response.status}`);
      }
    } catch (error) {
      logger.error('Failed to send Slack message via webhook', {
        error: error.message,
        webhookUrl: webhookUrl ? webhookUrl.substring(0, 50) + '...' : 'not set'
      });
      throw error;
    }
  }

  /**
   * Slack Bot API를 통해 메시지 전송 (이미지 포함 가능)
   * @param {Object} message - Slack 메시지 객체
   * @param {string} channel - 채널 ID 또는 이름
   * @param {string} botToken - Bot Token
   * @param {string|null} screenshotPath - 스크린샷 파일 경로 (선택)
   * @param {string|null} videoPath - 비디오 파일 경로 (선택)
   * @returns {Promise<Object>} 전송 결과
   */
  async sendViaBotAPI(message, channel, botToken, screenshotPath = null, videoPath = null) {
    const client = new WebClient(botToken);

    // 채널 ID 정규화 (# 제거) - 먼저 정규화하여 일관성 유지
    let channelId = channel;
    if (channel && channel.startsWith('#')) {
      channelId = channel.substring(1);
    }
    
    // 멘션이 있는 경우를 위해 저장
    const mentionedUserIds = this._mentionedUserIds || [];
    let firstMessageTs = null;
    
    // 이미지가 없는 경우에만 멘션을 위한 첫 번째 메시지 전송
    // 이미지가 있는 경우는 이미지의 initial_comment에 멘션을 포함하므로 별도 메시지 불필요
    if (mentionedUserIds.length > 0 && !screenshotPath) {
      // 멘션이 있고 이미지가 없는 경우, 먼저 멘션을 포함한 메시지를 전송하고 그 ts를 받음
      try {
        const mentionText = mentionedUserIds.map(userId => `<@${userId}>`).join(' ');
        const firstMessage = {
          text: `${mentionText} 이슈 공유`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${mentionText}\n이슈 공유 중...`
              }
            }
          ]
        };
        
        const firstResponse = await client.chat.postMessage({
          channel: channelId || channel, // 정규화된 channelId 사용
          text: firstMessage.text,
          blocks: firstMessage.blocks
        });
        
        if (firstResponse.ok && firstResponse.ts) {
          firstMessageTs = firstResponse.ts;
          logger.info('[SlackService] First message sent with mentions, thread_ts obtained', {
            threadTs: firstMessageTs,
            mentionedUserIds
          });
        }
      } catch (firstError) {
        logger.warn('[SlackService] Failed to send first message with mentions', {
          error: firstError.message
        });
        // 첫 번째 메시지 전송 실패해도 계속 진행 (일반 메시지로 전송)
      }
    }

    try {
      logger.info('[SlackService] sendViaBotAPI called', {
        hasScreenshot: !!screenshotPath,
        screenshotPath,
        channel,
        channelId,
        messageText: message.text?.substring(0, 50)
      });

      // 1) 스크린샷이 있는 경우: files.uploadV2 사용
      if (screenshotPath) {
        const fullPath = path.join(__dirname, '../uploads', screenshotPath);

        logger.info('[SlackService] Checking screenshot file', {
          screenshotPath,
          fullPath,
          exists: fs.existsSync(fullPath)
        });

        if (!fs.existsSync(fullPath)) {
          logger.error('[SlackService] 경로 불일치: 파일이 존재하지 않습니다', {
            screenshotPath,
            fullPath,
            directoryExists: fs.existsSync(path.dirname(fullPath)),
            directoryPath: path.dirname(fullPath)
          });
          // 파일이 없으면 텍스트만 전송 (멘션이 있으면 스레드로 전송)
          return await this.sendViaBotAPITextOnly(message, channelId || channel, botToken, firstMessageTs);
        }

        const fileName = path.basename(fullPath);
        
        // 이미지가 있고 구조화된 메시지인 경우, 메시지 내용을 initial_comment에 포함
        let initialComment = null;
        if (message.blocks && message.blocks.length > 0) {
          // 구조화된 메시지인 경우, 보내는 사람, 받는 사람, 내용, 링크를 포함한 텍스트 생성
          const commentParts = [];
          
          // 모든 블록을 순회하여 필드 및 텍스트 블록 찾기
          for (const block of message.blocks) {
            // 필드 블록 (보내는 사람, 받는 사람 등)
            if (block.type === 'section' && block.fields) {
              for (const field of block.fields) {
                if (field.type === 'mrkdwn') {
                  // 보내는 사람 추출
                  if (field.text && field.text.includes('보내는 사람')) {
                    const senderMatch = field.text.match(/\*보내는 사람:\*\n(.+)/);
                    if (senderMatch && senderMatch[1]) {
                      commentParts.push(`보내는 사람: ${senderMatch[1].trim()}`);
                    }
                  }
                  // 받는 사람 추출 (멘션 포함)
                  if (field.text && field.text.includes('받는 사람')) {
                    const receiverMatch = field.text.match(/\*받는 사람:\*\n(.+)/);
                    if (receiverMatch && receiverMatch[1]) {
                      commentParts.push(`받는 사람: ${receiverMatch[1].trim()}`);
                    }
                  }
                }
              }
            }
            
            // 텍스트 블록 (내용, 링크 등)
            if (block.type === 'section' && block.text && block.text.type === 'mrkdwn') {
              const text = block.text.text || '';
              
              // 내용 추출
              if (text.includes('내용')) {
                const contentMatch = text.match(/\*내용:\*\n(.+)/s);
                if (contentMatch && contentMatch[1]) {
                  // 내용이 너무 길면 잘라내기 (슬랙 initial_comment는 제한이 있음, 약 1000자)
                  let content = contentMatch[1].trim();
                  if (content.length > 800) {
                    content = content.substring(0, 800) + '...';
                  }
                  commentParts.push(`내용:\n${content}`);
                }
              }
              
              // 링크 추출
              if (text.includes('URL') || text.includes('http')) {
                const urlMatch = text.match(/<(https?:\/\/[^|>]+)/);
                if (urlMatch && urlMatch[1]) {
                  commentParts.push(`링크: ${urlMatch[1]}`);
                }
              }
            }
          }
          
          if (commentParts.length > 0) {
            initialComment = commentParts.join('\n\n');
          }
        }
        
        // initial_comment가 없으면 기본 메시지 사용
        if (!initialComment) {
          initialComment = message.text || '이슈 공유';
        }
        
        // 멘션이 있고 첫 번째 메시지가 이미 전송된 경우에도, initial_comment에 모든 내용 포함
        // 첫 번째 메시지는 멘션 알림을 위한 것이고, 실제 내용은 이미지와 함께 표시
        // 단, 멘션이 있으면 initial_comment 앞에 멘션 추가
        if (mentionedUserIds.length > 0) {
          const mentionText = mentionedUserIds.map(userId => `<@${userId}>`).join(' ');
          initialComment = `${mentionText}\n\n${initialComment}`;
        }

        logger.info('[SlackService] Uploading screenshot via WebClient.files.uploadV2', {
          channelId,
          fileName,
          fullPath,
          hasInitialComment: !!initialComment,
          initialCommentLength: initialComment?.length || 0
        });

        logger.info('[SlackService] Attempting files.uploadV2', {
          channelId,
          fileName,
          fullPath
        });
        
        const uploadResult = await client.files.uploadV2({
          channel_id: channelId,
          file: fs.createReadStream(fullPath),
          filename: fileName,
          title: 'Issue Screenshot',
          initial_comment: initialComment
        });

        logger.info('[SlackService] files.uploadV2 response', {
          ok: uploadResult.ok,
          error: uploadResult.error,
          channelId
        });
        
        logger.info('[SlackService] files.uploadV2 result', {
          ok: uploadResult.ok,
          filesCount: Array.isArray(uploadResult.files) ? uploadResult.files.length : 0,
          raw: uploadResult
        });

        if (!uploadResult.ok) {
          const errorCode = uploadResult.error || 'unknown_error';
          const errorMessage = getErrorMessage(errorCode, uploadResult);
          logger.error('[SlackService] Slack file upload failed (uploadV2)', {
            errorCode,
            errorMessage,
            raw: uploadResult
          });

          // not_in_channel, channel_not_found 같은 에러는 fallback하지 않고 바로 에러 반환
          if (errorCode === 'not_in_channel' || errorCode === 'channel_not_found') {
            throw new Error(errorMessage);
          }

          // 파일 업로드 실패 시 텍스트-only로 fallback (멘션이 있으면 스레드로 전송)
          return await this.sendViaBotAPITextOnly(message, channelId || channel, botToken, firstMessageTs);
        }

        // 이미지가 이미 initial_comment에 포함되어 있으므로, 별도 메시지 전송은 하지 않음
        // 멘션이 있는 경우에만 첫 번째 메시지가 전송되었으므로, 이미지와 함께 모든 내용이 표시됨
        logger.info('[SlackService] File uploaded with initial comment containing message content', {
            channelId,
          hasInitialComment: !!initialComment,
          mentionedUserIds: this._mentionedUserIds || []
        });

        return {
          success: true,
          response: { ok: true, message: { text: initialComment } },
          fileUpload: uploadResult
        };
      }

      // 2) 스크린샷이 없는 경우: 텍스트 / 블록 메시지만 전송
      // 멘션이 있고 첫 번째 메시지가 전송된 경우 스레드로 전송
      logger.info('[SlackService] No screenshot path, sending text-only message via WebClient', {
        hasThreadTs: !!firstMessageTs,
        mentionedUserIds
      });
      return await this.sendViaBotAPITextOnly(message, channelId || channel, botToken, firstMessageTs);
    } catch (error) {
      logger.error('Failed to send Slack message via Bot API (WebClient)', {
        error: error.message,
        data: error.data,
        channel,
        screenshotPath
      });

      // 에러 발생 시 텍스트-only 재시도 (멘션이 있으면 스레드로 전송)
      return await this.sendViaBotAPITextOnly(message, channelId || channel, botToken, firstMessageTs);
    }
  }

  /**
   * Slack Bot API를 통해 텍스트 메시지만 전송
   * @param {Object} message - Slack 메시지 객체
   * @param {string} channel - 채널 ID 또는 이름
   * @param {string} botToken - Bot Token
   * @param {string|null} threadTs - 스레드 타임스탬프 (스레드로 전송할 경우)
   * @returns {Promise<Object>} 전송 결과
   */
  async sendViaBotAPITextOnly(message, channel, botToken, threadTs = null) {
    const client = new WebClient(botToken);

    const payload = {
      channel: channel,
      text: message.text,
      attachments: message.attachments,
      blocks: message.blocks
    };
    
    // thread_ts가 있으면 스레드로 전송
    if (threadTs) {
      payload.thread_ts = threadTs;
      logger.info('[SlackService] Sending text-only message as thread reply', { threadTs });
    }

    logger.info('[SlackService] Attempting chat.postMessage (text-only)', {
      channel,
      hasBlocks: !!message.blocks,
      hasAttachments: !!message.attachments
    });

    const response = await client.chat.postMessage(payload);
    
    logger.info('[SlackService] chat.postMessage (text-only) response', {
      ok: response.ok,
      error: response.error,
      channel
    });

    if (response.ok) {
      logger.info('Slack message sent via Bot API (WebClient.chat.postMessage)', {
        channel,
        messageText: message.text?.substring(0, 100)
      });
      return { success: true, response };
    } else {
      const errorCode = response.error || 'unknown_error';
      const errorMessage = getErrorMessage(errorCode, { 
        error: errorCode, 
        provided: channel 
      });
      logger.error('[SlackService] Slack API error', {
        errorCode,
        errorMessage,
        channel
      });
      throw new Error(errorMessage);
    }
  }

  /**
   * Slack 채널 목록 가져오기
   * @returns {Promise<Array>} 채널 목록 [{id, name, is_private, is_archived}]
   */
  async getChannels() {
    const botToken = this.getBotToken();
    if (!botToken) {
      throw new Error('SLACK_BOT_TOKEN is not configured');
    }

    try {
      const response = await axios.post('https://slack.com/api/conversations.list', {
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 1000
      }, {
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.data.ok) {
        const channels = (response.data.channels || []).map(channel => ({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.is_private,
          isArchived: channel.is_archived,
          isMember: channel.is_member
        })).filter(channel => {
          // 아카이브된 채널 제외
          if (channel.isArchived) return false;
          // 봇이 멤버인 채널만 반환 (not_in_channel 에러 방지)
          return channel.isMember === true;
        });

        logger.info('Slack channels fetched (bot member only)', { 
          totalChannels: response.data.channels?.length || 0,
          botMemberChannels: channels.length 
        });
        return channels;
      } else {
        throw new Error(`Slack API error: ${response.data.error}`);
      }
    } catch (error) {
      logger.error('Failed to fetch Slack channels', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Bot Token의 권한 확인 (auth.test API 사용)
   * @param {string} botToken - Bot Token
   * @returns {Promise<Object>} 권한 정보
   */
  async checkBotTokenPermissions(botToken) {
    try {
      const response = await axios.post('https://slack.com/api/auth.test', {}, {
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
      if (response.data.ok) {
        const scopes = response.data.response_metadata?.scopes || [];
        const hasFilesWrite = scopes.includes('files:write');
        const hasChatWrite = scopes.includes('chat:write');
        
        logger.info('[SlackService] Bot Token 권한 확인', {
          userId: response.data.user_id,
          teamId: response.data.team_id,
          teamName: response.data.team,
          scopes: scopes,
          hasFilesWrite: hasFilesWrite,
          hasChatWrite: hasChatWrite,
          requiredScopes: ['files:write', 'chat:write'],
          missingScopes: ['files:write', 'chat:write'].filter(scope => !scopes.includes(scope))
        });
        
        if (!hasFilesWrite) {
          logger.warn('[SlackService] files:write 권한이 없습니다. 이미지 업로드가 실패할 수 있습니다.', {
            currentScopes: scopes,
            requiredScope: 'files:write'
          });
        }
        
        return {
          ok: true,
          scopes: scopes,
          hasFilesWrite: hasFilesWrite,
          hasChatWrite: hasChatWrite
        };
      } else {
        logger.warn('[SlackService] auth.test 실패', {
          error: response.data.error
        });
        return {
          ok: false,
          error: response.data.error
        };
      }
    } catch (error) {
      logger.warn('[SlackService] auth.test 호출 실패', {
        error: error.message
      });
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Bot Token의 권한 확인 (auth.test API 사용)
   * @param {string} botToken - Bot Token
   * @returns {Promise<Object>} 권한 정보
   */
  async checkBotTokenPermissions(botToken) {
    try {
      const response = await axios.post('https://slack.com/api/auth.test', {}, {
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
      if (response.data.ok) {
        const scopes = response.data.response_metadata?.scopes || [];
        const hasFilesWrite = scopes.includes('files:write');
        const hasChatWrite = scopes.includes('chat:write');
        
        logger.info('[SlackService] Bot Token 권한 확인', {
          userId: response.data.user_id,
          teamId: response.data.team_id,
          teamName: response.data.team,
          scopes: scopes,
          hasFilesWrite: hasFilesWrite,
          hasChatWrite: hasChatWrite,
          requiredScopes: ['files:write', 'chat:write'],
          missingScopes: ['files:write', 'chat:write'].filter(scope => !scopes.includes(scope))
        });
        
        if (!hasFilesWrite) {
          logger.warn('[SlackService] files:write 권한이 없습니다. 이미지 업로드가 실패할 수 있습니다.', {
            currentScopes: scopes,
            requiredScope: 'files:write'
          });
        }
        
        return {
          ok: true,
          scopes: scopes,
          hasFilesWrite: hasFilesWrite,
          hasChatWrite: hasChatWrite
        };
      } else {
        logger.warn('[SlackService] auth.test 실패', {
          error: response.data.error
        });
        return {
          ok: false,
          error: response.data.error
        };
      }
    } catch (error) {
      logger.warn('[SlackService] auth.test 호출 실패', {
        error: error.message
      });
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * 이슈를 Slack으로 공유
   * @param {Object} issue - 이슈 객체
   * @param {Object} options - 옵션
   * @param {string} options.target - 공유 대상 ('Client_Channel', 'Internal_Channel')
   * @param {string} options.customMessage - 사용자 지정 메시지
   * @param {string} options.channel - Slack 채널 (Bot API 사용 시)
   * @returns {Promise<Object>} 전송 결과
   */
  async shareIssue(issue, options = {}) {
    const { customMessage, channel, shareForm, excludeImage = false, videoPath = null, mentionedUserIds = [] } = options;
    
    // 메시지 포맷팅 (mentionedUserIds 전달)
    const message = this.formatIssueMessage(issue, { customMessage, shareForm, mentionedUserIds });
    
    // 스크린샷 경로 가져오기 (excludeImage가 false일 때만)
    const screenshotPath = (excludeImage || !issue.screenshotPath) ? null : (issue.screenshotPath || null);
    
    // issue 객체를 함수 내부에서 사용할 수 있도록 저장
    this._currentIssue = issue;
    
    // 멘션할 사용자가 있고 스레드로 보내야 하는 경우를 위해 mentionedUserIds 저장
    this._mentionedUserIds = mentionedUserIds;
    
    // 디버깅: screenshotPath 확인
    logger.info('[SlackService] shareIssue called', {
      hasScreenshot: !!screenshotPath,
      screenshotPath,
      channel,
      hasWebhook: !!this.getWebhookUrl(),
      hasBotToken: !!this.getBotToken(),
      issueId: issue.id,
      issueSummary: issue.summary?.substring(0, 50)
    });
    
    // 우선순위 1: Bot Token이 있으면 무조건 Bot API 사용 (이미지 업로드 가능)
    const botToken = this.getBotToken();
    if (botToken) {
      const targetChannel = channel || process.env.SLACK_CHANNEL || '#general';
      logger.info('[SlackService] Using Bot API (Priority 1)', {
        targetChannel,
        screenshotPath,
        hasScreenshot: !!screenshotPath
      });
      
      try {
        // 권한 체크 (임시 디버깅용)
        await this.checkBotTokenPermissions(botToken);
        
        // 채널 ID가 전달된 경우 채널 정보 확인
        if (channel && channel.startsWith('C')) {
          logger.info('[SlackService] Channel ID provided, verifying bot membership', {
            channelId: channel,
            targetChannel
          });
          
          // 채널 정보 확인 (봇이 멤버인지)
          try {
            const channelInfo = await client.conversations.info({ channel });
            if (channelInfo.ok && channelInfo.channel) {
              const isMember = channelInfo.channel.is_member;
              logger.info('[SlackService] Channel info retrieved', {
                channelId: channel,
                channelName: channelInfo.channel.name,
                isMember,
                isPrivate: channelInfo.channel.is_private
              });
              
              if (!isMember) {
                throw new Error(`봇이 채널 '${channelInfo.channel.name}'에 멤버로 등록되어 있지 않습니다. Slack에서 해당 채널에 봇을 초대해주세요.`);
              }
            }
          } catch (infoError) {
            logger.warn('[SlackService] Failed to verify channel membership, proceeding anyway', {
              error: infoError.message,
              channel
            });
            // 채널 정보 확인 실패해도 계속 진행 (실제 API 호출 시 에러 확인)
          }
        }
        
        return await this.sendViaBotAPI(message, targetChannel, botToken, screenshotPath, videoPath);
      } catch (botError) {
        // not_in_channel, channel_not_found 같은 에러는 Webhook으로 fallback하지 않고 바로 에러 반환
        const errorMessage = botError.message || '';
        if (errorMessage.includes('not_in_channel') || 
            errorMessage.includes('channel_not_found') ||
            errorMessage.includes('봇이 해당 채널에 초대되지 않았습니다') ||
            errorMessage.includes('채널을 찾을 수 없습니다')) {
          logger.error('[SlackService] Bot API failed - channel error (no fallback)', {
            error: botError.message,
            channel: targetChannel
          });
          throw botError; // 사용자에게 명확한 에러 메시지 전달
        }
        
        logger.error('[SlackService] Bot API failed, attempting Webhook fallback', {
          error: botError.message,
          hasScreenshot: !!screenshotPath
        });
        
        // Bot API 실패 시 Webhook으로 Fallback
        const webhookUrl = this.getWebhookUrl();
        if (webhookUrl) {
          if (screenshotPath) {
            logger.warn('[SlackService] Screenshot available but falling back to Webhook (image upload not supported)', { 
              screenshotPath,
              botError: botError.message 
            });
          }
          return await this.sendViaWebhook(message, webhookUrl);
        }
        
        // Webhook도 없으면 원래 에러를 throw
        throw botError;
      }
    }
    
    // 우선순위 2: Bot Token이 없으면 Webhook 사용 (이미지는 URL로 공유 불가하므로 텍스트만)
    const webhookUrl = this.getWebhookUrl();
    if (webhookUrl) {
      if (screenshotPath) {
        logger.warn('[SlackService] Screenshot available but Webhook does not support file upload. Please set SLACK_BOT_TOKEN for image upload.', { screenshotPath });
      }
      return await this.sendViaWebhook(message, webhookUrl);
    }
    
    // 둘 다 없으면 에러
    throw new Error('Slack Webhook URL or Bot Token is not configured. Please set SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN environment variable.');
  }
}

module.exports = new SlackService();


