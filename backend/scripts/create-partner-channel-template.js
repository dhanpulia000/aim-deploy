/**
 * 파트너 영상 아카이빙용 채널 리스트 샘플 템플릿 생성
 * 출력: AIM/public/partner_channel_list_template.xlsx
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const headers = ['채널명', '플랫폼', '유튜브 URL', '채널 ID', '틱톡 URL', '인스타그램 URL', '라이브 URL'];

const sampleRows = [
  ['파트너A (유튜브)', '유튜브', 'https://www.youtube.com/@example', '', '', '', ''],
  ['파트너B (유튜브)', '유튜브', '', 'UCxxxxxxxxxxxxxxxxxxxxxx', '', '', 'https://chzzk.naver.com/...'],
  ['파트너C (틱톡)', '틱톡', '', '', 'https://www.tiktok.com/@username', '', ''],
  ['파트너D (틱톡)', '틱톡', '', '', '@username', '', ''],
  ['파트너E (인스타그램)', '인스타그램', '', '', '', 'https://www.instagram.com/username/', ''],
  ['파트너F (인스타그램)', '인스타그램', '', '', '', 'username', ''],
];

const data = [headers, ...sampleRows];
const ws = XLSX.utils.aoa_to_sheet(data);
ws['!cols'] = [
  { wch: 22 },
  { wch: 12 },
  { wch: 45 },
  { wch: 26 },
  { wch: 40 },
  { wch: 42 },
  { wch: 35 },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '채널목록');

// 사용 안내 시트
const guideRows = [
  ['컬럼', '설명', '필수 여부'],
  ['채널명', '파트너/채널 표시명', '필수'],
  ['플랫폼', '유튜브 / 틱톡 / 인스타그램 (없으면 유튜브)', '선택'],
  ['유튜브 URL', '유튜브 채널 URL (플랫폼이 유튜브일 때)', '유튜브 시 필수'],
  ['채널 ID', 'UC로 시작하는 채널 ID (유튜브 URL 대신 사용 가능, 할당량 절약)', '선택'],
  ['틱톡 URL', '틱톡 프로필 URL 또는 @username (플랫폼이 틱톡일 때)', '틱톡 시 필수'],
  ['인스타그램 URL', '인스타그램 프로필 URL 또는 username (플랫폼이 인스타그램일 때)', '인스타 시 필수'],
  ['라이브 URL', '라이브 방송 URL (치지직, 아프리카 등)', '선택'],
];
const guideWs = XLSX.utils.aoa_to_sheet(guideRows);
guideWs['!cols'] = [{ wch: 18 }, { wch: 55 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, guideWs, '사용안내');

const outDir = path.join(__dirname, '../../public');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'partner_channel_list_template.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Created:', outPath);
