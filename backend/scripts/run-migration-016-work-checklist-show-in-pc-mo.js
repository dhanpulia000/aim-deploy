#!/usr/bin/env node
/**
 * 마이그레이션 016 수동 실행: WorkChecklistItem에 showInPC, showInMO 컬럼 추가
 * 사용: node scripts/run-migration-016-work-checklist-show-in-pc-mo.js
 */
require('dotenv').config();
const path = require('path');

try {
  const { getDatabase } = require('../libs/db');
  const db = getDatabase();
  
  console.log('Migration 016: WorkChecklistItem에 showInPC, showInMO 컬럼 추가');
  
  // 컬럼 존재 여부 확인
  const tableInfo = db.prepare("PRAGMA table_info(WorkChecklistItem)").all();
  const hasShowInPC = tableInfo.some(c => c.name === 'showInPC');
  const hasShowInMO = tableInfo.some(c => c.name === 'showInMO');
  
  if (hasShowInPC && hasShowInMO) {
    console.log('컬럼이 이미 존재합니다. 마이그레이션 완료.');
    process.exit(0);
  }
  
  if (!hasShowInPC) {
    db.exec('ALTER TABLE WorkChecklistItem ADD COLUMN showInPC INTEGER DEFAULT 0');
    console.log('showInPC 컬럼 추가 완료');
  }
  
  if (!hasShowInMO) {
    db.exec('ALTER TABLE WorkChecklistItem ADD COLUMN showInMO INTEGER DEFAULT 0');
    console.log('showInMO 컬럼 추가 완료');
  }
  
  // 기존 데이터 반영
  db.exec("UPDATE WorkChecklistItem SET showInPC = 1 WHERE workType = 'PC'");
  db.exec("UPDATE WorkChecklistItem SET showInMO = 1 WHERE workType = 'MO'");
  console.log('기존 PC/MO 항목 업데이트 완료');
  
  console.log('Migration 016 완료.');
  process.exit(0);
} catch (err) {
  console.error('Migration 실패:', err.message);
  process.exit(1);
}
