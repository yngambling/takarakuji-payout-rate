#!/usr/bin/env node
// パーサーと還元率計算の確認（node scripts/test.mjs）
// test/fixtures/ の HTML・CSV は公式ページの並びをまねた見本です（ロト6の2〜5等の数値は架空）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodeBytes } from './lib/http.mjs';
import {
  parseMizuhoNameList, parseMizuhoCsv, parseBigResult, parseBigInfo,
  parseDunkResult, parseDunkInfo, parseHoldCntIds, findDates,
} from './lib/parse.mjs';
import { evaluate, expectedShare, maxRate } from './lib/ev.mjs';
import { resolveGames, computeGame } from './lib/model.mjs';
import { weekdayOf } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = (f) => readFileSync(path.join(ROOT, 'test/fixtures', f));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b}（許容 ${tol}）`);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

/* ---------- パーサー ---------- */

t('日付（年なし・和暦）', () => {
  assert.deepEqual(findDates('2026年09月26日(土)〜10月03日(土)').map((d) => d.iso), ['2026-09-26', '2026-10-03']);
  assert.deepEqual(findDates('令和8年10月8日').map((d) => d.iso), ['2026-10-08']);
  assert.deepEqual(findDates('2026年12月28日〜1月4日').map((d) => d.iso), ['2026-12-28', '2027-01-04']);
});

t('みずほ name.txt', () => {
  assert.deepEqual(parseMizuhoNameList(decodeBytes(fx('name.txt'), '', 'shift_jis')), ['A1022144.CSV', 'A1022143.CSV']);
});

t('みずほ CSV（ロト6・Shift_JIS）', () => {
  const r = parseMizuhoCsv(decodeBytes(fx('loto6.csv'), '', 'shift_jis'));
  assert.equal(r.round, 2144);
  assert.equal(r.date, '2026-10-08');
  assert.equal(r.sales, 1270263600);
  assert.equal(r.carryover, 388848);
  assert.equal(r.tiers.length, 5);
  assert.deepEqual(r.tiers[0], { tier: 1, winners: 1, prize: 200000000 });
  assert.deepEqual(r.numbers, [2, 11, 19, 27, 33, 41]);
  assert.deepEqual(r.bonus, [7]);
});

t('みずほ CSV（ロト7・1等該当なし）', () => {
  const r = parseMizuhoCsv(decodeBytes(fx('loto7.csv'), '', 'shift_jis'));
  assert.equal(r.round, 697);
  assert.equal(r.carryover, 428381195);
  assert.deepEqual(r.tiers[0], { tier: 1, winners: 0, prize: 0 });
  assert.equal(r.tiers.length, 6);
  assert.deepEqual(r.bonus, [11, 25]);
});

t('BIG系 くじ結果', () => {
  const r = parseBigResult(fx('big-result.html').toString('utf8'));
  assert.deepEqual(Object.keys(r).sort(), ['big', 'big100', 'big1000', 'megabig', 'minibig']);
  assert.equal(r.big.round, 1658);
  assert.equal(r.big.sales, 686037300);
  assert.equal(r.big.carryoverOut, 5001651420);
  assert.deepEqual(r.big.tiers[0], { tier: 1, prize: 600000000, winners: 1 });
  assert.equal(r.big.tiers.length, 6);
  assert.equal(r.big.salesStart, '2026-09-29');
  assert.equal(r.big.salesEnd, '2026-10-03');
  assert.equal(r.big.resultDate, '2026-10-04');
  assert.equal(r.megabig.carryoverOut, 8583468330);
  assert.deepEqual(r.megabig.tiers[0], { tier: 1, prize: 0, winners: 0 });
  assert.equal(r.big100.carryoverOut, 1590640020);
  assert.equal(r.big100.tiers.length, 5);
  assert.equal(r.big1000.tiers.length, 4);
  assert.equal(r.minibig.sales, 109431600);
});

t('BIG系 くじ情報（販売中の回）', () => {
  const r = parseBigInfo(fx('big-info.html').toString('utf8'));
  assert.equal(r.big.round, 1662);
  assert.equal(r.big.salesStart, '2026-10-10');
  assert.equal(r.big.salesStartTime, '13:50');
  assert.equal(r.big.salesEnd, '2026-10-13');
  assert.equal(r.big.salesEndTime, '19:00');
  assert.equal(r.big.resultDate, '2026-10-15');
  assert.equal(r.big.salesSoFar, 58971900);
  assert.equal(r.big.carryoverIn, null);
  assert.equal(r.big.firstPool, null);
  assert.equal(r.big.asOf, '2026-10-10T19:12:00+09:00');
  assert.equal(r.megabig.carryoverIn, 8583468330);
  assert.equal(r.megabig.firstPool, 8600000000);
  assert.equal(r.minibig.carryoverIn, 0);
  assert.equal(r.minibig.salesEndTime, '19:00');
});

t('DUNK くじ結果', () => {
  const r = parseDunkResult(fx('dunk-result.html').toString('utf8'));
  assert.deepEqual(Object.keys(r).sort(), ['dunk10', 'dunk6a']);
  assert.equal(r.dunk10.round, 2);
  assert.equal(r.dunk10.sales, 65745900);
  assert.equal(r.dunk10.carryoverOut, 56746687);
  assert.equal(r.dunk10.tiers.length, 5);
  assert.equal(r.dunk10.salesEnd, '2026-10-03');
  assert.equal(r.dunk10.resultDate, '2026-10-04');
  assert.equal(r.dunk6a.sales, 24208600);
  assert.equal(r.dunk6a.carryoverOut, 0);
});

t('DUNK くじ情報', () => {
  const r = parseDunkInfo(fx('dunk-info.html').toString('utf8'));
  assert.equal(r.dunk10.round, 6);
  assert.equal(r.dunk10.salesStart, '2026-10-10');
  assert.equal(r.dunk10.salesStartTime, '13:55');
  assert.equal(r.dunk10.salesEnd, '2026-10-17');
  assert.equal(r.dunk10.salesEndTime, '12:55');
  assert.equal(r.dunk10.resultDate, '2026-10-18');
  assert.equal(r.dunk10.salesSoFar, 2920500);
  assert.equal(r.dunk10.carryoverIn, null);
  assert.equal(r.dunk10.firstPool, null);
  assert.equal(r.dunk6a.salesStart, '2026-10-14');
  assert.equal(r.dunk6a.salesEndTime, '12:55');
  assert.equal(r.dunk6b.salesEnd, '2026-10-18');
  assert.equal(r.dunk6b.salesEndTime, '13:50');
});

t('結果一覧の開催回', () => {
  assert.deepEqual(parseHoldCntIds(fx('list.html').toString('utf8')), ['1658', '1657', '1656']);
});

/* ---------- 還元率 ---------- */

const defs = resolveGames(JSON.parse(readFileSync(path.join(ROOT, 'data/games.json'), 'utf8')));

t('山分けの式（閉じた形）＝ポアソン分布で直接足したもの', () => {
  const direct = (pool, lam, cap) => {
    let s = 0;
    let p = Math.exp(-lam);
    for (let k = 0; k < 400; k++) { s += p * Math.min(cap, pool / (1 + k)); p *= lam / (k + 1); }
    return s;
  };
  for (const [pool, lam, cap] of [[2e8, 1.04, 6e8], [5.3e9, 0.48, 6e8], [7e8, 0.69, 1.2e9], [2.4e7, 13.4, Infinity], [1e9, 2.5, 3e8]]) {
    near(expectedShare(pool, lam, cap), direct(pool, lam, cap), 1, `pool=${pool} λ=${lam}`);
  }
});

t('固定・理論値のくじ', () => {
  near(evaluate(defs.numbers4).rate, 0.45, 1e-9, 'ナンバーズ4');
  near(evaluate(defs.numbers3).rate, 0.45, 1e-9, 'ナンバーズ3');
  near(evaluate(defs.bingo5).rate, 0.45, 1e-4, 'ビンゴ5');
  near(evaluate(defs.miniloto).rate, 0.4488, 1e-3, 'ミニロト');
  near(evaluate(defs.halloween2026).rate, 0.47330, 1e-4, 'ハロウィンジャンボ');
  near(evaluate(defs.nenmatsu2026).rate, 0.5, 1e-4, '年末ジャンボ');
});

t('BIG系（繰越が上限の何倍もある＝上限で頭打ち）', () => {
  // 1等の寄与 ≒ 上限×確率、2等以下は配分どおり（当せん者がほぼ必ず出る）
  const big = evaluate(defs.big, { salesEst: 686037300, carryover: 5001651420 });
  near(big.rate, (6e8 / 4782969 + 0.5 * 0.2 * 300) / 300, 0.002, 'BIG');
  const b100 = evaluate(defs.big100, { salesEst: 320790400, carryover: 1590640020 });
  near(b100.rate, (2e8 / 4782969 + 0.5 * 0.24 * 100) / 100, 0.002, '100円BIG');
  const mega = evaluate(defs.megabig, { salesEst: 575870400, carryover: 8583468330 });
  near(mega.rate, (1.2e9 / 16777216 + 0.5 * 0.30 * 300) / 300, 0.002, 'MEGA BIG');
  near(maxRate(defs.big, 686037300), big.rate, 0.001, 'BIG の天井');
});

t('ロト7（繰越なし）は山分けで理論値より下がる', () => {
  const r = evaluate(defs.loto7, { salesEst: 2116830000, carryover: 0 });
  assert.ok(r.rate < r.naiveRate);
  near(r.naiveRate, 0.377, 0.003, 'ロト7 山分けなし（1等の原資を1人で受け取る）');
  near(r.rate, 0.334, 0.003, 'ロト7');
});

/* ---------- 次の回の判定 ---------- */

// data/state.json は毎日変わるので、判定のテストには固定した見本（2026-10-10 時点）を使う
const state = JSON.parse(fx('state.json').toString('utf8'));
const at = (s) => { const [d, tm] = s.split('T'); const [hh, mm] = tm.split(':').map(Number); return { iso: d, hh, mm, wd: weekdayOf(d) }; };

t('数字選択式の次の抽せん日', () => {
  const now = at('2026-10-10T19:30');
  const l6 = computeGame(defs.loto6, state.games.loto6, now);
  assert.equal(l6.status.next, '2026-10-12');
  assert.equal(l6.status.round, 2145);
  assert.equal(computeGame(defs.loto7, state.games.loto7, now).status.next, '2026-10-16');
  assert.equal(computeGame(defs.numbers4, null, now).status.next, '2026-10-12');
  assert.equal(computeGame(defs.numbers4, null, at('2026-10-12T18:00')).status.next, '2026-10-12');
  assert.equal(computeGame(defs.numbers4, null, at('2026-10-12T18:30')).status.next, '2026-10-13');
  const closed = computeGame(defs.loto6, state.games.loto6, at('2026-10-12T19:00'));
  assert.equal(closed.status.kind, 'closed');
  const stale = computeGame(defs.loto6, state.games.loto6, at('2026-10-13T08:00'));
  assert.equal(stale.status.stale, true);
  assert.equal(stale.provisional, true);
});

t('BIG系の販売状況', () => {
  assert.equal(computeGame(defs.big, state.games.big, at('2026-10-11T10:00')).status.kind, 'onsale');
  assert.equal(computeGame(defs.big, state.games.big, at('2026-10-13T19:30')).status.kind, 'stale');
  const d6a = computeGame(defs.dunk6a, state.games.dunk6a, at('2026-10-15T09:00'));
  assert.equal(d6a.status.label, '第6回'); // 第5回が終わったら次の回（nextSale）に切り替わる
});

t('ジャンボの販売期間', () => {
  assert.equal(computeGame(defs.halloween2026, null, at('2026-10-16T12:00')).status.kind, 'onsale');
  assert.equal(computeGame(defs.halloween2026, null, at('2026-10-17T12:00')).status.kind, 'ended');
  assert.equal(computeGame(defs.nenmatsu2026, null, at('2026-10-17T12:00')).status.kind, 'upcoming');
  assert.equal(computeGame(defs.nenmatsu2026, null, at('2026-11-24T12:00')).status.kind, 'onsale');
});

/* ---------- リンク・ポイントの設定とページ ---------- */

const links = JSON.parse(readFileSync(path.join(ROOT, 'config/links.json'), 'utf8'));
const points = JSON.parse(readFileSync(path.join(ROOT, 'config/points.json'), 'utf8'));

t('リンク集の整合性（店・登録先・くじ）', () => {
  for (const [gid, list] of Object.entries(links.games)) {
    assert.ok(defs[gid], `games.json にない ${gid}`);
    for (const l of list) assert.ok(links.shops[l.shop], `${gid} の店 ${l.shop} が shops にない`);
  }
  for (const [sid, s] of Object.entries(links.shops)) {
    assert.match(s.url, /^https:\/\//, `${sid} の url`);
    if (s.signup) assert.ok(links.signups[s.signup], `${sid} の signup ${s.signup}`);
  }
  for (const rt of points.routes) {
    assert.ok(links.shops[rt.shop], `ポイントの ${rt.id} の店`);
    for (const k of rt.signups || []) assert.ok(links.signups[k], `ポイントの ${rt.id} の登録先 ${k}`);
    for (const p of rt.parts) assert.ok(p.rate === null || Number.isFinite(p.rate) || Number.isFinite(p.perUnit), `${rt.id} の率`);
  }
  for (const sid of points.noPoint) assert.ok(links.shops[sid], `noPoint の ${sid}`);
});

const { createRenderer, fmtPt } = await import('./lib/render.mjs');
const { computeAll } = await import('./lib/model.mjs');

t('ポイント還元率の表示', () => {
  assert.equal(fmtPt(0.02), '2.0%');
  assert.equal(fmtPt(0.01), '1.0%');
  assert.equal(fmtPt(0.005), '0.5%');
  assert.equal(fmtPt(1 / 300), '0.33%');
});

const pageNow = { ...at('2026-10-10T19:30'), y: 2026 };
const rowsT = computeAll(defs, state, pageNow, {});
const renderT = createRenderer({
  site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {} },
  links, points, rows: rowsT, byId: Object.fromEntries(rowsT.map((r) => [r.id, r])), log: [], history: { days: {} },
  catalog: { order: [], items: {} }, now: pageNow, state, defs, order: Object.fromEntries(Object.keys(defs).map((k, i) => [k, i])),
  preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x',
});

t('ポイント還元ランキング（2.0%が1位、銀行のロトは1口1ポイント）', () => {
  const html = renderT.point().html;
  assert.ok(html.includes('ポイント還元ランキング'));
  const first = html.indexOf('<tr class="first">');
  assert.ok(first > 0, '1位の行がある');
  assert.ok(/楽天toto|ドコモスポーツくじ|宝くじ公式サイト/.test(html.slice(first, first + 600)), '1位は2.0%の買い方');
  assert.ok(html.includes('0.5%'), '楽天銀行のロト・ナンバーズ（200円で1ポイント）');
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '');
  for (const bad of ['NaN', 'undefined', 'Infinity', '[object']) assert.ok(!text.includes(bad), `${bad} が出ている`);
});

t('グラフの期間（推移は30日・くじ別は1年）と名前の変更', () => {
  const suii = renderT.suii().html;
  assert.ok(suii.includes('くじごとの還元率推移'));
  assert.ok(!suii.includes('くじごとのグラフ'));
  for (const m of suii.matchAll(/data-span="(\d+)"/g)) assert.equal(m[1], '29');
  const l7 = renderT.game(rowsT.find((r) => r.id === 'loto7')).html;
  assert.ok(l7.includes('data-span="364"'), 'くじ別ページは1年');
  assert.ok(l7.includes('ロト7の購入場所'));
  const all = [renderT.index(), renderT.kaikata(), renderT.point(), l7].map((p) => (p.html ?? p)).join('');
  assert.ok(!all.includes('ネットでの購入場所'), '「ネットでの購入場所」は残さない');
  assert.ok(!all.includes('買える所'), '「買える所」は残さない');
});

t('404ページ（存在しない深い階層のURLでも、CSSとリンクがずれない）', () => {
  // GitHub Pages は /kuji/abc/def.html のような存在しないURLでも 404.html の中身を返すので、相対パスを使わない
  const base = 'https://yngambling.github.io/takarakuji-payout-rate';
  const page404 = (preview) => createRenderer({
    site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: `${base}/`, adsense: {} },
    links, points, rows: rowsT, byId: Object.fromEntries(rowsT.map((r) => [r.id, r])), log: [], history: { days: {} },
    catalog: { order: [], items: {} }, now: pageNow, state, defs, order: Object.fromEntries(Object.keys(defs).map((k, i) => [k, i])),
    preview, placeholders: false, inlineCss: preview, css: '', cssVersion: 'x',
  }).notFound().html;
  const html = page404(false);
  const urls = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(urls.length > 20, 'メニューやサイドバーのリンクがある');
  for (const u of urls) assert.match(u, /^(?:https?:\/\/|#|mailto:)/, `相対パスのリンクが残っている: ${u}`);
  assert.ok(html.includes(`<a href="${base}/">トップページ</a>`), '「トップページ」はこのサイトの一番上へ（github.io の一番上ではない）');
  assert.ok(html.includes(`<link rel="stylesheet" href="${base}/style.css?v=x">`), 'CSS');
  assert.ok(html.includes(`<a class="logo" href="${base}/">`), 'ロゴ');
  assert.ok(html.includes(`<a href="${base}/point.html">ポイント還元</a>`), 'メニュー');
  assert.ok(html.includes(`href="${base}/kuji/`), 'くじ別ページへのリンク');
  assert.ok(!html.includes('href="/"'), 'github.io の一番上へのリンクがない');
  assert.ok(html.includes('<meta name="robots" content="noindex">'), '検索結果に出さない');
  assert.ok(page404(true).includes('<a href="index.html">トップページ</a>'), '共有プレビューは相対パスのまま');
});

