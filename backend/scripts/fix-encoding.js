// UTF-8 BOM 제거 및 파일 재저장 스크립트
// 사용법: node scripts/fix-encoding.js <target-file>

const fs = require('fs');
const path = require('path');

function stripBom(content) {
	if (!content) return content;
	// U+FEFF (BOM) 제거
	if (content.charCodeAt(0) === 0xFEFF) {
		return content.slice(1);
	}
	return content;
}

function fixEncoding(targetPath) {
	const absPath = path.resolve(process.cwd(), targetPath);
	if (!fs.existsSync(absPath)) {
		console.error(`[fix-encoding] File not found: ${absPath}`);
		process.exit(1);
	}
	// 텍스트로 읽어와 BOM 여부 확인
	let content = fs.readFileSync(absPath, { encoding: 'utf8' });
	const hadBom = content.charCodeAt(0) === 0xFEFF;
	content = stripBom(content);
	// UTF-8 (BOM 없이)로 다시 저장
	fs.writeFileSync(absPath, content, { encoding: 'utf8' });
	console.log(`[fix-encoding] Saved without BOM: ${absPath} ${hadBom ? '(BOM removed)' : ''}`);
}

function main() {
	const target = process.argv[2];
	if (!target) {
		console.error('Usage: node scripts/fix-encoding.js <target-file>');
		process.exit(1);
	}
	fixEncoding(target);
}

if (require.main === module) {
	main();
}

