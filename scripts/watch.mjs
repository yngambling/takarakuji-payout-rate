#!/usr/bin/env node
// 公式ページの見張り（1日1回。日本時間の朝6時以降の最初の更新で行い、同じ日の2回目からは何もしない）。
//   node scripts/watch.mjs --force … 今日すでに見張っていても、もう一度行う
//   ・ポイントの率、支払い方法、購入場所、くじのルールが書かれた公式ページを開き、前の日と比べる
//     変わっていたら「確認のお願い」を出す（notify.mjs が GitHub の Issue にする）。サイトの数値は自動では変えない
//   ・新しいジャンボ宝くじは、宝くじ公式サイトの発表（宝ニュース）から賞金表を読み取り、検算に通れば data/games.json に自動で登録する
//     （ページには「確認待ち」の注記を出し、Issue で見比べをお願いする。Issue が閉じられたら注記を外す）
//   ・宝くじ・スポーツくじに、このサイトが知らない新しいくじが出ていないか確かめる
//   ・Search Console（設定したときだけ）：サイトマップの送信・エラーと、各ページが Google に登録できているか
//   ・報道ベースの賞金表の発売が近い、ポイントの確認から90日、なども知らせる
//   ・BIG777（毎月7日を含む週の BIG）の回を月に1回知らせ、判定が当せん金と合わないときも知らせる
// どこかで失敗しても終了コードは 0（サイトの更新は止めない）。

import { readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { fetchBytes, decodeBytes } from './lib/http.mjs';
import { jstParts, sleep } from './lib/util.mjs';
import { resolveGames } from './lib/model.mjs';
import { loadAlerts, saveAlerts, raise, clear } from './lib/alerts.mjs';
import { extractLines, hashLines, changeIssue, downIssue, scheduleChecks, specialChecks, watchGate, pageMissing, MISSING_ERROR } from './lib/watchlib.mjs';
import {
  NEWS_LIST_URL, ONSALE_URL, NEWS_DOWN_DAYS, parseNewsList, isJumboNews, parseJumboNews, checkJumbo, planJumbo,
  parseOnSale, missingIssue, newsDownIssue, roundNo,
} from './lib/jumbo.mjs';
import { takarakujiMenu, unknownTakarakuji, takarakujiKey, takarakujiIssue, unknownSports, sportsKey, sportsIssue } from './lib/products.mjs';
import { closedAlertKeys } from './lib/github.mjs';
import { readCredentials, gscClient, sitemapUrls, judgePage, gscChecks, gscSummary, needSubmit } from './lib/gsc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);
const readJson = async (f, fb) => {
  try { return JSON.parse(await readFile(P(f), 'utf8')); } catch { return fb; }
};

const now = jstParts();
const today = now.iso;
const saved = await readJson('data/watch.json', { pages: {} });
saved.pages ??= {};

// 1日1回だけ行う（手動の実行で「公式ページの見張りも今すぐ行う」を選んだときと --force のときは必ず行う）
const gate = watchGate({ today, hh: now.hh, lastRun: saved.lastRun, force: process.env.WATCH_FORCE === 'true' || process.argv.includes('--force') });
if (!gate.run) {
  console.log(gate.reason);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `### 公式ページの見張り\n\n- ${gate.reason}\n`, { flag: 'a' });
  }
  process.exit(0);
}
if (gate.reason) console.log(gate.reason);

const watch = await readJson('config/watch.json', { pages: [] });
const site = await readJson('config/site.json', {});
const alerts = await loadAlerts();
const lines = [];

// 運営者が閉じた Issue（確認した・もう知らせなくてよい の合図）。一度見たものは data/watch.json にも残す
const acked = new Set(saved.acked || []);
try {
  const closed = await closedAlertKeys();
  if (closed) for (const k of closed) if (/^(jumbo-|newproduct-)/.test(k)) acked.add(k);
} catch (e) {
  lines.push(`⚠ 閉じた Issue を読めませんでした（${e.message || e}）。確認済みの判定は次回に行います`);
}
const raiseUnlessAcked = (key, issue) => { if (!acked.has(key)) raise(alerts, key, issue.title, issue.body); };

