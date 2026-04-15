-- ReportItemIssue: 게시글 본문 이미지 다중 경로 (JSON 문자열 배열)
ALTER TABLE "ReportItemIssue" ADD COLUMN IF NOT EXISTS "postImagePaths" TEXT;
