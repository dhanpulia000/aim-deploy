#!/usr/bin/env node
/**
 * 오늘 날짜 캘린더 이벤트 등록 테스트
 * 사용법: node scripts/test-calendar-event.js [email] [password]
 * 또는: EMAIL=... PASSWORD=... node scripts/test-calendar-event.js
 */

const BASE = process.env.API_BASE || 'http://127.0.0.1:8080';

function todayKST() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return {
    dateStr: `${y}-${m}-${day}`,
    iso: `${y}-${m}-${day}T${h}:${min}:${s}+09:00`,
  };
}

async function main() {
  const email = process.argv[2] || process.env.EMAIL;
  const password = process.argv[3] || process.env.PASSWORD;

  if (!email || !password) {
    console.error('사용법: node scripts/test-calendar-event.js <email> <password>');
    console.error('또는: EMAIL=... PASSWORD=... node scripts/test-calendar-event.js');
    process.exit(1);
  }

  const { dateStr, iso } = todayKST();
  console.log('오늘 날짜(KST):', dateStr);
  console.log('API Base:', BASE);

  try {
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) {
      console.error('로그인 실패:', loginBody.message || loginBody.error || loginRes.status);
      process.exit(1);
    }
    const token = loginBody.data?.token ?? loginBody.token;
    if (!token) {
      console.error('토큰 없음:', loginBody);
      process.exit(1);
    }
    console.log('로그인 성공');

    const eventBody = {
      platform: 'PC',
      startDate: iso,
      endDate: iso.replace(/\d{2}:\d{2}:\d{2}/, '18:00:00'),
      title: `테스트 이벤트 (${dateStr})`,
      link: null,
    };

    const createRes = await fetch(`${BASE}/api/calendar/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(eventBody),
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error('이벤트 등록 실패:', createRes.status, createData);
      process.exit(1);
    }

    const event = createData.data?.event ?? createData.event;
    console.log('이벤트 등록 성공:', event?.id);
    console.log('  제목:', event?.title);
    console.log('  시작:', event?.startDate);
    console.log('  종료:', event?.endDate);
  } catch (e) {
    console.error('오류:', e.message);
    process.exit(1);
  }
}

main();
