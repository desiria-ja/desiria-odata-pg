// 文書に書いた「テスト結果の総数」が、実際のツール出力と一致することを検証する。
// 2026-08-09、REPORT.md が「tests 18 / pass 17」と自分のツール出力に矛盾していた。
// 実装が正しくても、報告が矛盾していたら信用されない。
//
// 見るのは「総数の主張」だけ。ファイル単位の内訳（"index.test.js: 8件"）は正当なので見ない。
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const out = execSync('npm test 2>&1 || true', { encoding: 'utf8' });
const tests = /^ℹ tests (\d+)/m.exec(out)?.[1];
const pass = /^ℹ pass (\d+)/m.exec(out)?.[1];
const fail = /^ℹ fail (\d+)/m.exec(out)?.[1];

if (!tests) { console.error('テスト出力を解析できなかった'); process.exit(1); }
if (fail !== '0') { console.error(`失敗しているテストがある: fail=${fail}`); process.exit(1); }
if (tests !== pass) { console.error(`実測が矛盾: tests=${tests} pass=${pass}`); process.exit(1); }

// 総数の主張だけを拾う: 貼り付けたツール出力、「全N件」「N件すべて」「N件 pass」
const TOTALS = [
  /(?:^|\n)\s*(?:ℹ\s*)?tests (\d+)/g,
  /(?:^|\n)\s*(?:ℹ\s*)?pass (\d+)/g,
  /全\s*(\d+)\s*件/g,
  /(\d+)\s*件すべて/g,
  /(\d+)\s*件\s*(?:pass|成功|通過)/gi,
];

let bad = 0;
for (const f of ['README.md', 'REPORT.md', 'REPORT-paid.md', 'REPORT-fix.md', 'ENVIRONMENTS.md']) {
  if (!existsSync(f)) continue;
  const s = readFileSync(f, 'utf8');
  for (const re of TOTALS) {
    for (const m of s.matchAll(re)) {
      if (m[1] !== tests) {
        console.error(`${f}: "${m[0].trim()}" は実測 ${tests} 件と一致しない`);
        bad++;
      }
    }
  }
}
if (bad) { console.error(`\n→ 文書を直すか、テストを直すか、どちらかに揃えること`); process.exit(1); }
console.log(`OK: tests=${tests} pass=${pass} fail=${fail}。文書の総数の記載とも一致`);
