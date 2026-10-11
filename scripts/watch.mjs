#!/usr/bin/env node
// 公式ページの見張り（1日1回）。
//   ・ポイントの率、支払い方法、購入場所、ジャンボの発売予定が書かれた公式ページを開き、前の日と比べる
//   ・変わっていたら「確認のお願い」を出す（notify.mjs が GitHub の Issue にする）。サイトの数値は自動では変えない
//   ・次のジャンボが未登録、報道ベースの賞金表の発売が近い、ポイントの確認から90日、なども知らせる
//   ・BIG777（毎月7日を含む週の BIG）の回を月に1回知らせ、判定が当せん金と合わないときも知らせる
// どこかで失敗しても終了コードは 0（サイトの更新は止めない）。

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchBytes, decodeBytes } from './lib/http.mjs';
import { jstParts, sleep } from './lib/util.mjs';
import { resolveGames } from './lib/model.mjs';
import { loadAlerts, saveAlerts, raise, clear } from './lib/alerts.mjs';
import { extractLines, hashLines, changeIssue, downIssue, scheduleChecks, specialChecks } from './lib/watchlib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);
const readJson = async (f, fb) => {
  try { return JSON.parse(await readFile(P(f), 'utf8')); } catch { return fb; }
};

const now = jstParts();
const today = now.iso;
const watch = await readJson('config/watch.json', { pages: [] });
const saved = await readJson('data/watch.json', { pages: {} });
saved.pages ??= {};
const alerts = await loadAlerts();
const lines = [];

for (const page of watch.pages || []) {
  const rec = (saved.pages[page.id] ??= {});
  try {
    const { buf, contentType } = await fetchBytes(page.url, { tries: 2, timeoutMs: 20000 });
    const got = extractLines(decodeBytes(buf, contentType), page);
    if (!got.length) throw new Error('見張る行が見つかりません（ページの作りが変わった可能性）');
    const h = hashLines(got);
    if (!rec.hash) {
      lines.push(`${page.name}: 記録を始めました（${got.length}行）`);
    } else if (rec.hash !== h) {
      const issue = changeIssue(page, rec.lines || [], got, today);
      raise(alerts, issue.key, issue.title, issue.body);
      rec.changedAt = today;
      lines.push(`⚠ ${page.name}: 内容が変わりました`);
    } else {
      lines.push(`${page.name}: 変化なし`);
    }
    Object.assign(rec, { hash: h, lines: got, checkedAt: today, fails: 0 });
    delete rec.error;
    clear(alerts, `watchdown-${page.id}`);
  } catch (e) {
    rec.fails = (rec.fails || 0) + 1;
    rec.error = String(e.message || e);
    lines.push(`⚠ ${page.name}: 開けませんでした（${rec.fails}日目）${rec.error}`);
    if (rec.fails >= 3) {
      const issue = downIssue(page, rec.error, rec.fails);
      raise(alerts, issue.key, issue.title, issue.body);
    }
  }
  await sleep(1000);
}

// 見張りの設定から消したページの記録は捨てる
const ids = new Set((watch.pages || []).map((p) => p.id));
for (const id of Object.keys(saved.pages)) if (!ids.has(id)) delete saved.pages[id];

// 日付から分かるお願い（次のジャンボ・賞金表の確認・ポイントの見直し）
try {
  const defs = resolveGames(await readJson('data/games.json', {}));
  const points = await readJson('config/points.json', {});
  for (const c of scheduleChecks(defs, points, today)) {
    if (c.type === 'raise') { raise(alerts, c.key, c.title, c.body); lines.push(`⚠ ${c.title}`); } else clear(alerts, c.key);
  }
} catch (e) {
  lines.push(`⚠ 日付のチェックに失敗: ${e.message || e}`);
}

// BIG777（1等の上限が上がる特別開催回）のお知らせ。同じお知らせを何度も出さないよう、記録を data/watch.json に残す
try {
  const defs = resolveGames(await readJson('data/games.json', {}));
  const state = await readJson('data/state.json', { games: {} });
  const overrides = await readJson('data/overrides.json', {});
  saved.special ??= {};
  for (const c of specialChecks(defs, state, overrides, today, saved.special)) {
    if (c.type === 'raise') { raise(alerts, c.key, c.title, c.body); lines.push(`${c.title.startsWith('【お知らせ】') ? '' : '⚠ '}${c.title}`); } else clear(alerts, c.key);
  }
} catch (e) {
  lines.push(`⚠ BIG777 のチェックに失敗: ${e.message || e}`);
}

saved._note = '公式ページの見張りの記録（scripts/watch.mjs が毎日更新）。前の日と比べるために使います。';
await writeFile(P('data/watch.json'), JSON.stringify(saved, null, 1) + '\n', 'utf8');
await saveAlerts(alerts);
for (const l of lines) console.log(l);
if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `### 公式ページの見張り ${today}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`, { flag: 'a' });
}