/* ---------- 公式ページの見張り・お知らせ ---------- */

const { extractLines, diffLines, scheduleChecks, changeIssue, specialChecks } = await import('./lib/watchlib.mjs');

t('見張る行の取り出し（日付・残り日数は無視）', () => {
  const html = '<div><p>購入額の1%のポイントが貯まります（2026年10月10日更新）</p><p>楽天カードで払うとさらに1%</p><p>関係ない文章</p><p>ポイントの使い方</p><p>あと3日で終了：ポイント2倍</p></div>';
  const page = { kind: 'point', keywords: ['ポイント', '%'], digit: true };
  assert.deepEqual(extractLines(html, page), ['購入額の1%のポイントが貯まります(更新)', '楽天カードで払うとさらに1%', 'で終了:ポイント2倍']);
  const d = diffLines(['a', 'b'], ['b', 'c']);
  assert.deepEqual(d, { removed: ['a'], added: ['c'] });
  const issue = changeIssue({ id: 'x', kind: 'point', name: 'テスト', url: 'https://example.com', file: 'config/points.json', what: '率' }, ['1%'], ['2%'], '2026-10-11');
  assert.equal(issue.key, 'watch-x-2026-10-11');
  assert.ok(issue.body.includes('- 1%') && issue.body.includes('- 2%'));
});

