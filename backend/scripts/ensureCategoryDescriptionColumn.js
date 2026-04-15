const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function ensureColumn() {
  try {
    const tableInfo = await prisma.$queryRawUnsafe(`PRAGMA table_info('Category');`);
    const hasDescription = tableInfo.some((col) => col.name === 'description');

    if (hasDescription) {
      console.log('Category.description column already exists.');
    } else {
      console.log('Adding description column to Category table...');
      await prisma.$executeRawUnsafe(`ALTER TABLE Category ADD COLUMN description TEXT;`);
      console.log('description column added successfully.');
    }
  } catch (error) {
    console.error('Failed to ensure description column:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

ensureColumn();












