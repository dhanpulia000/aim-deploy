-- Playwright 목록 스캔으로 얻은 일별 게시글 수( KST YYYY-MM-DD ) 저장. 통계 API는 기간이 모두 채워져 있으면 DB 우선.

CREATE TABLE IF NOT EXISTS BoardListDailySnapshot (
  monitoredBoardId INTEGER NOT NULL,
  dateKst TEXT NOT NULL,
  postCount INTEGER NOT NULL DEFAULT 0,
  scanTotalRows INTEGER,
  maxPagesUsed INTEGER,
  computedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (monitoredBoardId, dateKst),
  FOREIGN KEY (monitoredBoardId) REFERENCES MonitoredBoard(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_boardlistsnapshot_date ON BoardListDailySnapshot(dateKst);
CREATE INDEX IF NOT EXISTS idx_boardlistsnapshot_computed ON BoardListDailySnapshot(computedAt);