t('日付から分かるお願い（次のジャンボ・賞金表の確認・ポイントの見直し）', () => {
  const pts = { checkedOn: '2026-10-10' };
  const kinds = (day) => Object.fromEntries(scheduleChecks(defs, pts, day).map((c) => [c.key, c.type]));
  let k = kinds('2026-10-11');
  assert.equal(k['jumbo-next'], 'clear', '年末ジャンボが発売前なので不要');
  assert.equal(k['verify-nenmatsu2026'], 'clear', '発売の30日より前');
  assert.equal(k['points-recheck'], 'clear');
  k = kinds('2026-10-30');
  assert.equal(k['verify-nenmatsu2026'], 'raise', '発売30日前から確認をお願いする');
  k = kinds('2026-12-01');
  assert.equal(k['jumbo-next'], 'raise', '年末ジャンボのあとが未登録');
  k = kinds('2027-01-20');
  assert.equal(k['points-recheck'], 'raise', '確認から90日');
});

/* ---------- Google Search Console の確認タグ ---------- */

const { verificationCode } = await import('./lib/util.mjs');

t('Search Console の確認タグ（貼ったタグから取り出して全ページの head に入れる）', () => {
  const code = 'Ab3dEf_gH1jK-lMn0pQrStUvWxYz0123456789abcd';
  const file = readFileSync(path.join(ROOT, 'config/google-site-verification.txt'), 'utf8');
  assert.equal(verificationCode(file), '', 'まだ貼っていないときは空');
  assert.equal(verificationCode(`${file}<meta name="google-site-verification" content="${code}" />\n`), code, 'タグをそのまま貼った');
  assert.equal(verificationCode(`${file}  ${code}  \n`), code, 'コードだけを貼った');
  assert.equal(verificationCode(`<meta name='google-site-verification' content='${code}'>`), code, '一重引用符');
  assert.equal(verificationCode('<meta name="google-site-verification" content="abc"><script>'), '', '短すぎる・おかしな文字は使わない');
  assert.equal(verificationCode(`${code}"><script>alert(1)</script>`), '', 'タグ以外の文字が混ざったら使わない');
  const page = (verification) => createRenderer({
    site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {} },
    links, points, rows: rowsT, byId: Object.fromEntries(rowsT.map((r) => [r.id, r])), log: [], history: { days: {} },
    catalog: { order: [], items: {} }, now: pageNow, state, defs, order: Object.fromEntries(Object.keys(defs).map((k, i) => [k, i])),
    preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x', verification,
  });
  const html = page(code).index().html;
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes(`<meta name="google-site-verification" content="${code}">`), 'トップページの head に入る');
  assert.ok(page(code).about().html.includes('google-site-verification'), 'ほかのページにも入る');
  assert.ok(!page('').index().html.includes('google-site-verification'), 'コードがなければ入れない');
});

