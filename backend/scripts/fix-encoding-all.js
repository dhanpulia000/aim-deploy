// 워크스페이스 전체 파일 UTF-8(BOM 제거) 정리 스크립트
// 사용법: node scripts/fix-encoding-all.js <target-dir>

const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set([
	'js', 'jsx', 'ts', 'tsx',
	'json', 'md', 'mdx', 'txt',
	'html', 'htm', 'css', 'scss', 'less',
	'env', 'gitignore',
	'prisma', 'sql',
	'config', 'yml', 'yaml',
	'bat', 'ps1'
]);

function isTextFile(filePath) {
	const ext = path.extname(filePath).toLowerCase().replace('.', '');
	if (TEXT_EXTENSIONS.has(ext)) return true;
	// 일부 확장자 없는 구성 파일 허용
	const base = path.basename(filePath).toLowerCase();
	return ['dockerfile', 'makefile', 'readme', 'license'].includes(base);
}

function stripBomString(content) {
	if (!content) return content;
	return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
}

function fixFileEncoding(filePath) {
	try {
		const buf = fs.readFileSync(filePath);
		// 바이너리 가능성 간단 체크: 널바이트가 많으면 스킵
		// eslint-disable-next-line no-control-regex
		const hasManyNulls = (buf.slice(0, 2048).toString('utf8').match(/\u0000/g) || []).length > 0;
		if (hasManyNulls) return { skipped: true };

		let content = buf.toString('utf8');
		const hadBom = content.charCodeAt(0) === 0xFEFF;
		content = stripBomString(content);
		fs.writeFileSync(filePath, content, { encoding: 'utf8' });
		return { fixed: hadBom };
	} catch (e) {
		return { error: e.message };
	}
}

function walkDir(dir, results = []) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkDir(full, results);
		} else if (entry.isFile()) {
			results.push(full);
		}
	}
	return results;
}

function main() {
	const targetDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : process.cwd();
	if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
		console.error(`[fix-encoding-all] Directory not found: ${targetDir}`);
		process.exit(1);
	}

	const files = walkDir(targetDir);
	let total = 0, fixed = 0, skipped = 0, errors = 0;
	for (const file of files) {
		if (!isTextFile(file)) { skipped++; continue; }
		const res = fixFileEncoding(file);
		total++;
		if (res.fixed) fixed++;
		else if (res.skipped) skipped++;
		else if (res.error) { errors++; }
	}
	console.log(`[fix-encoding-all] Done. scanned=${files.length} text=${total} fixed=${fixed} skipped=${skipped} errors=${errors}`);
}

if (require.main === module) {
	main();
}

