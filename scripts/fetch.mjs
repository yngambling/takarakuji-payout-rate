#!/usr/bin/env node
// 公式サイトから最新の当せん結果・販売状況を取得して data/state.json を更新する。
//   node scripts/fetch.mjs          … 通常実行
//   node scripts/fetch.mjs --dump   … 取得した生データを debug/ に保存（パーサー修正用）
//
// 取得に失敗した項目は前回の値を残し、エラー内容を state.json の error に記録する。
// どれかが失敗しても終了コードは 0（サイトの更新は止めない）。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchBytes, decodeBytes } from './lib/http.mjs';
import {
  parseMizuhoNameList, parseMizuhoCsv, parseHoldCntIds,
  parseBigInfo, parseBigResult, parseDunkInfo, parseDunkResult,
} from './lib/parse.mjs';
import { jstParts, yenJa, sleep } from './lib/util.mjs';
import { NAMES, resultEntry } from './lib/logtext.mjs';
import { raise, clear, saveAlerts, HOW_TO_FIX } from './lib/alerts.mjs';
import { sportsLabels } from './lib/products.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);
const DUMP = process.argv.includes('--dump');
const QUIET = process.argv.includes('--quiet');

const nowIso = (() => {
  const p = jstParts();
  return `${p.iso}T${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}:00+09:00`;
})();

// くじ別ページの「過去1年」のグラフ用に、公式データを1回の実行で少しずつさかのぼって集める
const BACKFILL_RAW = process.env.BACKFILL_PER_RUN;
const BACKFILL_PER_RUN = BACKFILL_RAW === undefined || BACKFILL_RAW === '' ? 12 : Math.max(0, Number(BACKFILL_RAW) || 0);
const KEEP_DAYS = 372;
const cutoffIso = new Date(Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);

const readJson = async (f, fb) => {
  try { return JSON.parse(await readFile(P(f), 'utf8')); } catch { return fb; }
};
const writeJson = (f, v) => writeFile(P(f), JSON.stringify(v, null, 1) + '\n', 'utf8');

const state = await readJson('data/state.json', { games: {} });
state.games ??= {};
const log = await readJson('data/log.json', []);
const report = [];
const say = (s) => { report.push(s); if (!QUIET) console.log(s); };
const warn = (s) => { report.push(`⚠ ${s}`); console.log(`::warning::${s}`); };

// 確認が必要なこと（最後に notify.mjs が GitHub の Issue にする）
const alerts = { open: [], ok: [] };
const today = nowIso.slice(0, 10);
const daysSince = (iso) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86400000);
const OVERRIDE_EXAMPLE = '```json\n{ "games": { "loto6": { "carryover": 123456789, "note": "公式サイトで確認した値", "until": "2026-12-31" } } }\n```';
function fetchFailed(key, what, error, extra = null) {
  raise(alerts, `fetch-${key}`, `【要確認】${what}を取得できませんでした`, [
    `${what}を、自動更新で取得できませんでした。`,
    '',
    `- エラー：${error}`,
    '- サイトの表示：前回までに取得できた値のまま表示し、くじ別のページに注意書きを出しています。',
    '- 一時的な通信エラーなら、次の更新（1日5回）で取得でき、このIssueは自動で閉じます。',
    extra,
    '',
    '### 1日以上続くとき',
    '公式サイトの作りが変わった可能性があります。',
    '1. GitHub の「Actions」タブで、⚠ が付いた実行の「Summary」を開き、エラーの内容を確認します。',
    '2. 急ぐときは `data/overrides.json` に値を手で入れると、その値で計算します（`until` の日付を過ぎると自動で無視されます）。',
    OVERRIDE_EXAMPLE,
    '',
    HOW_TO_FIX,
  ].filter((x) => x !== null).join('\n'));
}

async function dump(name, buf) {
  if (!DUMP) return;
  await mkdir(P('debug'), { recursive: true });
  await writeFile(P('debug', name), buf);
}

async function get(url, name, encoding = null) {
  const { buf, contentType } = await fetchBytes(url);
  await dump(name, buf);
  await sleep(700); // 相手先に負担をかけないよう間隔をあける
  return decodeBytes(buf, contentType, encoding);
}

function addLog(entry) {
  if (log.some((e) => e.key === entry.key)) return;
  log.push(entry);
  log.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 新しい日付が先（同じ日は追加順）
  log.length = Math.min(log.length, 400);
}

/* ------------------------------ ロト6・ロト7 ------------------------------ */

