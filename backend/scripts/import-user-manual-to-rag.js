/**
 * USER_MANUAL.md / USER_MANUAL.en.md → RAG(WorkGuide + guide_embeddings)
 * - ## / ### 기준 섹션 분할 후 가이드 등록 및 임베딩
 *
 * 사용법:
 *   node scripts/import-user-manual-to-rag.js [--replace] [--lang=ko|en|all]
 *   --replace : manualRagImport 출처 가이드 삭제 후 재등록
 *   --lang    : ko(한국어만), en(영어만), all(둘 다, 기본값)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { query, execute } = require('../libs/db');
const { execute: pgExecute } = require('../libs/db-postgres');
const workGuideService = require('../services/workGuide.service').getWorkGuideService();
const logger = require('../utils/logger');

const REPO_ROOT = path.resolve(__dirname, '../..');

const MANUAL_SPECS = [
  {
    file: 'USER_MANUAL.md',
    language: 'ko',
    tag: 'USER_MANUAL_KO'
  },
  {
    file: 'USER_MANUAL.en.md',
    language: 'en',
    tag: 'USER_MANUAL_EN'
  }
];

function parseArgv() {
  const replace = process.argv.includes('--replace');
  let lang = 'all';
  const langArg = process.argv.find((a) => a.startsWith('--lang='));
  if (langArg) {
    const v = langArg.split('=')[1]?.toLowerCase();
    if (v === 'ko' || v === 'en' || v === 'all') lang = v;
  }
  return { replace, lang };
}

/**
 * 매뉴얼을 ## / ### 기준으로 섹션 배열로 파싱
 */
function parseManualSections(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const sections = [];
  const blocks = raw.split(/\n(?=#{2,3}\s)/m).filter(Boolean);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!/^#{2,3}\s/m.test(trimmed)) continue;
    const lines = trimmed.split('\n');
    const firstLine = lines[0].trim();
    const headingMatch = firstLine.match(/^#+\s*(.+)$/);
    const title = headingMatch ? headingMatch[1].trim() : firstLine;
    const content = lines.slice(1).join('\n').trim();
    if (!title || title.length < 2) continue;
    if (content.length < 20) continue;
    sections.push({ title, content });
  }

  return sections;
}

function parseMeta(row) {
  try {
    return typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : row.metadata || {};
  } catch {
    return {};
  }
}

/**
 * 매뉴얼 임포트로 생성된 가이드 ID (--replace 시 삭제)
 * - manualRagImport === true (신규)
 * - source 가 USER_MANUAL.md / USER_MANUAL.en.md (구버전 임포트)
 */
function findExistingManualRagImportIds() {
  const rows = query('SELECT id, metadata FROM WorkGuide');
  const ids = [];
  for (const row of rows) {
    const meta = parseMeta(row);
    if (meta.manualRagImport === true) ids.push(row.id);
    else if (meta.source === 'USER_MANUAL.md' || meta.source === 'USER_MANUAL.en.md') ids.push(row.id);
  }
  return ids;
}

async function removeExistingManualGuides() {
  const ids = findExistingManualRagImportIds();
  if (ids.length === 0) return 0;
  const { checkConnection } = require('../libs/db-postgres');
  const pgOk = await checkConnection();
  for (const id of ids) {
    if (pgOk) await pgExecute('DELETE FROM guide_embeddings WHERE guide_id = $1', [id]);
    execute('DELETE FROM WorkGuide WHERE id = ?', [id]);
  }
  logger.info('[ImportUserManual] Removed existing manual RAG guides', { count: ids.length, ids });
  return ids.length;
}

function specsToRun(lang) {
  if (lang === 'all') return MANUAL_SPECS;
  if (lang === 'ko') return MANUAL_SPECS.filter((s) => s.language === 'ko');
  if (lang === 'en') return MANUAL_SPECS.filter((s) => s.language === 'en');
  return MANUAL_SPECS;
}

async function importOneManual(spec) {
  const manualPath = path.join(REPO_ROOT, spec.file);
  if (!fs.existsSync(manualPath)) {
    console.error(`❌ 매뉴얼 파일을 찾을 수 없습니다: ${manualPath}`);
    return { imported: 0, skipped: 0, errors: 1, missingFile: true };
  }

  const sections = parseManualSections(manualPath);
  console.log(`\n📄 ${spec.file} (${spec.language}): ${sections.length} sections\n`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const { title, content } of sections) {
    try {
      await workGuideService.createGuide({
        title,
        content,
        guideType: 'general',
        tags: ['USER_MANUAL', spec.tag, `lang:${spec.language}`],
        metadata: {
          source: spec.file,
          language: spec.language,
          manualRagImport: true
        }
      });
      console.log(`   ✅ ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`);
      imported++;
    } catch (err) {
      if (err.message && err.message.includes('이미 존재합니다')) {
        console.log(`   ⏭️  스킵 (이미 존재): ${title.substring(0, 50)}...`);
        skipped++;
      } else {
        console.error(`   ❌ ${title.substring(0, 40)}... : ${err.message}`);
        errors++;
      }
    }
  }

  return { imported, skipped, errors, missingFile: false };
}

async function main() {
  const { replace, lang } = parseArgv();

  if (replace) {
    const removed = await removeExistingManualGuides();
    console.log(`\n   기존 매뉴얼 RAG 가이드 ${removed}개 삭제됨\n`);
  }

  const runSpecs = specsToRun(lang);
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let anyMissing = false;

  for (const spec of runSpecs) {
    const r = await importOneManual(spec);
    totalImported += r.imported;
    totalSkipped += r.skipped;
    totalErrors += r.errors;
    if (r.missingFile) anyMissing = true;
  }

  console.log('\n📊 합계:');
  console.log(`   생성: ${totalImported}, 스킵: ${totalSkipped}, 오류: ${totalErrors}`);
  console.log('\n✅ 선택한 언어 매뉴얼이 WorkGuide + 임베딩에 반영되었습니다.');
  console.log('   (UI 언어가 영어일 때 RAG는 language=en 가이드만 검색합니다.)\n');

  if (anyMissing) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('[ImportUserManual] Failed', { error: err.message, stack: err.stack });
    console.error('\n❌ 실행 실패:', err.message);
    process.exit(1);
  });