/* ---------- BIG777（毎月7日を含む週の回は、1等の上限が7億7万7千円） ---------- */

const { weekWith7, specialOf, withSpecialCap } = await import('./lib/special.mjs');

// 2026年の実際の販売期間と1等の当せん金（6億円ちょうど＝通常の回、7億7万7千円＝BIG777 の回）
const res = (round, salesStart, salesEnd, prize = 0, winners = 0) => ({
  round, salesStart, salesEnd, resultDate: salesEnd, sales: 686037300, units: null, carryoverOut: 4607319900,
  tiers: [{ tier: 1, prize, winners }, { tier: 2, prize: 1, winners: 1 }, { tier: 3, prize: 1, winners: 1 }],
});
const bigState = {
  results: [
    res(1633, '2026-05-30', '2026-06-06', 600000000, 1),
    res(1634, '2026-06-06', '2026-06-12'),
    res(1636, '2026-06-12', '2026-06-20'),
    res(1638, '2026-07-02', '2026-07-07'),
    res(1639, '2026-07-07', '2026-07-14'),
    res(1643, '2026-07-28', '2026-08-01', 600000000, 1),
    res(1644, '2026-08-01', '2026-08-08'),
    res(1645, '2026-08-08', '2026-08-15'),
    res(1650, '2026-09-02', '2026-09-05', 600000000, 1),
    res(1652, '2026-09-05', '2026-09-09'),
    res(1653, '2026-09-09', '2026-09-12'),
    res(1654, '2026-09-12', '2026-09-19'),
    res(1658, '2026-09-29', '2026-10-03', 600000000, 1),
    res(1660, '2026-10-03', '2026-10-10', 700077000, 1),
  ].reverse(),
  onSale: { round: 1662, salesStart: '2026-10-10', salesEnd: '2026-10-13' },
};

