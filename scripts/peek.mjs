#!/usr/bin/env node
// 公式ページの見張り（config/watch.json）で取り出す行を、記録も通知もせずに表示する（URL や keywords を直したときの確認用）
//   node scripts/peek.mjs rule-loto6 rule-loto7 … id を指定（「rule-」のように前の部分だけでも可）
//   node scripts/peek.mjs                       … すべてのページ
//   --text … 見張る行のほかに、ページの文字のうち数字か「※」を含む行もすべて表示する
//   --url=https://… … id を1つだけ指定したとき、その項目を別の URL で試す（config/watch.json を直す前の確認）
// GitHub Actions の中で動かすと、結果を実行の記録の注釈（notice）にも出す。

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchBytes, decodeBytes } from './lib/http.mjs';
import { htmlToText } from './lib/parse.mjs';
import { extractLines, pageMissing, pageTitle } from './lib/watchlib.mjs';
import { sleep } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const wantText = args.includes('--text');
const ids = args.filter((a) => !a.startsWith('--'));
const conf = JSON.parse(await readFile(path.join(ROOT, 'config/watch.json'), 'utf8'));
const pages = (conf.pages || []).filter((p) => !ids.length || ids.some((id) => p.id === id || p.id.startsWith(id)));
if (!pages.length) {
  console.log(`config/watch.json に ${ids.join('・')} の項目がありません`);
  process.exit(1);
}
const tryUrl = (args.find((a) => a.startsWith('--url=')) || '').slice(6);
if (tryUrl) {
  if (pages.length !== 1) {
    console.log('--url は、id を1つだけ指定したときに使えます');
    process.exit(1);
  }
  pages[0] = { ...pages[0], url: tryUrl };
}

// GitHub Actions の注釈（1つの手順に10件まで出せるので、長いときは分けて最大4件にする）
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
function notice(title, text) {
  if (!process.env.GITHUB_ACTIONS) return;
  const chunks = [];
  for (let rest = String(text); rest.length && chunks.length < 4; rest = rest.slice(3000)) chunks.push(rest.slice(0, 3000));
  chunks.forEach((c, i) => console.log(`::notice title=${escProp(`${title}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`)}::${esc(c)}`));
}

for (const page of pages) {
  const out = [`${page.id}：${page.url}`];
  try {
    const { buf, contentType, url } = await fetchBytes(page.url, { tries: 2, timeoutMs: 20000 });
    const html = decodeBytes(buf, contentType);
    out.push(`題名：${pageTitle(html) || '（なし）'}${url !== page.url ? `（転送先 ${url}）` : ''}`);
    if (pageMissing(html)) out.push('⚠ 「ページが見つかりません」のページです');
    const lines = extractLines(html, page);
    out.push(`見張る行：${lines.length}行`, ...lines.map((l) => `  ${l}`));
    if (wantText) {
      const text = htmlToText(html).split('\n').filter((l) => /\d|※/.test(l));
      out.push(`数字か「※」を含む行：${text.length}行`, ...text.map((l) => `  | ${l}`));
    }
  } catch (e) {
    out.push(`⚠ 開けませんでした：${e.message || e}`);
  }
  console.log(`${out.join('\n')}\n`);
  notice(`peek ${page.id}`, out.join('\n'));
  await sleep(1000);
}
