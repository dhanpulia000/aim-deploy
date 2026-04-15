const { prisma } = require('../libs/db');

async function main() {
  try {
    const groups = await prisma.categoryGroup.findMany({
      include: {
        categories: true,
      },
      orderBy: [
        { importance: 'desc' },
        { name: 'asc' },
      ],
    });

    console.log(`Category groups found: ${groups.length}`);
    console.log(JSON.stringify(groups, null, 2));
  } catch (error) {
    console.error('Failed to load categories:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();