/* ---------------- 公式ページの見張り ---------------- */

for (const page of watch.pages || []) {
  const rec = (saved.pages[page.id] ??= {});
  try {
    const { buf, contentType } = await fetchBytes(page.url, { tries: 2, timeoutMs: 20000 });
    const html = decodeBytes(buf, contentType);
    // 「ページが見つかりません」のページも正常な応答で返ってくるため、題名と本文で見分けて、その日のうちに知らせる
    if (pageMissing(html)) throw Object.assign(new Error(MISSING_ERROR), { missing: true });
    const got = extractLines(html, page);
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
    if (rec.fails >= 3 || e.missing) {
      const issue = downIssue(page, rec.error, rec.fails, { missing: !!e.missing });
      raise(alerts, issue.key, issue.title, issue.body);
    }
  }
  await sleep(1000);
}

// 見張りの設定から消したページの記録は捨てる
const ids = new Set((watch.pages || []).map((p) => p.id));
for (const id of Object.keys(saved.pages)) if (!ids.has(id)) delete saved.pages[id];

/* ---------------- 新しいジャンボ宝くじの自動登録 ---------------- */

const getText = async (url) => {
  const { buf, contentType } = await fetchBytes(url, { tries: 2, timeoutMs: 20000 });
  await sleep(1000);
  return decodeBytes(buf, contentType);
};

/** games.json を書き換えたら、計算の確認とサイトの生成を試す。失敗したら元に戻す（自動更新を止めないため） */
async function writeGamesSafely(next, before) {
  await writeFile(P('data/games.json'), JSON.stringify(next, null, 2), 'utf8');
  const out = path.join(os.tmpdir(), `takarakuji-trial-${process.pid}`);
  try {
    execFileSync(process.execPath, [P('scripts/test.mjs')], { cwd: ROOT, stdio: 'pipe', timeout: 180000 });
    execFileSync(process.execPath, [P('scripts/build.mjs'), '--out', out, '--no-history'], { cwd: ROOT, stdio: 'pipe', timeout: 180000 });
    return null;
  } catch (e) {
    await writeFile(P('data/games.json'), before, 'utf8');
    return `${e.stderr || ''}${e.stdout || ''}${e.message || ''}`.trim().split('\n').slice(-15).join('\n');
  } finally {
    await rm(out, { recursive: true, force: true }).catch(() => {});
  }
}

const jstate = (saved.jumbo ??= {});
let newsHtml = '';
let news = null;
try {
  newsHtml = await getText(NEWS_LIST_URL);
  news = parseNewsList(newsHtml);
  if (!news.length) throw new Error('お知らせの一覧が見つかりません（ページの作りが変わった可能性）');
  jstate.newsFails = 0;
  delete jstate.newsError;
  clear(alerts, 'jumbo-news-down');
} catch (e) {
  news = null;
  jstate.newsFails = (jstate.newsFails || 0) + 1;
  jstate.newsError = String(e.message || e);
  lines.push(`⚠ 宝ニュースを読めませんでした（${jstate.newsFails}日目）${jstate.newsError}`);
  if (jstate.newsFails >= NEWS_DOWN_DAYS) {
    const issue = newsDownIssue(jstate.newsError, jstate.newsFails);
    raise(alerts, 'jumbo-news-down', issue.title, issue.body);
  }
}

