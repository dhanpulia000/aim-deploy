/**
 * 마이그레이션 스크립트: 기존 CategoryGroup을 Default Project에 할당
 * 
 * 실행 방법:
 * node backend/scripts/migrate-category-groups-to-project.js
 */

const { prisma } = require('../libs/db');
const logger = require('../utils/logger');

async function migrateCategoryGroupsToProject() {
  try {
    // Prisma 연결 확인 및 연결
    logger.info('[Migration] Connecting to database...');
    await prisma.$connect();
    logger.info('[Migration] Database connected successfully');

    // 스키마 확인: projectId 컬럼 존재 여부 확인
    // Prisma Client가 스키마 변경을 인식했는지 확인
    try {
      logger.info('[Migration] Checking schema...');
      
      // 방법 1: SQL 직접 쿼리로 테이블 존재 확인
      const testQuery = await prisma.$queryRaw`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='CategoryGroup'
      `;
      
      if (!testQuery || testQuery.length === 0) {
        throw new Error('CategoryGroup table not found');
      }
      
      // 방법 2: SQL 직접 쿼리로 실제 필드 확인 (Prisma Client 의존성 없음)
      const columns = await prisma.$queryRaw`
        PRAGMA table_info(CategoryGroup)
      `;
      
      const hasProjectId = columns.some(col => col.name === 'projectId');
      
      if (!hasProjectId) {
        logger.error('[Migration] Schema Error: projectId column does not exist in CategoryGroup table');
        logger.error('[Migration] Please run the following commands first:');
        logger.error('[Migration]   1. cd backend');
        logger.error('[Migration]   2. npx prisma db push');
        logger.error('[Migration]   3. npx prisma generate');
        logger.error('[Migration]   4. Then run this script again');
        throw new Error('Schema not migrated. Please run "npx prisma db push" first.');
      }
      
      logger.info('[Migration] Schema check passed: projectId column exists in database');
      
      // 방법 3: Prisma Client가 필드를 인식하는지 확인
      // 주의: Prisma Client가 재생성되지 않았으면 여기서 에러 발생 가능
      try {
        await prisma.categoryGroup.findFirst({
          select: { id: true, projectId: true }
        });
        logger.info('[Migration] Prisma Client check passed: projectId field is recognized');
      } catch (prismaError) {
        // Prisma Client가 필드를 인식하지 못하는 경우
        if (prismaError.message && (
          prismaError.message.includes('Unknown argument') ||
          prismaError.message.includes('Invalid') ||
          prismaError.message.includes('projectId')
        )) {
          logger.error('[Migration] Prisma Client Error: projectId field is not recognized by Prisma Client');
          logger.error('[Migration] This means Prisma Client needs to be regenerated.');
          logger.error('[Migration] Please run the following commands:');
          logger.error('[Migration]   1. cd backend');
          logger.error('[Migration]   2. npx prisma generate');
          logger.error('[Migration]   3. Then run this script again');
          throw new Error('Prisma Client not regenerated. Please run "npx prisma generate" first.');
        }
        // 다른 에러는 무시 (데이터가 없을 수도 있음)
        logger.warn('[Migration] Prisma Client test query failed (may be due to no data)', { error: prismaError.message });
      }
    } catch (schemaError) {
      // 이미 명확한 에러 메시지가 있는 경우 그대로 throw
      if (schemaError.message && (
        schemaError.message.includes('Schema not migrated') ||
        schemaError.message.includes('Prisma Client not regenerated')
      )) {
        throw schemaError;
      }
      
      // 기타 스키마 관련 에러 처리
      if (schemaError.message && (
        schemaError.message.includes('Column not found') ||
        schemaError.message.includes('no such column') ||
        schemaError.message.includes('Unknown column')
      )) {
        logger.error('[Migration] Schema Error:', schemaError.message);
        logger.error('[Migration] Please run the following commands first:');
        logger.error('[Migration]   1. cd backend');
        logger.error('[Migration]   2. npx prisma db push');
        logger.error('[Migration]   3. npx prisma generate');
        logger.error('[Migration]   4. Then run this script again');
        throw new Error('Schema not migrated. Please run "npx prisma db push" first.');
      }
      // 다른 에러는 그대로 throw
      throw schemaError;
    }

    logger.info('[Migration] Starting CategoryGroup to Project migration...');

    // 1. Default Project 찾기 또는 생성
    let defaultProject = await prisma.project.findFirst({
      where: { name: 'Default Project' }
    });

    if (!defaultProject) {
      logger.info('[Migration] Creating Default Project...');
      defaultProject = await prisma.project.create({
        data: {
          name: 'Default Project',
          description: '기본 프로젝트 (마이그레이션으로 생성됨)'
        }
      });
      logger.info('[Migration] Default Project created', { id: defaultProject.id });
    } else {
      logger.info('[Migration] Default Project found', { id: defaultProject.id });
    }

    // 2. projectId가 기본값(1)이거나 없는 CategoryGroup 찾기
    // 주의: 스키마에서 projectId는 Int @default(1)이므로 null이 아닙니다.
    // 따라서 SQL 직접 쿼리를 사용하여 확인합니다.
    let categoryGroupsWithoutProject = [];
    try {
      // SQL 직접 쿼리로 projectId가 1(기본값)인 항목들을 찾습니다.
      // 마이그레이션 목적: 기존 데이터가 projectId 없이 생성되었을 수 있으므로
      // 모든 CategoryGroup을 확인하고 Default Project에 할당합니다.
      const allGroups = await prisma.$queryRaw`
        SELECT id, name, projectId 
        FROM CategoryGroup
      `;
      
      // projectId가 1(기본값)이거나 없는 항목들을 필터링
      // 실제로는 모든 항목이 이미 projectId: 1을 가지고 있을 수 있지만,
      // 마이그레이션을 위해 확인합니다.
      categoryGroupsWithoutProject = allGroups.filter(g => !g.projectId || g.projectId === 1);
      
      logger.info('[Migration] Found all CategoryGroups', { 
        total: allGroups.length,
        toMigrate: categoryGroupsWithoutProject.length 
      });
    } catch (queryError) {
      // Prisma Client가 필드를 인식하지 못하는 경우
      if (queryError.message && (
        queryError.message.includes('Unknown argument') ||
        queryError.message.includes('Invalid') ||
        queryError.message.includes('projectId')
      )) {
        logger.error('[Migration] Query Error: Prisma Client does not recognize projectId field');
        logger.error('[Migration] This means Prisma Client needs to be regenerated.');
        logger.error('[Migration] Please run the following commands:');
        logger.error('[Migration]   1. cd backend');
        logger.error('[Migration]   2. npx prisma generate');
        logger.error('[Migration]   3. Then run this script again');
        throw new Error('Prisma Client not regenerated. Please run "npx prisma generate" first.');
      }
      
      // DB 레벨 에러 (컬럼이 실제로 없는 경우)
      if (queryError.message && (
        queryError.message.includes('Column not found') ||
        queryError.message.includes('no such column') ||
        queryError.message.includes('Unknown column')
      )) {
        logger.error('[Migration] Query Error: projectId column does not exist in database');
        logger.error('[Migration] Please run the following commands first:');
        logger.error('[Migration]   1. cd backend');
        logger.error('[Migration]   2. npx prisma db push');
        logger.error('[Migration]   3. npx prisma generate');
        logger.error('[Migration]   4. Then run this script again');
        throw new Error('Schema not migrated. Please run "npx prisma db push" first.');
      }
      // 다른 쿼리 에러는 그대로 throw
      throw queryError;
    }

    logger.info('[Migration] Found CategoryGroups without projectId', { 
      count: categoryGroupsWithoutProject.length 
    });

    if (categoryGroupsWithoutProject.length === 0) {
      logger.info('[Migration] No CategoryGroups to migrate. Migration complete.');
      return;
    }

    // 3. 모든 CategoryGroup을 Default Project에 할당
    // SQL 직접 쿼리를 사용하여 업데이트 (projectId가 1이거나 없는 경우)
    let updateResult;
    try {
      // SQL 직접 쿼리로 업데이트
      updateResult = await prisma.$executeRaw`
        UPDATE CategoryGroup 
        SET projectId = ${defaultProject.id}
        WHERE projectId IS NULL OR projectId = 1
      `;
      
      logger.info('[Migration] CategoryGroups updated via SQL', { 
        count: updateResult,
        projectId: defaultProject.id
      });
    } catch (updateError) {
      // Prisma Client를 사용한 업데이트 시도 (fallback)
      logger.warn('[Migration] SQL update failed, trying Prisma Client', { error: updateError.message });
      try {
        updateResult = await prisma.categoryGroup.updateMany({
          where: {
            projectId: 1 // 기본값이 1이므로
          },
          data: {
            projectId: defaultProject.id
          }
        });
        logger.info('[Migration] CategoryGroups updated via Prisma Client', { 
          count: updateResult.count,
          projectId: defaultProject.id
        });
      } catch (prismaUpdateError) {
        logger.error('[Migration] Both SQL and Prisma Client update failed', { 
          sqlError: updateError.message,
          prismaError: prismaUpdateError.message
        });
        throw prismaUpdateError;
      }
    }

    logger.info('[Migration] CategoryGroups updated', { 
      count: updateResult.count,
      projectId: defaultProject.id
    });

    // 4. 검증: projectId가 올바르게 설정되었는지 확인
    // SQL 직접 쿼리로 확인
    const remaining = await prisma.$queryRaw`
      SELECT id, name, projectId 
      FROM CategoryGroup
      WHERE projectId IS NULL OR projectId != ${defaultProject.id}
    `;

    if (remaining.length > 0) {
      logger.warn('[Migration] Some CategoryGroups still have null projectId', {
        count: remaining.length,
        ids: remaining.map(g => g.id)
      });
    } else {
      logger.info('[Migration] All CategoryGroups have been assigned to a project.');
    }

    logger.info('[Migration] Migration completed successfully!');
    
  } catch (error) {
    logger.error('[Migration] Migration failed', { error: error.message, stack: error.stack });
    
    // 스키마 관련 에러인 경우 명확한 안내 메시지
    if (error.message && error.message.includes('Schema not migrated')) {
      console.error('\n❌ 마이그레이션 실패: 스키마가 업데이트되지 않았습니다.');
      console.error('다음 명령어를 먼저 실행하세요:');
      console.error('  1. cd backend');
      console.error('  2. npx prisma db push');
      console.error('  3. npx prisma generate');
      console.error('  4. 그 다음 이 스크립트를 다시 실행하세요.\n');
    } else if (error.message && error.message.includes('Prisma Client not regenerated')) {
      console.error('\n❌ 마이그레이션 실패: Prisma Client가 재생성되지 않았습니다.');
      console.error('다음 명령어를 실행하세요:');
      console.error('  1. cd backend');
      console.error('  2. npx prisma generate');
      console.error('  3. 그 다음 이 스크립트를 다시 실행하세요.\n');
    }
    
    throw error;
  } finally {
    try {
      await prisma.$disconnect();
      logger.info('[Migration] Database connection closed');
    } catch (disconnectError) {
      logger.warn('[Migration] Error disconnecting from database', { error: disconnectError.message });
    }
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  migrateCategoryGroupsToProject()
    .then(() => {
      logger.info('[Migration] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[Migration] Script failed', { error: error.message });
      process.exit(1);
    });
}

module.exports = { migrateCategoryGroupsToProject };

