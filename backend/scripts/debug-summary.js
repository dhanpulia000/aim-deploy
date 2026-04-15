/**
 * Quick diagnostic script for inspecting recent ReportItemIssue rows.
 *
 * Usage:
 *   node backend/scripts/debug-summary.js
 */
const { prisma } = require('../libs/db');

async function main() {
  console.log('[debug-summary] Fetching latest 10 ReportItemIssue rows...');
  const issues = await prisma.reportItemIssue.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      summary: true,
      aiClassificationReason: true,
      detail: true
    }
  });

  if (!issues.length) {
    console.log('No ReportItemIssue records found for inspection.');
    return;
  }

  issues.forEach((issue, index) => {
    console.log('='.repeat(60));
    console.log(`#${index + 1} ID: ${issue.id}`);
    console.log(`createdAt: ${issue.createdAt?.toISOString?.() || issue.createdAt}`);
    console.log(`summary: ${issue.summary || '(empty)'}`);
    console.log(`aiClassificationReason: ${issue.aiClassificationReason || '(empty)'}`);
    console.log(`detail: ${issue.detail || '(empty)'}`);
  });

  console.log('='.repeat(60));
  console.log(`[debug-summary] Total rows printed: ${issues.length}`);
}

main()
  .catch(err => {
    console.error('[debug-summary] Failed to inspect ReportItemIssue rows:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma && prisma.$disconnect) {
      await prisma.$disconnect();
    }
  });