async function updateLoto(key) {
  const g = (state.games[key] ??= {});
  g.draws ??= [];
  const base = 'https://www.mizuhobank.co.jp/takarakuji/apl';
  try {
    const list = parseMizuhoNameList(await get(`${base}/txt/${key}/name.txt`, `${key}-name.txt`, 'shift_jis'));
    if (!list.length) throw new Error('name.txt に CSV が見つかりません');
    // ファイル名（A102 + 回号.CSV）の回号で新しい順に並べる
    const files = [...new Set(list)]
      .map((f) => ({ f, round: parseInt(f.replace(/\.csv$/i, '').slice(4), 10) }))
      .filter((x) => x.round > 0)
      .sort((a, b) => b.round - a.round);
    const knownMax = Math.max(0, ...g.draws.map((d) => d.round));
    let added = 0;
    let back = 0;
    const unreadable = [];
    for (const [i, { f: file, round }] of files.entries()) {
      const recent = i < 10;
      if (!recent && (back >= BACKFILL_PER_RUN || (g.oldestChecked && round <= g.oldestChecked))) break;
      const have = g.draws.find((d) => d.file === file && d.complete);
      if (have) continue;
      const csv = await get(`${base}/csv/${key}/${file}`, `${key}-${file}`, 'shift_jis');
      if (!recent) back++;
      const r = parseMizuhoCsv(csv);
      const ok = r.round > 0 && r.date && r.sales > 1e7 && r.carryover != null && r.tiers.length >= 4;
      if (!ok) { warn(`${NAMES[key]} ${file} を読み取れませんでした`); if (recent) unreadable.push(file); continue; }
      if (!recent && r.date < cutoffIso) { g.oldestChecked = r.round; break; } // 1年より前まで来たら終わり
      const draw = { round: r.round, date: r.date, sales: r.sales, carryover: r.carryover, tiers: r.tiers, numbers: r.numbers, bonus: r.bonus, file, complete: true };
      const j = g.draws.findIndex((d) => d.round === r.round);
      if (j >= 0) g.draws[j] = draw; else { g.draws.push(draw); added++; }
      if (r.round > knownMax) addLog(resultEntry(key, r));
    }
    g.draws = g.draws.filter((d) => !d.date || d.date >= cutoffIso).sort((a, b) => b.round - a.round);
    g.draws.length = Math.min(g.draws.length, 130);
    g.fetchedAt = nowIso;
    g.source = 'みずほ銀行 当せん番号データ（CSV）';
    delete g.error;
    say(`${NAMES[key]}: 最新 第${g.draws[0]?.round}回（${g.draws[0]?.date}） 繰越 ${yenJa(g.draws[0]?.carryover)} / 新規 ${added}件（さかのぼり ${back}件・保存 ${g.draws.length}回分）`);
    clear(alerts, `fetch-${key}`);
    if (unreadable.length) {
      raise(alerts, `parse-${key}`, `【要確認】${NAMES[key]}の結果ファイルの形式が変わった可能性があります`, [
        `みずほ銀行の当せん番号データ（${NAMES[key]}）のうち、次のファイルを読み取れませんでした。読み取れなかった回は、計算と表に入っていません。`,
        '',
        ...unreadable.map((f) => `- ${f}`),
        '',
        '公式のファイルの書き方が変わった可能性があります。読み取りの処理（`scripts/lib/parse.mjs` の `parseMizuhoCsv`）を直す必要があります。直ると自動で閉じます。',
        '',
        HOW_TO_FIX,
      ].join('\n'));
    } else clear(alerts, `parse-${key}`);
    // 新しい結果が長く入ってこない（取得はできているのに更新が止まっている）
    const limit = key === 'loto6' ? 8 : 10;
    const latest = g.draws[0];
    if (latest?.date && daysSince(latest.date) > limit) {
      raise(alerts, `stale-${key}`, `【要確認】${NAMES[key]}の結果が${daysSince(latest.date)}日間更新されていません`, [
        `最新の抽せん結果が、第${latest.round}回（${latest.date}）のままです。`,
        '',
        '- 抽せんが休みの時期（年末年始など）なら問題ありません。抽せんが再開して結果が入ると、このIssueは自動で閉じます。',
        '- 休みでないのに続くときは、公式データの置き場所や形式が変わった可能性があります。',
        '',
        HOW_TO_FIX,
      ].join('\n'));
    } else clear(alerts, `stale-${key}`);
  } catch (e) {
    g.error = String(e.message || e);
    warn(`${NAMES[key]} の取得に失敗: ${g.error}`);
    fetchFailed(key, `${NAMES[key]}の当せん結果（みずほ銀行の当せん番号データ）`, g.error);
  }
}