t('BIG777 の週（毎月7日を含む週・日曜〜土曜）', () => {
  assert.deepEqual(weekWith7('2026-10-10'), { from: '2026-10-04', to: '2026-10-10', month: '2026-10' });
  assert.deepEqual(weekWith7('2026-06-06'), { from: '2026-06-07', to: '2026-06-13', month: '2026-06' }); // 6/7 は日曜
  assert.deepEqual(weekWith7('2026-11-03'), { from: '2026-11-01', to: '2026-11-07', month: '2026-11' }); // 11/7 は土曜
  assert.deepEqual(weekWith7('2026-12-20'), { from: '2026-12-06', to: '2026-12-12', month: '2026-12' });
});

t('BIG777 の回の判定（これまでの1等の当せん金と合う）', () => {
  const on = (round, st = bigState, manual) => specialOf(defs.big, round, st, manual)?.on;
  const want = { 1633: false, 1634: true, 1636: false, 1638: true, 1639: false, 1643: false, 1644: true, 1645: false, 1650: false, 1652: false, 1653: true, 1654: false, 1658: false, 1660: true, 1662: false };
  for (const [round, w] of Object.entries(want)) assert.equal(on(+round), w, `第${round}回`);
  assert.equal(specialOf(defs.big, 1660, bigState).why, 'payout');
  // 当せん金を見なくても（日付の決まりだけで）、当せん金が分かっている回と合う
  const noPay = { ...bigState, results: bigState.results.map((r) => ({ ...r, tiers: [{ tier: 1, prize: 0, winners: 0 }] })) };
  for (const round of [1633, 1643, 1650, 1658, 1660]) assert.equal(specialOf(defs.big, round, noPay).on, want[round], `日付の決まり 第${round}回`);
  // 11月：火曜締切の第1669回は、同じ週にあとから締め切る回があるか分かるまで「未確定」（通常の回として計算）
  const nov = { results: [], onSale: { round: 1669, salesStart: '2026-10-31', salesEnd: '2026-11-03' } };
  assert.deepEqual([specialOf(defs.big, 1669, nov).on, specialOf(defs.big, 1669, nov).sure], [false, false]);
  const nov2 = { ...nov, nextSale: { round: 1670, salesStart: '2026-11-03', salesEnd: '2026-11-07' } };
  assert.deepEqual([specialOf(defs.big, 1669, nov2).on, specialOf(defs.big, 1669, nov2).sure], [false, true]);
  assert.equal(specialOf(defs.big, 1670, nov2).on, true, '土曜締切の第1670回');
  // data/overrides.json の big777 で直せる
  assert.equal(on(1669, nov, { add: [1669] }), true);
  assert.equal(on(1660, bigState, { remove: [1660] }), false);
  // BIG 以外のくじには関係しない
  assert.equal(specialOf(defs.megabig, 1660, bigState), null);
  assert.equal(specialOf(defs.big100, 1660, bigState), null);
});

