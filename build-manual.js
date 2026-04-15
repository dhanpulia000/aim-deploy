import fs from "fs";
import path from "path";
import MarkdownIt from "markdown-it";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const md = new MarkdownIt({ html: true, linkify: true });

const cssUrl = "https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-light.min.css";

function renderManualToHtml({ inputRelative, outputRelative, lang, title }) {
  const inputPath = path.join(__dirname, inputRelative);
  const outputPath = path.join(__dirname, outputRelative);
  const manualContent = fs.readFileSync(inputPath, "utf-8");

  const htmlTemplate = `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="${cssUrl}">
    <style>
        body {
            box-sizing: border-box;
            min-width: 200px;
            max-width: 980px;
            margin: 0 auto;
            padding: 45px;
        }
        @media (max-width: 767px) {
            body {
                padding: 15px;
            }
        }
        @media print {
            body {
                -webkit-print-color-adjust: exact;
            }
        }
    </style>
</head>
<body class="markdown-body">
    ${md.render(manualContent)}
</body>
</html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, htmlTemplate);
  console.log(`✅ Manual written: ${outputRelative}`);
}

// Korean markdown → root manual.html (optional local preview)
renderManualToHtml({
  inputRelative: "USER_MANUAL.md",
  outputRelative: "manual.html",
  lang: "ko",
  title: "AIMGLOBAL Manual",
});

// Korean → app static path (User guide 링크 `/agent-manual.html`)
renderManualToHtml({
  inputRelative: "USER_MANUAL.md",
  outputRelative: "public/agent-manual.html",
  lang: "ko",
  title: "AIMGLOBAL 사용자 설명서",
});

// English markdown → static asset served with the app
renderManualToHtml({
  inputRelative: "USER_MANUAL.en.md",
  outputRelative: "public/agent-manual-en.html",
  lang: "en",
  title: "AIMGLOBAL User Manual (English)",
});

console.log("Manual build finished.");
