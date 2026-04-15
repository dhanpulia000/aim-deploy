/**
 * 프로젝트별 기본 카테고리 택소노미 (Prisma 클라이언트 또는 interactive transaction `tx` 사용)
 */
async function seedCategoryTaxonomy(db, projectId) {
  const serverGroup = await db.categoryGroup.upsert({
    where: { projectId_code: { projectId, code: 'SERVER' } },
    update: {
      color: '#FF6B35',
      description: '서버 관련 이슈 (접속 불가, 네트워크 등)'
    },
    create: {
      projectId,
      name: '서버',
      code: 'SERVER',
      color: '#FF6B35',
      description: '서버 관련 이슈 (접속 불가, 네트워크 등)',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: serverGroup.id, code: 'SERVER_CONN_FAIL' } },
    update: {},
    create: {
      groupId: serverGroup.id,
      name: '접속 불가',
      code: 'SERVER_CONN_FAIL',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: serverGroup.id, code: 'SERVER_NETWORK' } },
    update: {},
    create: {
      groupId: serverGroup.id,
      name: '네트워크',
      code: 'SERVER_NETWORK',
      isActive: true
    }
  });

  const performanceGroup = await db.categoryGroup.upsert({
    where: { projectId_code: { projectId, code: 'PERFORMANCE' } },
    update: {
      color: '#FF6B35',
      description: '퍼포먼스 관련 이슈 (프레임 드랍, 실행 오류, 최적화 등)'
    },
    create: {
      projectId,
      name: '퍼포먼스',
      code: 'PERFORMANCE',
      color: '#FF6B35',
      description: '퍼포먼스 관련 이슈 (프레임 드랍, 실행 오류, 최적화 등)',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: performanceGroup.id, code: 'PERF_FRAME_DROP' } },
    update: {},
    create: {
      groupId: performanceGroup.id,
      name: '프레임 드랍',
      code: 'PERF_FRAME_DROP',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: performanceGroup.id, code: 'PERF_RUNTIME_ERROR' } },
    update: {},
    create: {
      groupId: performanceGroup.id,
      name: '실행 오류',
      code: 'PERF_RUNTIME_ERROR',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: performanceGroup.id, code: 'PERF_OPTIMIZATION' } },
    update: {},
    create: {
      groupId: performanceGroup.id,
      name: '최적화',
      code: 'PERF_OPTIMIZATION',
      isActive: true
    }
  });

  const illegalProgramGroup = await db.categoryGroup.upsert({
    where: { projectId_code: { projectId, code: 'ILLEGAL_PROGRAM' } },
    update: {
      color: '#FF6B35',
      description: '불법프로그램 및 계정 관련 이슈 (이용제한조치, 계정도용 등)'
    },
    create: {
      projectId,
      name: '불법프로그램',
      code: 'ILLEGAL_PROGRAM',
      color: '#FF6B35',
      description: '불법프로그램 및 계정 관련 이슈 (이용제한조치, 계정도용 등)',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: illegalProgramGroup.id, code: 'ILLEGAL_RESTRICTION' } },
    update: {},
    create: {
      groupId: illegalProgramGroup.id,
      name: '이용제한조치',
      code: 'ILLEGAL_RESTRICTION',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: illegalProgramGroup.id, code: 'ILLEGAL_ACCOUNT_THEFT' } },
    update: {},
    create: {
      groupId: illegalProgramGroup.id,
      name: '계정도용',
      code: 'ILLEGAL_ACCOUNT_THEFT',
      isActive: true
    }
  });

  const contentGroup = await db.categoryGroup.upsert({
    where: { projectId_code: { projectId, code: 'CONTENT' } },
    update: {
      color: '#4ECDC4',
      description: '게임 콘텐츠 관련 이슈 (경쟁전, 일반매치, 이벤트, 총기 밸런스 등)'
    },
    create: {
      projectId,
      name: '콘텐츠',
      code: 'CONTENT',
      color: '#4ECDC4',
      description: '게임 콘텐츠 관련 이슈 (경쟁전, 일반매치, 이벤트, 총기 밸런스 등)',
      isActive: true
    }
  });

  const contentCategories = [
    { name: '게임 플레이', code: 'CONTENT_GAMEPLAY' },
    { name: '경쟁전', code: 'CONTENT_RANKED' },
    { name: '일반매치', code: 'CONTENT_NORMAL_MATCH' },
    { name: '아케이드', code: 'CONTENT_ARCADE' },
    { name: '이벤트', code: 'CONTENT_EVENT' },
    { name: '서바이버패스', code: 'CONTENT_SURVIVOR_PASS' },
    { name: '유료', code: 'CONTENT_PAID' },
    { name: '총기 밸런스', code: 'CONTENT_WEAPON_BALANCE' },
    { name: '비매너 행위', code: 'CONTENT_TOXIC' }
  ];

  for (const cat of contentCategories) {
    await db.category.upsert({
      where: { groupId_code: { groupId: contentGroup.id, code: cat.code } },
      update: {},
      create: {
        groupId: contentGroup.id,
        name: cat.name,
        code: cat.code,
        isActive: true
      }
    });
  }

  const bugGroup = await db.categoryGroup.upsert({
    where: { projectId_code: { projectId, code: 'BUG' } },
    update: {
      color: '#4ECDC4',
      description: '버그 관련 이슈 (지형 투과, 오브젝트 끼임, 그래픽, UI/UX 등)'
    },
    create: {
      projectId,
      name: '버그',
      code: 'BUG',
      color: '#4ECDC4',
      description: '버그 관련 이슈 (지형 투과, 오브젝트 끼임, 그래픽, UI/UX 등)',
      isActive: true
    }
  });

  const bugCategories = [
    { name: '지형 투과', code: 'BUG_TERRAIN_CLIP' },
    { name: '오브젝트 끼임', code: 'BUG_OBJECT_STUCK' },
    { name: '그래픽', code: 'BUG_GRAPHIC' },
    { name: '모델링', code: 'BUG_MODELING' },
    { name: '아이템', code: 'BUG_ITEM' },
    { name: 'UI', code: 'BUG_UI' },
    { name: 'UX', code: 'BUG_UX' },
    { name: '음량 및 음성', code: 'BUG_AUDIO' }
  ];

  for (const cat of bugCategories) {
    await db.category.upsert({
      where: { groupId_code: { groupId: bugGroup.id, code: cat.code } },
      update: {},
      create: {
        groupId: bugGroup.id,
        name: cat.name,
        code: cat.code,
        isActive: true
      }
    });
  }

  const esportsGroup = await db.categoryGroup.upsert({
    where: { projectId_code: { projectId, code: 'ESPORTS' } },
    update: {
      color: '#45B7D1',
      description: '이스포츠 관련 이슈 (PCS, PGI.S 등)'
    },
    create: {
      projectId,
      name: '이스포츠',
      code: 'ESPORTS',
      color: '#45B7D1',
      description: '이스포츠 관련 이슈 (PCS, PGI.S 등)',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: esportsGroup.id, code: 'ESPORTS_PCS' } },
    update: {},
    create: {
      groupId: esportsGroup.id,
      name: 'PCS',
      code: 'ESPORTS_PCS',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: esportsGroup.id, code: 'ESPORTS_PGI' } },
    update: {},
    create: {
      groupId: esportsGroup.id,
      name: 'PGI.S',
      code: 'ESPORTS_PGI',
      isActive: true
    }
  });

  const communityGroup = await db.categoryGroup.upsert({
    where: { projectId_code: { projectId, code: 'COMMUNITY' } },
    update: {
      color: '#45B7D1',
      description: '커뮤니티 관련 이슈 (이벤트 등)'
    },
    create: {
      projectId,
      name: '커뮤니티',
      code: 'COMMUNITY',
      color: '#45B7D1',
      description: '커뮤니티 관련 이슈 (이벤트 등)',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: communityGroup.id, code: 'COMMUNITY_EVENT' } },
    update: {},
    create: {
      groupId: communityGroup.id,
      name: '이벤트',
      code: 'COMMUNITY_EVENT',
      isActive: true
    }
  });

  const otherGameGroup = await db.categoryGroup.upsert({
    where: { projectId_code: { projectId, code: 'OTHER_GAME' } },
    update: {
      color: '#45B7D1',
      description: '타게임 관련 이슈'
    },
    create: {
      projectId,
      name: '타게임',
      code: 'OTHER_GAME',
      color: '#45B7D1',
      description: '타게임 관련 이슈',
      isActive: true
    }
  });

  await db.category.upsert({
    where: { groupId_code: { groupId: otherGameGroup.id, code: 'OTHER_GAME_GENERIC' } },
    update: {},
    create: {
      groupId: otherGameGroup.id,
      name: '타게임 제목',
      code: 'OTHER_GAME_GENERIC',
      isActive: true
    }
  });
}

module.exports = { seedCategoryTaxonomy };
