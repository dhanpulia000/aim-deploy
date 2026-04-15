#!/usr/bin/env node
/**
 * WorkNotification 테이블 조회 + taskNotification 워커 수 확인
 * 라인 알림 중복 전송(33건 등) 원인 분석용
 * 사용: node scripts/check-work-notifications.js
 */
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { query } = require('../libs/db');

function getTaskNotificationWorkerCount() {
  try {
    const out = execSync('ps aux | grep -E "taskNotification\\.worker\\.js" | grep -v grep | wc -l', { encoding: 'utf8' });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function main() {
  try {
    const workerCount = getTaskNotificationWorkerCount();
    console.log('\n=== taskNotification 워커 수 ===');
    console.log('실행 중:', workerCount, '개', workerCount > 1 ? '⚠️ 중복! (라인 알림 N배 전송)' : '(정상)');
    const all = query('SELECT id, workName, repeatType, notificationTime, notificationDate, intervalMinutes, windowStartTime, windowEndTime, lineChannelId, isActive FROM WorkNotification ORDER BY createdAt ASC');
    
    console.log('\n=== WorkNotification 조회 ===');
    console.log('총:', all.length, '| 활성:', all.filter(n => n.isActive).length);
    
    const byType = {};
    all.forEach(n => {
      const t = n.repeatType || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    });
    console.log('repeatType별:', byType);
    console.log('간격(interval) 타입:', all.filter(n => n.repeatType === 'interval').length, '개\n');
    
    all.forEach((n, i) => {
      const line = n.lineChannelId && String(n.lineChannelId).trim() ? 'LINE' : '-';
      console.log(`${i + 1}. ${n.workName} | ${n.repeatType} | ${n.notificationTime} | active=${n.isActive} | ${line}`);
    });
    
    const active = all.filter(n => n.isActive && n.lineChannelId && String(n.lineChannelId).trim());
    let est = 0;
    active.forEach(n => {
      if (n.repeatType === 'interval' && n.intervalMinutes) {
        const s = parseTime(n.windowStartTime) || 0;
        const e = parseTime(n.windowEndTime) || 24 * 60;
        est += Math.floor((e - s) / n.intervalMinutes) + 1;
      } else {
        est += 1;
      }
    });
    console.log('\n하루 예상 발송:', est, '건');
    if (workerCount > 1) {
      console.log('\n⚠️ 워커가', workerCount, '개 실행 중입니다. safe-start.sh 실행 후 재확인하세요.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

function parseTime(s) {
  if (!s || !s.includes(':')) return null;
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

main();
