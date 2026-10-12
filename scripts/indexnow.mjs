#!/usr/bin/env node
// IndexNow：内容が変わったページを、Bing などの検索エンジンにすぐ知らせる（1日1回）。Google は IndexNow を使っていません。
//   node scripts/indexnow.mjs plan … 自動更新の build ジョブで、サイトを生成したあとに実行。
//                                   朝6時以降の最初の更新で、前回選んだあとに内容が変わったページを data/indexnow.json に書く
//   node scripts/indexnow.mjs send … 公開（deploy）のあとに実行。今回の実行で選んだページを IndexNow に送る
//   --force … 時刻や「今日はもう選んだ」に関係なく選ぶ／送る
// キーは config/site.json の indexNowKey（空なら何もしない）。キーのファイルは build.mjs がサイトに置く。
// どこかで失敗しても終了コードは 0（サイトの更新は止めない）。

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { jstParts, sleep } from './lib/util.mjs';
import { ENDPOINT, validKey, changedSince, dueToday, pageUrl, payload, statusText } from './lib/indexnow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);
const readJson = async (f, fb) => {
  try { return JSON.parse(await readFile(P(f), 'utf8')); } catch { return fb; }
};
const mode = process.argv[2];
const force = process.argv.includes('--force') || process.env.INDEXNOW_FORCE === 'true';
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const site = await readJson('config/site.json', {});
const base = String(site.baseUrl || '').replace(/\/$/, '');
const key = String(site.indexNowKey || '').trim();
const runId = process.env.GITHUB_RUN_ID || 'local';

async function plan() {
  const now = jstParts();
  const nowIso = `${now.iso}T${String(now.hh).padStart(2, '0')}:${String(now.mm).padStart(2, '0')}+09:00`;
  const state = await readJson('data/indexnow.json', {});
  const gate = dueToday({ today: now.iso, hh: now.hh, lastRun: state.lastRun, force });
  if (!gate.due) { log(gate.reason); return; }
  const tracked = (await readJson('data/pages.json', {})).pages || {};
  const urls = changedSince(tracked, state.plannedAt).map((p) => pageUrl(base, p));
  const next = {
    _note: '検索エンジン（IndexNow）に知らせるページの記録（scripts/indexnow.mjs が毎日書く）。plannedAt より後に内容が変わったページを、次の日に送ります。',
    lastRun: now.iso, plannedAt: nowIso, run: runId, urls,
  };
  await writeFile(P('data/indexnow.json'), JSON.stringify(next, null, 1) + '\n', 'utf8');
  log(urls.length ? `内容が変わったページを${urls.length}件選びました（公開のあとに送ります）` : '前回から内容が変わったページはありません');
}

async function send() {
  const state = await readJson('data/indexnow.json', {});
  if (state.run !== runId && !force) { log('今回の実行で送るページはありません（1日1回、朝の最初の更新のあとに送ります）'); return; }
  const urls = (state.urls || []).filter((u) => u.startsWith(`${base}/`));
  if (!urls.length) { log('送るページはありません'); return; }
  // キーのファイルが公開されているか確かめる（初めての公開の直後は、少し待つことがある）
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    if (i) await sleep(20000);
    try {
      const res = await fetch(`${base}/${key}.txt?t=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
      ok = res.ok && (await res.text()).trim() === key;
    } catch { /* 次の試行へ */ }
  }
  if (!ok) { log(`::warning::キーのファイル（${base}/${key}.txt）がまだ見えないため、今回は送りませんでした。翌日以降、内容が変わったページから送ります。`); return; }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload({ base, key, urls })),
      signal: AbortSignal.timeout(30000),
    });
    const msg = `${statusText(res.status)}（HTTP ${res.status}・${urls.length}件）`;
    if (res.status === 200 || res.status === 202) log(`IndexNow：${msg}`);
    else log(`::warning::IndexNow：${msg} ${(await res.text()).slice(0, 200)}`);
  } catch (e) {
    log(`::warning::IndexNow に送れませんでした：${e.message || e}`);
  }
}

try {
  if (!validKey(key)) log(key ? '::warning::config/site.json の indexNowKey の形式が正しくありません（英数字とハイフンで8〜128文字）' : 'IndexNow のキーがないので、検索エンジンへの通知はしません');
  else if (!base.startsWith('https://')) log('::warning::config/site.json の baseUrl が https:// で始まっていません');
  else if (mode === 'plan') await plan();
  else if (mode === 'send') await send();
  else log('使い方：node scripts/indexnow.mjs plan | send [--force]');
} catch (e) {
  log(`::warning::IndexNow の処理に失敗しました：${e.message || e}`);
}
if (process.env.GITHUB_STEP_SUMMARY && lines.length) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `### 検索エンジンへの通知（IndexNow）\n\n${lines.map((l) => `- ${l.replace(/^::warning::/, '⚠ ')}`).join('\n')}\n`, { flag: 'a' }).catch(() => {});
}
