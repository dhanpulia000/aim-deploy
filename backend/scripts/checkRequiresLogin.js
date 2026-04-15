const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.reportItemIssue.count({
      where: { requiresLogin: true }
    });
    console.log('Requires-login issues:', count);

    if (count > 0) {
      const sample = await prisma.reportItemIssue.findFirst({
        where: { requiresLogin: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          summary: true,
          requiresLogin: true,
          createdAt: true,
          externalPostId: true
        }
      });
      console.log('Latest sample:', sample);
    }
  } catch (err) {
    console.error('Failed to query issues:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();