t('BIG777 の回は1等の上限7億7万7千円で計算する（繰越約46億円なら51.8%→58.8%）', () => {
  const sp = { on: true, cap: 700077000 };
  const b777 = evaluate(withSpecialCap(defs.big, sp), { salesEst: 686037300, carryover: 4607319900 });
  near(b777.rate, (700077000 / 4782969 + 0.5 * 0.2 * 300) / 300, 0.002, 'BIG777');
  near(b777.rate, 0.588, 0.001, 'BIG777');
  near(evaluate(defs.big, { salesEst: 686037300, carryover: 4607319900 }).rate, 0.518, 0.001, '通常の回');
  const top = withSpecialCap(defs.big, sp).tiers.find((x) => x.top);
  assert.deepEqual([top.capNormal, top.capCO], [700077000, 700077000], 'キャリーオーバーがなくても7億7万7千円');
  assert.equal(withSpecialCap(defs.big, { on: false, cap: 700077000 }), defs.big);
  assert.equal(defs.big.tiers.find((x) => x.top).capCO, 600000000, '元の定義は書き換えない');
});

t('BIG777 の回のページ（バッジ・お知らせ・上限・計算方法）', () => {
  const now777 = { ...at('2026-11-05T12:00'), y: 2026 };
  const st777 = { ...state, games: { ...state.games, big: { ...state.games.big, onSale: { round: 1670, salesStart: '2026-11-03', salesStartTime: '13:50', salesEnd: '2026-11-07', salesEndTime: '19:00', resultDate: '2026-11-08' } } } };
  const rows777 = computeAll(defs, st777, now777, {});
  const big = rows777.find((r) => r.id === 'big');
  const normal = rowsT.find((r) => r.id === 'big');
  assert.equal(big.special.on, true);
  assert.equal(big.capCO, 700077000);
  assert.ok(big.rate > normal.rate + 0.06, `BIG777 ${big.rate} / 通常 ${normal.rate}`);
  assert.equal(computeAll(defs, st777, now777, { big777: { remove: [1670] } }).find((r) => r.id === 'big').special.on, false, '手で外せる');
  const rd = createRenderer({
    site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {} },
    links, points, rows: rows777, byId: Object.fromEntries(rows777.map((r) => [r.id, r])), log: [], history: { days: {} },
    catalog: { order: ['big'], items: {} }, now: now777, state: st777, defs, order: Object.fromEntries(Object.keys(defs).map((k, i) => [k, i])),
    preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x',
  });
  const html = rd.game(big).html;
  assert.ok(html.includes('第1670回は「BIG777」の回です'), 'お知らせ');
  assert.ok(html.includes('7億7万7千円（第1670回はBIG777の回のため'), '1等の上限');
  const top = rd.index().html;
  assert.ok(top.includes('<span class="badge gold"'), 'ランキングにもバッジ');
  assert.ok(top.includes('BIG777<b>1等最高7億7万7千円</b>'), '1位になったら結論の欄にも出す');
  const k = rd.keisan().html;
  assert.ok(k.includes('「BIG777」') && k.includes('約48.8%') && k.includes('約41.8%'), '計算方法');
  assert.ok(rd.ichiran().html.includes('BIG777の回（毎月7日を含む週）は、キャリーオーバーの有無にかかわらず7億7万7千円'), '宝くじ一覧');
  for (const page of [html, k]) {
    const text = page.replace(/<script[\s\S]*?<\/script>/g, '');
    for (const bad of ['NaN', 'undefined', 'Infinity', '[object']) assert.ok(!text.includes(bad), `${bad} が出ている`);
  }
  assert.ok(!renderT.game(normal).html.includes('「BIG777」の回です'), '通常の回には出さない');
});