if (news) try {
  const products = [];
  for (const it of news.filter(isJumboNews)) {
    try {
      for (const p of parseJumboNews(await getText(it.url))) products.push({ p, news: it, errors: checkJumbo(p, today) });
    } catch (e) {
      lines.push(`⚠ 宝ニュース「${it.title}」を開けませんでした（${e.message || e}）`);
    }
  }
  const beforeText = await readFile(P('data/games.json'), 'utf8');
  const guides = (await readJson('data/guides.json', {})).games || {};
  const plan = planJumbo(JSON.parse(beforeText), products, { today, closed: acked, base: String(site.baseUrl || '').replace(/\/$/, ''), guides });
  let applied = true;
  if (plan.changed) {
    const err = await writeGamesSafely(plan.raw, beforeText);
    if (!err) clear(alerts, 'jumbo-apply-failed');
    else {
      applied = false;
      raise(alerts, 'jumbo-apply-failed', '【要確認】ジャンボ宝くじの自動登録を取りやめました（サイトの生成で失敗）', [
        '宝くじ公式サイトの発表から読み取ったジャンボ宝くじを `data/games.json` に入れようとしましたが、計算の確認かサイトの生成でエラーになったため、元に戻しました。サイトは前のままです。',
        '',
        '#### しようとしたこと',
        ...plan.lines.map((l) => `- ${l}`),
        '',
        '#### エラー',
        '```',
        err,
        '```',
        '',
        'この Issue の内容を Claude に見せて「直して」と頼んでください。',
      ].join('\n'));
      lines.push('⚠ ジャンボの自動登録を取りやめました（サイトの生成で失敗したため元に戻しました）');
    }
  }
  if (applied) {
    for (const c of plan.items) {
      if (c.type === 'raise') raise(alerts, c.key, c.title, c.body); else clear(alerts, c.key, c.note);
    }
    lines.push(...plan.lines);
  }
  lines.push(`宝ニュース：ジャンボ宝くじ等のお知らせ${news.filter(isJumboNews).length}件・賞金表${products.length}件を確認`);
} catch (e) {
  lines.push(`⚠ ジャンボの自動登録に失敗しました（${e.message || e}）`);
}

// 発売中なのに登録されていないジャンボ（自動登録がうまくいかなかったときの見落とし防止）
try {
  const onSale = parseOnSale(await getText(ONSALE_URL));
  const raw = await readJson('data/games.json', {});
  const known = new Set(Object.values(raw).map((g) => roundNo(g?.round)).filter(Boolean));
  if (!onSale) lines.push('⚠ 「ジャンボ宝くじ等の普通くじ」のページで、発売中のくじの欄が見つかりませんでした');
  const missingNow = new Set();
  for (const x of onSale || []) {
    if (known.has(x.round)) continue;
    missingNow.add(String(x.round));
    raiseUnlessAcked(`jumbo-missing-${x.round}`, missingIssue(x));
    lines.push(`${acked.has(`jumbo-missing-${x.round}`) ? '' : '⚠ '}発売中の${x.name}（第${x.round}回）が登録されていません`);
  }
  for (const r of jstate.missing || []) if (!missingNow.has(r)) clear(alerts, `jumbo-missing-${r}`);
  jstate.missing = [...missingNow];
} catch (e) {
  lines.push(`⚠ 発売中のジャンボを確認できませんでした（${e.message || e}）`);
}

/* ---------------- 新しいくじ（宝くじ・スポーツくじ） ---------------- */

const np = (saved.newProducts ??= {});
const seenNow = new Set();
try {
  // 宝くじ：宝くじ公式サイトのメニュー（宝ニュースのページの上の部分）
  const menu = newsHtml ? takarakujiMenu(newsHtml) : null;
  if (newsHtml && !menu) lines.push('⚠ 宝くじ公式サイトのメニューが見つかりませんでした（新しいくじの確認をとばしました）');
  for (const x of unknownTakarakuji(menu)) {
    const key = takarakujiKey(x);
    seenNow.add(key);
    np[key] = { name: x.name, first: np[key]?.first || today, last: today };
    raiseUnlessAcked(key, takarakujiIssue(x));
    lines.push(`${acked.has(key) ? '' : '⚠ '}宝くじ公式サイトに、知らないくじ「${x.name}」があります${acked.has(key) ? '（Issue が閉じられたので、知らせません）' : ''}`);
  }
  // スポーツくじ：自動更新（fetch.mjs）が、くじ情報・くじ結果のページで見たくじの名前
  const state = await readJson('data/state.json', {});
  for (const kind of ['big', 'dunk']) {
    for (const label of unknownSports(kind, state.products?.[kind]?.labels)) {
      const key = sportsKey(kind, label);
      seenNow.add(key);
      np[key] = { name: label, kind, first: np[key]?.first || today, last: today };
      raiseUnlessAcked(key, sportsIssue(kind, label, np[key].first));
      lines.push(`${acked.has(key) ? '' : '⚠ '}スポーツくじに、知らないくじ「${label}」があります${acked.has(key) ? '（Issue が閉じられたので、知らせません）' : ''}`);
    }
  }
  // 読み取りに足して知っているくじになった、または2週間見かけないくじのお知らせは閉じる
  const ago = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10);
  for (const [key, v] of Object.entries(np)) {
    if (seenNow.has(key)) continue;
    const known = v.kind ? !unknownSports(v.kind, [v.name]).length : false;
    if (known || v.last < ago) { clear(alerts, key); delete np[key]; }
  }
} catch (e) {
  lines.push(`⚠ 新しいくじの確認に失敗: ${e.message || e}`);
}