/* --------------------------- BIG 系・DUNK（共通） --------------------------- */

const SPORTS = {
  big: {
    ids: ['big', 'megabig', 'big100', 'big1000', 'minibig'],
    label: 'BIG系',
    info: 'https://store.toto-dream.com/dcs/subos/screen/pi02/spin005/PGSPIN00501InitBIGLotInfo.form',
    list: 'https://store.toto-dream.com/dcs/subos/screen/pi05/spin014/PGSPIN01401InitLotResultLstBIG.form',
    detail: (id) => `https://store.toto-dream.com/dcs/subos/screen/pi05/spin014/PGSPIN01401LnkHoldCntLotResultLstBIG.form?holdCntId=${id}`,
    parseInfo: parseBigInfo,
    parseResult: parseBigResult,
  },
  dunk: {
    ids: ['dunk10', 'dunk6a', 'dunk6b'],
    label: 'DUNK',
    info: 'https://store.toto-dream.com/dcs/subos/screen/pi51/spin070/PGSPIN07001InitDunkLotInfo.form',
    list: 'https://store.toto-dream.com/dcs/subos/screen/pi52/spin073/PGSPIN07301InitLotResultLstDUNK.form',
    detail: (id) => `https://store.toto-dream.com/dcs/subos/screen/pi52/spin073/PGSPIN07301LnkHoldCntLotResultLstDUNK.form?holdCntId=${id}`,
    parseInfo: parseDunkInfo,
    parseResult: parseDunkResult,
  },
};

const sane = (r) => r && r.sales > 1e5 && r.sales < 5e10 && r.tiers?.length >= 3 && r.carryoverOut >= 0 && r.carryoverOut < 1e11;