t('BIG777 のお知らせ（月に1回・週が終わって1週間で閉じる・当せん金と合わないとき）', () => {
  const memo = {};
  const raised = (items) => items.filter((c) => c.type === 'raise');
  const run = (st, today, ov = {}) => specialChecks(defs, { games: { big: st } }, ov, today, memo);
  // 見張りを始めた日より前に終わった週（10月）は、お知らせしない
  assert.deepEqual(raised(run(bigState, '2026-10-12')), []);
  // 11月：火曜締切の第1669回（未確定）が販売中のうちは、まだお知らせしない
  const nov = { results: bigState.results, onSale: { round: 1669, salesStart: '2026-10-31', salesEnd: '2026-11-03' } };
  assert.deepEqual(raised(run(nov, '2026-11-02')), []);
  // 土曜締切の第1670回の販売が始まったら、1回だけお知らせ
  const nov2 = { results: [res(1669, '2026-10-31', '2026-11-03'), ...bigState.results], onSale: { round: 1670, salesStart: '2026-11-03', salesEnd: '2026-11-07' } };
  const r1 = raised(run(nov2, '2026-11-04'));
  assert.equal(r1.length, 1);
  assert.equal(r1[0].key, 'special-big-2026-11');
  assert.ok(r1[0].title.includes('第1670回') && r1[0].body.includes('data/overrides.json'));
  assert.deepEqual(raised(run(nov2, '2026-11-05')), [], '2回目は出さない');
  // 週（11/1〜11/7）が終わって1週間たつと、自動で閉じる
  assert.ok(run(nov2, '2026-11-15').some((c) => c.type === 'clear' && c.key === 'special-big-2026-11'));
  // 実際の当せん金が日付の決まりと合わない回は、1回だけお知らせ
  const odd = { results: [res(1671, '2026-11-07', '2026-11-14', 700077000, 1), ...nov2.results], onSale: { round: 1672, salesStart: '2026-11-14', salesEnd: '2026-11-17' } };
  const r2 = raised(run(odd, '2026-11-16'));
  assert.deepEqual(r2.map((c) => c.key), ['special-big-mismatch-1671']);
  assert.ok(r2[0].body.includes('7億7万7,000円'));
  assert.deepEqual(raised(run(odd, '2026-11-17')), [], '1回だけ');
  assert.deepEqual(raised(run({ ...odd, results: odd.results.slice(1) }, '2026-11-18', { big777: { add: [1673] } })), []);
  // 週が終わっても BIG777 の回が分からなかったら、確認をお願いする（12月：データなし）
  assert.deepEqual(raised(run({ results: [] }, '2026-12-14')).map((c) => c.key), ['special-big-2026-12-unknown']);
  assert.ok(memo.big.notified.includes('2026-12') && memo.big.mismatch.includes(1671), '記録を残す');
});

console.log(`\n${n}件すべて成功`);