/* ---------------- Search Console の自動チェック（GSC_CREDENTIALS を設定したときだけ） ---------------- */

const gscCred = readCredentials(process.env.GSC_CREDENTIALS);
if (process.env.GSC_CREDENTIALS && !gscCred) lines.push('⚠ GitHub の Secrets の GSC_CREDENTIALS が、サービス アカウントの JSON キーの形になっていません（README「Search Console の自動チェック」）');
if (gscCred && String(site.baseUrl || '').startsWith('https://')) {
  const base = String(site.baseUrl).replace(/\/$/, '');
  const gsite = site.searchConsoleSite || `sc-domain:${new URL(base).host}`;
  const feed = `${base}/sitemap.xml`;
  let result;
  try {
    const gc = gscClient(gscCred);
    const sm = (await gc.sitemaps(gsite)).find((s) => s.path === feed) || null;
    if (needSubmit(sm, today)) {
      await gc.submit(gsite, feed);
      lines.push(`Search Console：サイトマップを${sm ? '送り直しました（7日以上読み込まれていないため）' : '送信しました'}`);
    }
    const urls = sitemapUrls(await getText(feed));
    const pages = [];
    for (const u of urls.slice(0, 80)) pages.push({ url: u, ...judgePage(await gc.inspect(gsite, u)) });
    result = { base, site: gsite, sitemap: sm, pages };
    saved.gsc = gscSummary(pages, today);
    lines.push(`Search Console：Google に登録済み ${saved.gsc.indexed}/${pages.length}ページ${sm ? `・サイトマップのエラー ${Number(sm.errors || 0)}件` : ''}`);
    if (saved.gsc.notIndexed.length) lines.push(`Search Console：まだ登録されていないページ（${saved.gsc.notIndexed.length}）：${saved.gsc.notIndexed.slice(0, 40).map((x) => x.path).join('、')}`);
  } catch (e) {
    result = { base, site: gsite, error: { message: String(e.message || e), auth: !!e.auth } };
    lines.push(`⚠ Search Console のチェックに失敗しました：${e.message || e}`);
  }
  for (const c of gscChecks(result)) {
    if (c.type === 'raise') { raise(alerts, c.key, c.title, c.body); lines.push(`⚠ ${c.title}`); } else clear(alerts, c.key);
  }
}

/* ---------------- 日付から分かるお願い・BIG777 ---------------- */

// 日付から分かるお願い（次のジャンボ・賞金表の確認・ポイントの見直し）
try {
  const defs = resolveGames(await readJson('data/games.json', {}));
  const points = await readJson('config/points.json', {});
  const campaigns = await readJson('config/campaigns.json', null);
  for (const c of scheduleChecks(defs, points, today, campaigns)) {
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

saved.lastRun = today;
saved.acked = [...acked].slice(-300);
saved._note = '公式ページの見張りの記録（scripts/watch.mjs が毎日更新）。前の日と比べるために使います。lastRun は最後に見張った日（1日1回にするため）。acked は運営者が閉じた Issue（確認済み・もう知らせない）。jumbo はジャンボの自動登録、newProducts は新しいくじ、gsc は Search Console で Google に登録済みのページ数と、まだ登録されていないページ（notIndexed：パスと Google の説明）の記録です。';
await writeFile(P('data/watch.json'), JSON.stringify(saved, null, 1) + '\n', 'utf8');
await saveAlerts(alerts);
for (const l of lines) console.log(l);
if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `### 公式ページの見張り ${today}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`, { flag: 'a' });
}