async function updateSports(kind) {
  const S = SPORTS[kind];
  for (const id of S.ids) (state.games[id] ??= {}).results ??= [];
  // 公式ページに出てくるくじの名前（知らない新しいくじが出たら、毎朝の見張り（watch.mjs）が知らせる）
  const labels = new Set();
  const noteLabels = (html) => { for (const l of sportsLabels(html, kind)) labels.add(l); };

  // 1) 販売中の回
  try {
    const infoHtml = await get(S.info, `${kind}-info.html`);
    noteLabels(infoHtml);
    const info = S.parseInfo(infoHtml);
    const got = Object.keys(info);
    if (!got.length) throw new Error('くじ情報ページから販売中の回を読み取れませんでした');
    for (const id of S.ids) {
      const g = state.games[id];
      if (!info[id]) continue;
      const next = { ...info[id], fetchedAt: nowIso };
      const cur = g.onSale;
      // 公式の「くじ情報」には最新の回しか出ないことがある。いま販売中の回が残っていて、
      // 新しい回がまだ販売前なら、販売中の回を残して新しい回は nextSale に入れる。
      const endK = (o) => `${o.salesEnd}T${o.salesEndTime || '23:59'}`;
      const startK = (o) => `${o.salesStart || o.salesEnd}T${o.salesStartTime || '00:00'}`;
      const nowK = nowIso.slice(0, 16);
      if (cur && cur.round < next.round && cur.salesEnd && endK(cur) >= nowK && next.salesStart && startK(next) > nowK) {
        g.nextSale = next;
      } else {
        g.onSale = next;
        if (g.nextSale && g.nextSale.round <= next.round) delete g.nextSale;
      }
      delete g.infoError;
    }
    say(`${S.label} 販売中: ${got.map((id) => `${NAMES[id]} 第${info[id].round}回（〜${info[id].salesEnd ?? '?'}）`).join(' / ')}`);
    clear(alerts, `fetch-${kind}-info`);
  } catch (e) {
    for (const id of S.ids) state.games[id].infoError = String(e.message || e);
    warn(`${S.label} くじ情報の取得に失敗: ${e.message || e}`);
    fetchFailed(`${kind}-info`, `${S.label}の販売情報（スポーツくじオフィシャルサイトの「くじ情報」）`, String(e.message || e),
      '- シーズンオフなどで販売中の回がないときも、この通知が出ることがあります。販売が始まって取得できると自動で閉じます。');
  }

  // 2) 確定した結果
  try {
    const ids = parseHoldCntIds(await get(S.list, `${kind}-list.html`)).slice(0, 4);
    if (!ids.length) throw new Error('結果一覧に開催回が見つかりません');
    const fresh = {};
    for (const hid of ids) {
      const round = parseInt(hid, 10);
      const known = S.ids.some((id) => state.games[id].results.some((r) => r.round === round));
      if (known && hid !== ids[0]) continue; // 確定済みの古い回は取り直さない（最新回だけは毎回確認）
      const resHtml = await get(S.detail(hid), `${kind}-result-${hid}.html`);
      noteLabels(resHtml);
      const res = S.parseResult(resHtml);
      for (const [id, r] of Object.entries(res)) {
        if (!S.ids.includes(id) || !sane(r)) continue;
        const list = state.games[id].results;
        const i = list.findIndex((x) => x.round === r.round);
        if (i >= 0) list[i] = r; else { list.push(r); (fresh[r.round] ??= []).push(id); }
      }
    }
    // さかのぼって1年分を集める（1回の実行で少しずつ。結果がない回は覚えておいて取り直さない）
    const bf = ((state.backfill ??= {})[kind] ??= { empty: [] });
    const have = new Set(S.ids.flatMap((id) => state.games[id].results.map((r) => r.round)));
    const latest = Math.max(0, ...have, ...ids.map((h) => parseInt(h, 10)));
    const pad = ids[0]?.length || 4;
    let back = 0;
    if (!bf.done && latest > 1) {
      const floor = Math.max(1, latest - 130); // 1年分（BIGは年に約95回）より少し多め
      for (let round = latest - 1; round >= floor && back < BACKFILL_PER_RUN; round--) {
        if (round === floor) bf.done = true;
        if (have.has(round) || bf.empty.includes(round)) continue;
        const res = S.parseResult(await get(S.detail(String(round).padStart(pad, '0')), `${kind}-result-${round}.html`));
        back++;
        let got = 0;
        let old = false;
        for (const [id, r] of Object.entries(res)) {
          if (!S.ids.includes(id) || !sane(r) || r.round !== round) continue; // 別の回のページが返ってきたら使わない
          if ((r.salesEnd || r.resultDate || '9999') < cutoffIso) { old = true; continue; }
          const list = state.games[id].results;
          if (!list.some((x) => x.round === r.round)) list.push(r);
          got++;
        }
        if (old) { bf.done = true; break; }
        if (!got) bf.empty.push(round);
        // 結果のない回が20回続いたら、回号と開催回IDが対応していないとみなしてやめる
        if (bf.empty.length >= 20 && bf.empty.slice(-20).every((x, k, a) => k === 0 || a[k - 1] - x === 1)) { bf.done = true; break; }
      }
      bf.empty = bf.empty.slice(-200);
    }
    for (const id of S.ids) {
      const g = state.games[id];
      g.results = g.results.filter((r) => (r.salesEnd || r.resultDate || '9999') >= cutoffIso).sort((a, b) => b.round - a.round);
      g.results.length = Math.min(g.results.length, 130);
      g.fetchedAt = nowIso;
      g.source = 'スポーツくじオフィシャルサイト くじ結果';
      delete g.error;
    }
    for (const [round, gids] of Object.entries(fresh)) {
      for (const id of gids.sort((a, b) => S.ids.indexOf(a) - S.ids.indexOf(b))) {
        const r = state.games[id].results.find((x) => x.round === +round);
        if (r) addLog(resultEntry(id, r, nowIso.slice(0, 10)));
      }
    }
    say(`${S.label} 結果: 確認した回 ${ids.join(', ')} / 新規 ${Object.keys(fresh).join(', ') || 'なし'}（さかのぼり ${back}件）`);
    clear(alerts, `fetch-${kind}-result`);
  } catch (e) {
    for (const id of S.ids) state.games[id].error = String(e.message || e);
    warn(`${S.label} くじ結果の取得に失敗: ${e.message || e}`);
    fetchFailed(`${kind}-result`, `${S.label}のくじ結果（スポーツくじオフィシャルサイトの「くじ結果」）`, String(e.message || e));
  }
  // 名前を読めた回だけ記録を新しくする（取得に失敗した回は、前の記録を残す）
  if (labels.size) (state.products ??= {})[kind] = { at: nowIso, labels: [...labels] };
}

/* ---------------------------------- 実行 ---------------------------------- */

await updateLoto('loto6');
await updateLoto('loto7');
await updateSports('big');
await updateSports('dunk');

state.updatedAt = nowIso;
await writeJson('data/state.json', state);
await writeJson('data/log.json', log);
await saveAlerts(alerts);
if (alerts.open.length) say(`確認が必要なこと: ${alerts.open.map((a) => a.title).join(' / ')}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `### データ取得 ${nowIso}\n\n${report.map((r) => `- ${r}`).join('\n')}\n`, { flag: 'a' });
}
