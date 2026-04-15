const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function ensureAdminUser() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const password = await bcrypt.hash(defaultPassword, 10);
    user = await prisma.user.create({
      data: {
        email,
        name: 'Admin',
        password,
        role: 'ADMIN'
      }
    });
    console.log(`✅ Created admin user (${email}) with default password`);
  } else {
    console.log(`ℹ️ Admin user (${email}) already exists`);
  }
  return user;
}

/**
 * 시스템 기준 정보 시드 (종류, 중요도, 성향, 플랫폼 등)
 */
async function seedSystemCodes() {
  console.log('🌱 Seeding system codes...');

  // 종류 (Issue Type)
  const issueTypes = [
    { code: 'OPINION', label: '의견', order: 1 },
    { code: 'SUGGESTION', label: '건의', order: 2 },
    { code: 'INQUIRY', label: '문의', order: 3 },
    { code: 'REPORT', label: '제보', order: 4 }
  ];

  for (const item of issueTypes) {
    const existing = await prisma.systemCode.findFirst({
      where: {
        type: 'ISSUE_TYPE',
        code: item.code
      }
    });

    if (existing) {
      await prisma.systemCode.update({
        where: { id: existing.id },
        data: {
          label: item.label,
          displayOrder: item.order
        }
      });
    } else {
      await prisma.systemCode.create({
        data: {
          type: 'ISSUE_TYPE',
          code: item.code,
          label: item.label,
          displayOrder: item.order,
          isActive: true
        }
      });
    }
  }

  // 중요도 (Importance)
  const importanceLevels = [
    { code: 'HIGH', label: '상', order: 1 },
    { code: 'MEDIUM', label: '중', order: 2 },
    { code: 'LOW', label: '하', order: 3 }
  ];

  for (const item of importanceLevels) {
    const existing = await prisma.systemCode.findFirst({
      where: {
        type: 'IMPORTANCE',
        code: item.code
      }
    });

    if (existing) {
      await prisma.systemCode.update({
        where: { id: existing.id },
        data: {
          label: item.label,
          displayOrder: item.order
        }
      });
    } else {
      await prisma.systemCode.create({
        data: {
          type: 'IMPORTANCE',
          code: item.code,
          label: item.label,
          displayOrder: item.order,
          isActive: true
        }
      });
    }
  }

  // 성향 (Sentiment)
  const sentiments = [
    { code: 'POS', label: '긍정', order: 1 },
    { code: 'NEG', label: '부정', order: 2 },
    { code: 'NEU', label: '중립', order: 3 }
  ];

  for (const item of sentiments) {
    const existing = await prisma.systemCode.findFirst({
      where: {
        type: 'SENTIMENT',
        code: item.code
      }
    });

    if (existing) {
      await prisma.systemCode.update({
        where: { id: existing.id },
        data: {
          label: item.label,
          displayOrder: item.order
        }
      });
    } else {
      await prisma.systemCode.create({
        data: {
          type: 'SENTIMENT',
          code: item.code,
          label: item.label,
          displayOrder: item.order,
          isActive: true
        }
      });
    }
  }

  // 플랫폼 (Platform)
  const platforms = [
    { code: 'STEAM', label: 'Steam', order: 1 },
    { code: 'KAKAO', label: 'Kakao', order: 2 },
    { code: 'EPIC', label: 'Epic', order: 3 },
    { code: 'CONSOLE', label: 'Console', order: 4 }
  ];

  for (const item of platforms) {
    const existing = await prisma.systemCode.findFirst({
      where: {
        type: 'PLATFORM',
        code: item.code
      }
    });

    if (existing) {
      await prisma.systemCode.update({
        where: { id: existing.id },
        data: {
          label: item.label,
          displayOrder: item.order
        }
      });
    } else {
      await prisma.systemCode.create({
        data: {
          type: 'PLATFORM',
          code: item.code,
          label: item.label,
          displayOrder: item.order,
          isActive: true
        }
      });
    }
  }

  // 이슈 결과 (Issue Result) - 향후 확장용
  const issueResults = [
    { code: 'RESOLVED', label: '해결됨', order: 1 },
    { code: 'DUPLICATE', label: '중복', order: 2 },
    { code: 'WONT_FIX', label: '수정 안함', order: 3 },
    { code: 'INVALID', label: '유효하지 않음', order: 4 }
  ];

  for (const item of issueResults) {
    const existing = await prisma.systemCode.findFirst({
      where: {
        type: 'ISSUE_RESULT',
        code: item.code
      }
    });

    if (existing) {
      await prisma.systemCode.update({
        where: { id: existing.id },
        data: {
          label: item.label,
          displayOrder: item.order
        }
      });
    } else {
      await prisma.systemCode.create({
        data: {
          type: 'ISSUE_RESULT',
          code: item.code,
          label: item.label,
          displayOrder: item.order,
          isActive: true
        }
      });
    }
  }

  console.log('✅ System codes seeded');
}

/** 네이버 카페 크롤러 프로필 — MonitoredBoard.cafeGame 값과 1:1 */
async function seedCrawlerGames() {
  console.log('🌱 Seeding crawler games (CRAWLER_GAME)...');
  const games = [
    {
      code: 'PUBG_PC',
      label: 'PUBG 공식 PC 카페 (naver.com)',
      order: 1,
      metadata: JSON.stringify({
        externalSource: 'NAVER_CAFE_PUBG_PC',
        clanExternalSource: 'NAVER_CAFE_PUBG_PC_CLAN',
        naverFlavor: 'pc'
      })
    },
    {
      code: 'PUBG_MOBILE',
      label: 'PUBG 공식 모바일 카페 (naver.com)',
      order: 2,
      metadata: JSON.stringify({
        externalSource: 'NAVER_CAFE_PUBG_MOBILE',
        naverFlavor: 'mobile'
      })
    }
  ];

  for (const item of games) {
    const existing = await prisma.systemCode.findFirst({
      where: { type: 'CRAWLER_GAME', code: item.code }
    });
    if (existing) {
      await prisma.systemCode.update({
        where: { id: existing.id },
        data: {
          label: item.label,
          displayOrder: item.order,
          metadata: item.metadata,
          isActive: true
        }
      });
    } else {
      await prisma.systemCode.create({
        data: {
          type: 'CRAWLER_GAME',
          code: item.code,
          label: item.label,
          displayOrder: item.order,
          metadata: item.metadata,
          isActive: true
        }
      });
    }
  }
  console.log('✅ Crawler games seeded');
}

async function main() {
  console.log('🌱 Seeding database...');
  const admin = await ensureAdminUser();
  await seedSystemCodes();
  await seedCrawlerGames();

  console.log(
    `🎉 Seed complete. Admin user ID: ${admin.id}. (프로젝트는 시드에 포함되지 않습니다 — 관리 화면에서 생성 시 카테고리 택소노미가 자동 생성됩니다.)`
  );
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

