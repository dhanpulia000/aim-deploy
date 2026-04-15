// LINE Webhook controller

const crypto = require('crypto');
const logger = require('../utils/logger');
const lineTargetsService = require('../services/lineTargets.service');

function verifyLineSignature(rawBodyBuffer, channelSecret, signatureHeader) {
  if (!channelSecret) return { ok: false, error: 'LINE_CHANNEL_SECRET not configured' };
  if (!signatureHeader) return { ok: false, error: 'Missing x-line-signature header' };

  const hmac = crypto.createHmac('sha256', channelSecret);
  hmac.update(rawBodyBuffer);
  const expected = hmac.digest('base64');
  const received = signatureHeader;

  // timing safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return { ok: false, error: 'Invalid signature length' };
  const ok = crypto.timingSafeEqual(a, b);
  return ok ? { ok: true } : { ok: false, error: 'Invalid signature' };
}

async function handleWebhook(req, res) {
  try {
    const rawBody = req.body; // Buffer (express.raw)
    const secret = process.env.LINE_CHANNEL_SECRET;
    const signature = req.headers['x-line-signature'];

    const sig = verifyLineSignature(rawBody, secret, signature);
    if (!sig.ok) {
      logger.warn('[LineWebhook] Signature verification failed', { error: sig.error });
      return res.status(401).send('Unauthorized');
    }

    const json = JSON.parse(rawBody.toString('utf8'));
    const events = Array.isArray(json.events) ? json.events : [];

    logger.info('[LineWebhook] Webhook received', {
      eventCount: events.length,
      eventTypes: events.map(e => e?.type).filter(Boolean)
    });

    // 메시지 이벤트는 완전히 무시 (자동 답장/반응하지 않음, 그룹 ID도 추출하지 않음)
    // 그룹/룸 ID는 join/leave 같은 다른 이벤트에서만 추출하여 알람 전송용으로 저장
    const nowIso = new Date().toISOString();
    for (const ev of events) {
      const eventType = ev?.type;
      const source = ev?.source;
      
      // 메시지 이벤트는 완전히 무시 (아무 처리도 하지 않음)
      if (eventType === 'message') {
        logger.info('[LineWebhook] Message event completely ignored (no auto-reply, no processing)', {
          eventType,
          sourceType: source?.type,
          sourceId: source?.groupId || source?.roomId || source?.userId,
          messageType: ev?.message?.type,
          timestamp: new Date().toISOString()
        });
        continue; // 메시지 이벤트는 완전히 건너뜀 (자동 답장 없음)
      }
      
      if (!source) continue;

      // join, leave 등 다른 이벤트에서만 그룹/룸/유저 ID 추출 (알람 전송용)
      if (source.type === 'group' && source.groupId) {
        await lineTargetsService.upsertTarget({
          type: 'group',
          targetId: source.groupId,
          name: null,
          lastSeenAt: nowIso
        });
        logger.debug('[LineWebhook] Group ID extracted for notification target', {
          groupId: source.groupId,
          eventType
        });
      } else if (source.type === 'room' && source.roomId) {
        await lineTargetsService.upsertTarget({
          type: 'room',
          targetId: source.roomId,
          name: null,
          lastSeenAt: nowIso
        });
        logger.debug('[LineWebhook] Room ID extracted for notification target', {
          roomId: source.roomId,
          eventType
        });
      } else if (source.type === 'user' && source.userId) {
        await lineTargetsService.upsertTarget({
          type: 'user',
          targetId: source.userId,
          name: null,
          lastSeenAt: nowIso
        });
        logger.debug('[LineWebhook] User ID extracted for notification target', {
          userId: source.userId,
          eventType
        });
      }
      
      // 기타 이벤트 타입 (join, leave 등)은 그룹 ID 추출만 하고 무시
      if (eventType && eventType !== 'message') {
        logger.debug('[LineWebhook] Non-message event processed (group ID extraction only)', {
          eventType,
          sourceType: source?.type
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('[LineWebhook] Failed to handle webhook', { error: error.message });
    return res.status(500).json({ ok: false, error: error.message });
  }
}

module.exports = { handleWebhook };

