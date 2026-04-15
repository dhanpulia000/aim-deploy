/**
 * Backfill processedAt/processedBy for issues that are already RESOLVED/VERIFIED
 * but missing processed fields (which prevents agent performance stats from counting them).
 *
 * Scope: KST "today" by updatedAt.
 *
 * Usage:
 *  - Dry-run (default): node backend/scripts/backfill-processed-fields-kst-today.js
 *  - Apply changes:     node backend/scripts/backfill-processed-fields-kst-today.js --apply
 */
require('dotenv').config();

const { query, execute } = require('../libs/db');

function hasFlag(name) {
  return process.argv.includes(name);
}

function pickProcessedBy(row) {
  return row.excludedBy || row.assignedAgentId || row.checkedBy || null;
}

function pickProcessedAt(row) {
  return row.excludedAt || row.checkedAt || row.updatedAt || null;
}

async function main() {
  const apply = hasFlag('--apply');
  const now = new Date().toISOString();

  const candidates = query(
    `
    SELECT id, summary, status,
           processedAt, processedBy,
           excludedAt, excludedBy,
           assignedAgentId,
           checkedAt, checkedBy,
           updatedAt
    FROM ReportItemIssue
    WHERE DATE(updatedAt, '+9 hours') = DATE('now', '+9 hours')
      AND status IN ('RESOLVED', 'VERIFIED')
      AND (processedAt IS NULL OR processedBy IS NULL)
    ORDER BY updatedAt DESC
    `
  );

  const plan = candidates.map(r => {
    const processedBy = r.processedBy || pickProcessedBy(r);
    const processedAt = r.processedAt || pickProcessedAt(r) || now;
    return {
      id: r.id,
      status: r.status,
      summary: (r.summary || '').slice(0, 50),
      oldProcessedAt: r.processedAt,
      oldProcessedBy: r.processedBy,
      newProcessedAt: processedAt,
      newProcessedBy: processedBy,
      canFix: Boolean(processedBy)
    };
  });

  const canFix = plan.filter(p => p.canFix);
  const cannotFix = plan.filter(p => !p.canFix);

  console.log(`[BackfillProcessed] candidates=${plan.length} canFix=${canFix.length} cannotFix=${cannotFix.length} apply=${apply}`);
  if (plan.length) {
    console.table(plan.slice(0, 20));
    if (plan.length > 20) console.log(`[BackfillProcessed] (showing first 20 of ${plan.length})`);
  }

  if (!apply) {
    console.log('[BackfillProcessed] Dry-run only. Re-run with --apply to write changes.');
    return;
  }

  let updatedCount = 0;
  for (const item of canFix) {
    execute(
      `
      UPDATE ReportItemIssue
      SET processedAt = COALESCE(processedAt, ?),
          processedBy = COALESCE(processedBy, ?),
          updatedAt = ?
      WHERE id = ?
      `,
      [item.newProcessedAt, item.newProcessedBy, now, item.id]
    );
    updatedCount += 1;
  }

  const remaining = query(
    `
    SELECT COUNT(*) as cnt
    FROM ReportItemIssue
    WHERE DATE(updatedAt, '+9 hours') = DATE('now', '+9 hours')
      AND status IN ('RESOLVED', 'VERIFIED')
      AND (processedAt IS NULL OR processedBy IS NULL)
    `
  )?.[0]?.cnt;

  console.log(`[BackfillProcessed] Updated=${updatedCount}. RemainingMissing=${remaining}`);
  if (cannotFix.length) {
    console.log('[BackfillProcessed] Cannot fix automatically (no excludedBy/assignedAgentId/checkedBy):');
    console.table(cannotFix.slice(0, 20));
  }
}

main().catch(err => {
  console.error('[BackfillProcessed] Failed:', err);
  process.exitCode = 1;
});

