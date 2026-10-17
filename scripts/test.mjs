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
const ta = async (name, fn) => { await fn(); n++; console.log(`ok  ${name}`); }; // 通信をまねる確認（await で呼ぶ）

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
// ジャンボの日付・賞金表・verify は、運営者が Issue の案内で直したり足したりする（verify の行を消す・次のジャンボを足す）。
// 本物の data/games.json で確かめると、その操作でテストが失敗して自動更新が止まるので、2026年10月11日の時点の写しを使う
const jumbo = resolveGames(JSON.parse(fx('jumbo.json').toString('utf8')));

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
  near(evaluate(jumbo.halloween2026).rate, 0.47330, 1e-4, 'ハロウィンジャンボ');
  near(evaluate(jumbo.nenmatsu2026).rate, 0.5, 1e-4, '年末ジャンボ');
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
  assert.equal(computeGame(jumbo.halloween2026, null, at('2026-10-16T12:00')).status.kind, 'onsale');
  assert.equal(computeGame(jumbo.halloween2026, null, at('2026-10-17T12:00')).status.kind, 'ended');
  assert.equal(computeGame(jumbo.nenmatsu2026, null, at('2026-10-17T12:00')).status.kind, 'upcoming');
  assert.equal(computeGame(jumbo.nenmatsu2026, null, at('2026-11-24T12:00')).status.kind, 'onsale');
});

/* ---------- リンク・ポイントの設定とページ ---------- */

const links = JSON.parse(readFileSync(path.join(ROOT, 'config/links.json'), 'utf8'));
const points = JSON.parse(readFileSync(path.join(ROOT, 'config/points.json'), 'utf8'));

t('リンク集の整合性（店・登録先・くじ）', () => {
  for (const [gid, list] of Object.entries(links.games)) {
    // 終わったくじを data/games.json から消しても自動更新が止まらないよう、ないくじのリンクは止めずに知らせるだけにする
    if (!defs[gid]) console.log(`  ※ config/links.json の games の ${gid} は data/games.json にないため使われません（消してかまいません）`);
    for (const l of list) assert.ok(links.shops[l.shop], `${gid} の店 ${l.shop} が shops にない`);
  }
  for (const l of links.jumboDefault || []) assert.ok(links.shops[l.shop], `jumboDefault の店 ${l.shop} が shops にない`);
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

t('くじ別ページの解説とよくある質問（data/guides.json）', () => {
  const guides = JSON.parse(readFileSync(path.join(ROOT, 'data/guides.json'), 'utf8'));
  // 書き方の確認：あるくじだけ・確認日・段落と質問が空でない・出典は https・使わない言い回しがない
  for (const [id, g] of Object.entries(guides.games || {})) {
    // 終わったジャンボを data/games.json から消したときに自動更新が止まらないよう、ないくじの解説は止めずに知らせるだけにする
    if (!defs[id]) { console.log(`  ※ data/guides.json の ${id} は data/games.json にないため使われません（消してかまいません）`); continue; }
    assert.match(g.checkedOn || '', /^\d{4}-\d{2}-\d{2}$/, `${id} の checkedOn（確認日）`);
    assert.ok((g.about || []).length >= 1, `${id} の about（解説）`);
    for (const a of g.about) {
      const item = typeof a === 'string' ? { text: a } : a;
      assert.ok(typeof item.text === 'string' && item.text.replace(/\*\*/g, '').length >= 20, `${id} の about の text（20字以上）`);
      assert.ok(!item.type || ['rules', 'rate', 'odds', 'buy'].includes(item.type), `${id} の about の type は rules・rate・odds・buy のどれか（${item.type}）`);
      assert.ok(!item.key || item.key.length <= 20, `${id} の about の key（要点）は20字まで：${item.key}`);
      assert.equal((item.text.match(/\*\*/g) || []).length % 2, 0, `${id} の about の ** が閉じていません`);
    }
    for (const f of g.faq || []) assert.ok(/？$/.test(f.q || '') && (f.a || '').length >= 20, `${id} の faq（質問は「？」で終わる・答えは20字以上）`);
    assert.ok((g.sources || []).length >= 1 && g.sources.every((s) => s.title && /^https:\/\//.test(s.url)), `${id} の sources（出典）`);
    const text = JSON.stringify(g);
    for (const bad of ['必ず当たる', '絶対に当たる', '一番儲かる', '儲かる', '毎日自動更新']) assert.ok(!text.includes(bad), `${id} に「${bad}」が入っています`);
  }
  // ページに出る：目次・見出し・段落・確認日・よくある質問・構造化データ・出典（重複なし）
  const ctxG = {
    site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {} },
    links, points, rows: rowsT, byId: Object.fromEntries(rowsT.map((r) => [r.id, r])), log: [], history: { days: {} },
    catalog: { order: [], items: {} }, now: pageNow, state, defs, order: Object.fromEntries(Object.keys(defs).map((k, i) => [k, i])),
    preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x',
  };
  const sample = {
    checkedOn: '2026-10-12',
    about: [
      { type: 'rules', key: '毎週水曜・1口200円', text: 'ビンゴ5は、**ビンゴのようにラインをそろえる**数字選択式の宝くじです。' },
      '見出しのない段落も書けます（<b>のような記号は文字のまま出ます）。',
    ],
    faq: [{ q: 'ビンゴ5の還元率は回によって変わりますか？', a: 'ほとんど変わりません。キャリーオーバーがないためです。' }],
    sources: [{ title: '見本', url: 'https://example.org/bingo5' }, { title: 'みずほ銀行「ビンゴ5」', url: defs.bingo5.sources[0].url }],
  };
  const b5 = rowsT.find((r) => r.id === 'bingo5');
  const html = createRenderer({ ...ctxG, guides: { games: { bingo5: sample } } }).game(b5).html;
  assert.ok(html.includes('<a href="#about">ビンゴ5の特徴と還元率</a>') && html.includes('<a href="#faq">ビンゴ5のよくある質問</a>'), '目次');
  assert.ok(html.includes('<h2 id="about">ビンゴ5の特徴と還元率</h2>\n<div class="guide">'), '解説のカード');
  assert.ok(html.includes('<section class="gd-card gd-rules"><div class="gd-head"><span class="gd-ic" aria-hidden="true"><svg'), '色とアイコン');
  assert.ok(html.includes('<h3>遊び方</h3><span class="gd-key">毎週水曜・1口200円</span></div><p>ビンゴ5は、<strong class="marker">ビンゴのようにラインをそろえる</strong>数字選択式の宝くじです。</p></section>'), '見出し・要点・マーカー');
  assert.ok(html.includes('<section class="gd-card"><p>見出しのない段落も書けます（&lt;b&gt;のような記号は文字のまま出ます）。</p></section>'), '見出しのない段落・HTML は無効');
  assert.ok(html.indexOf('id="about"') < html.indexOf('id="buy"'), '解説は購入場所の前');
  assert.ok(html.includes('2026年10月12日（月）に公式の発表で確認'), '確認日');
  assert.ok(html.includes('<dt>ビンゴ5の還元率は回によって変わりますか？</dt>'), 'よくある質問');
  assert.ok(html.includes('"@type":"FAQPage"'), 'よくある質問の構造化データ');
  assert.equal(html.split(defs.bingo5.sources[0].url).length - 1, 1, '同じ出典は1回だけ');
  assert.ok(html.includes('https://example.org/bingo5'), '解説の出典も載せる');
  // 解説を書いていないくじのページは、今までどおり
  const plain = createRenderer(ctxG).game(b5).html;
  assert.ok(!plain.includes('id="about"') && !plain.includes('id="faq"') && !plain.includes('FAQPage'), '解説なし');
  // 本物の data/guides.json でも、書いてあるくじのページが作れる
  const rg = createRenderer({ ...ctxG, guides });
  for (const id of Object.keys(guides.games || {})) {
    const r = rowsT.find((x) => x.id === id);
    if (!r || r.def.model === 'none') continue;
    const h = rg.game(r).html;
    assert.ok(h.includes(`<h2 id="about">`) && h.includes('<div class="guide">') && !h.includes('**') && !/NaN|undefined/.test(h.replace(/<script[\s\S]*?<\/script>/g, '')), `${id} のページ`);
  }
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

/* ---------- 表示の速さと使いやすさ ---------- */

const RD = await import('./lib/render.mjs');
/** ロゴのフォント（static/fonts/dela-gothic-one-logo.woff2）に入れた文字。ロゴの文字を変えたら、README の「フォント」の手順で作り直す */
const LOGO_FONT_TEXT = '宝くじ還元率ランキング';
/** 色の濃さの差（コントラスト比。WCAG の計算） */
const contrast = (a, b) => {
  const lum = (h) => { const [r, g, bb] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

t('表示の速さと使いやすさ（フォントはこのサイトから・表示の途中でずれない・読み上げ・文字の色の濃さ）', () => {
  const css = readFileSync(path.join(ROOT, 'static/style.css'), 'utf8');
  const buildSrc = readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8');
  // フォント：Google Fonts を使わず、このサイトから配信する（先に読み込む・ライセンスもいっしょに置く）
  assert.deepEqual(RD.FONT_FILES, ['oswald-700.woff2', 'dela-gothic-one-logo.woff2']);
  for (const f of [...RD.FONT_FILES, 'OFL-Oswald.txt', 'OFL-DelaGothicOne.txt']) {
    assert.ok(buildSrc.includes(`'${f}'`), `build.mjs が ${f} を公開するフォルダに置く`);
    const buf = readFileSync(path.join(ROOT, 'static/fonts', f));
    if (f.endsWith('.woff2')) {
      assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', `${f} は WOFF2`);
      assert.ok(buf.length < 20000, `${f} は使う文字だけに絞った小さなファイル（${buf.length}バイト）`);
      assert.ok(new RegExp(`@font-face \\{[^}]*url\\("fonts/${f.replace('.', '\\.')}"\\)[^}]*font-display: swap;`).test(css), `style.css の @font-face（${f}）`);
    } else assert.ok(buf.toString('utf8').includes('SIL OPEN FONT LICENSE Version 1.1'), `${f} はフォントのライセンス`);
  }
  const top = renderT.index().html;
  const l6 = renderT.game(rowsT.find((r) => r.id === 'loto6')).html;
  for (const h of [top, l6, renderT.privacy().html]) assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com|Google Fonts/.test(h), 'Google Fonts を使わない（プライバシーポリシーの表からも外す）');
  assert.ok(top.includes('<link rel="preload" href="fonts/oswald-700.woff2" as="font" type="font/woff2" crossorigin>') && l6.includes('<link rel="preload" href="../fonts/dela-gothic-one-logo.woff2" as="font" type="font/woff2" crossorigin>'), 'フォントを先に読み込む（くじ別ページは ../ から）');
  const logo = (top.match(/<a class="logo"[^>]*>([\s\S]*?)<\/a>/) || [])[1].replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '');
  for (const ch of logo) assert.ok(LOGO_FONT_TEXT.includes(ch), `ロゴの文字「${ch}」がロゴのフォントにありません（README の「フォント」の手順で作り直す）`);
  // 共有プレビュー（CSS をページに埋め込む）は、フォントの場所をページの階層に合わせる
  const pv = createRenderer({ site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {} }, links, points, rows: rowsT, byId: Object.fromEntries(rowsT.map((r) => [r.id, r])), log: [], history: { days: {} }, catalog: { order: [], items: {} }, now: pageNow, state, defs, order: Object.fromEntries(Object.keys(defs).map((k, i) => [k, i])), preview: true, placeholders: true, inlineCss: true, css, cssVersion: 'x' });
  assert.ok(pv.game(rowsT.find((r) => r.id === 'loto6')).html.includes('url("../fonts/oswald-700.woff2")'));
  // 表示の途中でずれない：残り時間は書き込む前から幅を取る・数字のカウントアップは幅を固定・速報の帯は帯のすぐ後ろで決める・広告の枠は先に高さを取る
  assert.ok(css.includes('.cd-r:empty::before { content: "あと00時間00分"; visibility: hidden; }') && !css.includes('.cd-r:empty { display: none; }'), '残り時間');
  assert.ok(top.includes("st.width = rs[0].width + 'px'"), 'カウントアップ');
  assert.ok(/<div class="ticker">[\s\S]*?<\/ul><\/div><\/div><\/div><script>\n\(function\(\)\{\n  var s = document\.currentScript/.test(top) && !/var tk = d\.querySelector\('\.ticker'\)/.test(top), '速報の帯');
  assert.ok(/\.ad ins\.adsbygoogle \{ min-height: \d+px; \}/.test(css) && css.includes('.ad:has(> ins.adsbygoogle[data-ad-status="unfilled"]) { display: none; }'), '広告の枠');
  // 読み上げ・キーボード：ページの見出し部分（header）に帯と速報を入れる・順位の印に aria-label を付けない・シェアボタンはまとまり・横にスクロールする表に入れる・空の見出しのセルを作らない
  assert.ok(/<header>\n<div class="topbar" id="top">[\s\S]*?<div class="site-header"><div class="wrap">[\s\S]*?<nav class="gnav"[\s\S]*?<\/script>\n<\/header>\n<div class="wrap layout">/.test(top) && !top.includes('<header class="site-header">'), 'ページの見出し部分');
  assert.ok(!/<span class="rk[^"]*" aria-label/.test(top) && top.includes('<span class="rk rk1"><svg class="crown"'), '順位の印');
  assert.ok(top.includes('<div class="share" role="group" aria-label="この記事をシェア">'), 'シェアボタン');
  assert.ok(top.includes("all('.tbl-wrap').forEach(function(el){ if (el.scrollWidth > el.clientWidth + 1 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0'); });"), '横にスクロールする表');
  const hw = renderT.game(rowsT.find((r) => r.id === 'halloween2026')).html;
  assert.ok(hw.includes('<thead><tr><th><span class="vh">項目</span></th>') && !hw.includes('<th></th>'), 'ミニとの比較の表');
  // 文字の色の濃さ：白い文字とボタンの色、金色の数字、シェアボタン（WCAG の AA：4.5:1 以上）
  const v = (name) => (css.match(new RegExp(`--${name}: (#[0-9a-f]{6});`)) || [])[1];
  const bg = (cls) => (css.match(new RegExp(`\\.share \\.${cls} \\{ background: (#[0-9a-f]{6}); \\}`)) || [])[1];
  const color = (sel) => (css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')} \\{[^}]*?color: (#[0-9a-f]{6})`)) || [])[1];
  for (const [label, fg, b] of [['購入ボタン', '#ffffff', v('green')], ['LINE', '#ffffff', bg('sl')], ['Facebook', '#ffffff', bg('sf')], ['はてブ', '#ffffff', bg('sh')],
    ['ポイントの数字', color('.ptv'), '#ffffff'], ['ポイントのチップ', color('.chip-pt b'), v('gold-soft')], ['ポイントの内訳', color('.parts b'), '#ffffff'], ['薄い文字', v('mute'), '#ffffff']]) {
    assert.ok(fg && b && contrast(fg, b) >= 4.5, `${label}の色の濃さが足りません（${fg} と ${b}：${fg && b ? contrast(fg, b).toFixed(2) : '?'}）`);
  }
});

/* ---------- 公式ページの見張り・お知らせ ---------- */

const { extractLines, hashLines, diffLines, scheduleChecks, changeIssue, specialChecks, watchGate } = await import('./lib/watchlib.mjs');

t('公式ページの見張りは1日1回（朝6時以降の最初の更新）', () => {
  const today = '2026-10-12';
  assert.equal(watchGate({ today, hh: 7, lastRun: '2026-10-11' }).run, true, '今日まだなら行う');
  assert.equal(watchGate({ today, hh: 6, lastRun: undefined }).run, true, '記録がなければ行う');
  assert.equal(watchGate({ today, hh: 12, lastRun: today }).run, false, '今日はもう済んだ（外部のタイマーと GitHub の予約が両方動いても1回）');
  assert.equal(watchGate({ today, hh: 4, lastRun: '2026-10-11' }).run, false, '朝6時より前（前の晩の遅れた更新）は行わない');
  assert.equal(watchGate({ today, hh: 23, lastRun: today, force: true }).run, true, '手動で選んだときは何回でも行う');
  assert.match(watchGate({ today, hh: 12, lastRun: today }).reason, /済んでいます/);
  // ワークフロー：見張りは push 以外の毎回呼び、1日1回かどうかは watch.mjs が決める。最新の main から始める
  const wf = readFileSync(path.join(ROOT, '.github/workflows/update.yml'), 'utf8');
  assert.ok(wf.includes("if: github.event_name != 'push'\n        run: node scripts/watch.mjs"), '見張りの手順の条件');
  assert.ok(wf.includes('WATCH_FORCE: ${{ inputs.watch }}'), '手動の「見張りも今すぐ行う」');
  assert.ok(/uses: actions\/checkout@v\d+\n\s+with:\n\s+ref: main/.test(wf), 'checkout は最新の main');
  const crons = [...wf.matchAll(/cron: '(\d+) (\d+) \* \* \*'/g)].map((m) => `${(+m[2] + 9) % 24}:${m[1].padStart(2, '0')}`);
  assert.deepEqual(crons, ['7:47', '12:47', '19:47', '21:47', '23:47'], '予備の予約は外部のタイマーと同じ時刻（日本時間）');
});

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
  const kinds = (day) => Object.fromEntries(scheduleChecks(jumbo, pts, day).map((c) => [c.key, c.type]));
  let k = kinds('2026-10-11');
  assert.equal(k['jumbo-next'], 'clear', '年末ジャンボが発売前なので不要');
  assert.equal(k['verify-nenmatsu2026'], 'clear', '発売の30日より前');
  assert.equal(k['points-recheck'], 'clear');
  k = kinds('2026-10-30');
  assert.equal(k['verify-nenmatsu2026'], 'raise', '発売30日前から確認をお願いする');
  k = kinds('2026-12-01');
  assert.equal(k['jumbo-next'], 'clear', '年末ジャンボの発売中は不要（次のジャンボはふつう公式発表から自動で登録される）');
  k = kinds('2027-01-20');
  assert.equal(k['points-recheck'], 'raise', '確認から90日');
  assert.equal(k['jumbo-next'], 'clear', '年末ジャンボが売り終わって26日（ふだんの間）');
  assert.equal(kinds('2027-02-23')['jumbo-next'], 'clear', 'ちょうど60日');
  assert.equal(kinds('2027-02-24')['jumbo-next'], 'raise', '売り終わって60日を過ぎても次が登録されない');
  // 公式発表から自動で登録した項目（autoFrom）の確認は、自動登録の Issue でお願いするので、こちらでは知らせない
  const auto = { ...jumbo, nenmatsu2026: { ...jumbo.nenmatsu2026, autoFrom: { hash: 'x' } } };
  assert.equal(Object.fromEntries(scheduleChecks(auto, pts, '2026-10-30').map((c) => [c.key, c.type]))['verify-nenmatsu2026'], 'clear');
});

/* ---------- 検索エンジンへの通知（IndexNow） ---------- */

const ix = await import('./lib/indexnow.mjs');

t('IndexNow（内容が変わったページだけを1日1回知らせる）', () => {
  const page = (main, time = '07:47', side = 'TOP5') => `<title>T</title><main id="main"><p class="updated"><span>最終更新：2026年10月12日（月） ${time}</span></p>${main}<p>出典（10/12 ${time}取得）</p></main><aside>${side}</aside>`;
  assert.equal(ix.contentHash(page('A')), ix.contentHash(page('A', '12:47', 'TOP5が変わった')), '更新時刻やサイドバーだけの違いは、内容が変わったとみなさない');
  assert.notEqual(ix.contentHash(page('A')), ix.contentHash(page('B')), '本文が変わったら別の内容');
  const t1 = ix.trackPages({}, [{ path: 'index.html', hash: 'a' }, { path: 'about.html', hash: 'x' }, { path: 'old.html', hash: 'o' }], '2026-10-12T07:47+09:00');
  const t2 = ix.trackPages(t1, [{ path: 'index.html', hash: 'b' }, { path: 'about.html', hash: 'x' }], '2026-10-13T07:47+09:00');
  assert.equal(t2['index.html'].changed, '2026-10-13T07:47+09:00', '変わったページは日時を今に');
  assert.equal(t2['about.html'].changed, '2026-10-12T07:47+09:00', '変わっていないページは日時をそのまま');
  assert.ok(!t2['old.html'], 'なくなったページは記録から消す');
  assert.deepEqual(ix.changedSince(t2, '2026-10-12T07:47+09:00'), ['index.html'], '前回選んだあとに変わったページだけ送る');
  assert.deepEqual(ix.changedSince(t2, null).sort(), ['about.html', 'index.html'], '初めては全部');
  assert.equal(ix.dueToday({ today: '2026-10-13', hh: 7, lastRun: '2026-10-12' }).due, true, '朝の最初の更新で選ぶ');
  assert.equal(ix.dueToday({ today: '2026-10-13', hh: 12, lastRun: '2026-10-13' }).due, false, '1日1回');
  assert.equal(ix.dueToday({ today: '2026-10-13', hh: 4, lastRun: '2026-10-12' }).due, false, '朝6時より前（前の晩の遅れた更新）は選ばない');
  assert.equal(ix.dueToday({ today: '2026-10-13', hh: 23, lastRun: '2026-10-13', force: true }).due, true, '手動の指定');
  assert.deepEqual(ix.payload({ base: 'https://takarakuji-kangen.com', key: 'abcdef12', urls: ['https://takarakuji-kangen.com/'] }),
    { host: 'takarakuji-kangen.com', key: 'abcdef12', keyLocation: 'https://takarakuji-kangen.com/abcdef12.txt', urlList: ['https://takarakuji-kangen.com/'] });
  assert.equal(ix.pageUrl('https://takarakuji-kangen.com', 'index.html'), 'https://takarakuji-kangen.com/');
  assert.equal(ix.pageUrl('https://takarakuji-kangen.com', 'kuji/big.html'), 'https://takarakuji-kangen.com/kuji/big.html');
  assert.ok(ix.validKey('47c9e6fd734f2d6f986c6345f4d447b4') && !ix.validKey('short') && !ix.validKey('has space 1234'), 'キーの形式');
  const siteConf = JSON.parse(readFileSync(path.join(ROOT, 'config/site.json'), 'utf8'));
  assert.ok(!siteConf.indexNowKey || ix.validKey(siteConf.indexNowKey), 'config/site.json の indexNowKey は、空か英数字とハイフンで8〜128文字');
  // 本物のページ：同じ日に時刻だけ違う更新では、内容が変わったとみなさない（1日に何度も送らないため）
  const at2 = (s) => ({ ...at(s), y: 2026 });
  const ctxH = (now) => createRenderer({
    site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {}, startedOn: '2026-10-10' },
    links, points, rows: computeAll(defs, state, now, {}), byId: {}, log: [], history: { days: {} },
    catalog: { order: [], items: {} }, now, state, defs, order: Object.fromEntries(Object.keys(defs).map((k, i) => [k, i])),
    preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x',
  });
  for (const id of ['bingo5', 'loto6']) {
    const h = (s) => { const now = at2(s); const rr = computeAll(defs, state, now, {}); return ix.contentHash(ctxH(now).game(rr.find((r) => r.id === id)).html); };
    assert.equal(h('2026-10-10T10:07'), h('2026-10-10T10:47'), `${id}：時刻だけ違う更新`);
  }
  assert.equal(ix.contentHash(ctxH(at2('2026-10-10T10:07')).about().html), ix.contentHash(ctxH(at2('2026-10-11T10:07')).about().html), '「このサイトについて」は日が変わっても同じ内容');
});

/* ---------- Google Search Console の確認タグ ---------- */

const { verificationCode } = await import('./lib/util.mjs');

t('Search Console の確認タグ（貼ったタグから取り出して全ページの head に入れる）', () => {
  const code = 'Ab3dEf_gH1jK-lMn0pQrStUvWxYz0123456789abcd';
  // 本物のファイルは運営者がタグを貼ると中身が変わるので、説明の行（# で始まる行）だけを見本に使う
  const real = readFileSync(path.join(ROOT, 'config/google-site-verification.txt'), 'utf8');
  const file = `${real.split(/\r?\n/).filter((l) => l.trim().startsWith('#')).join('\n')}\n`;
  assert.equal(verificationCode(file), '', 'まだ貼っていないときは空');
  assert.equal(verificationCode(`${file}<meta name="google-site-verification" content="${code}" />\n`), code, 'タグをそのまま貼った');
  assert.equal(verificationCode(`${file}<meta name="google-site-verification" content="${code}" />`), code, '最後に改行がない');
  assert.equal(verificationCode(`${file}  ${code}  \n`), code, 'コードだけを貼った');
  const pasted = verificationCode(real);
  assert.ok(pasted === '' || /^[A-Za-z0-9_-]{20,100}$/.test(pasted), 'いまのファイルから読めるコードは、空か正しい形');
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

/* ---------- 新しいジャンボ宝くじの自動登録 ---------- */

const J = await import('./lib/jumbo.mjs');
const { mergeOrder } = await import('./lib/render.mjs');

// 宝ニュースの賞金表の並び（見出し → 賞金表 → 注記 → 発売期間の表）で、お知らせの見本を作る
const newsPage = (items) => `${items.map((x) => `<div class="profile-box">
<h3><span class="point"></span>「${x.name}」（${x.prefix ? `${x.prefix} ` : ''}第${x.round}回 全国自治宝くじ）の当せん金・本数</h3>
<table class="news-table news-table2"><tbody>
<tr>
<th>等級等</th>
<th>当せん金</th>
<th>本数</th>
</tr>
${x.tiers.map(([nm, p, c]) => `<tr>\n<th class="news-table-th">${nm}</th>\n<td class="ta_r">${p.toLocaleString('en-US')}円</td>\n<td class="ta_r">${c.toLocaleString('en-US')}本</td>\n</tr>`).join('\n')}
</tbody></table>
<p class="ta_r">（発売総額${x.sales}・${x.units}ユニットの場合 ※1ユニット${x.per}）</p></div>
<div class="news-table-period"><table class="ta_l"><tbody>
<tr><th>発売期間：</th><td>${x.period}</td></tr>
<tr><th>抽せん日：</th><td>${x.draw}</td></tr>
<tr><th>発売価格：</th><td>1枚${x.price || 300}円</td></tr>
</tbody></table></div>`).join('\n')}\n<h3>初めてのご利用の方</h3>`;
const NEN26 = {
  name: '年末ジャンボ宝くじ', round: 1134, sales: '1,380億円', units: 23, per: '2,000万枚',
  period: '令和8年11月24日（火）～令和8年12月25日（金）', draw: '令和8年12月31日（木）',
  tiers: [['1等', 7e8, 23], ['1等の前後賞', 1.5e8, 46], ['1等の組違い賞', 1e5, 4577], ['2等', 1e8, 23], ['3等', 1e7, 46], ['4等', 1e6, 1380], ['5等', 1e4, 1380000], ['6等', 3000, 4600000], ['7等', 300, 46000000]],
};
const NENMINI26 = {
  name: '年末ジャンボミニ', round: 1135, sales: '450億円', units: 15, per: '1,000万枚',
  period: '令和8年11月24日（火）～令和8年12月25日（金）', draw: '令和8年12月31日（木）',
  tiers: [['1等', 3e7, 150], ['1等の前後賞', 1e7, 300], ['2等', 1e6, 150], ['3等', 3e4, 45000], ['4等', 1e4, 450000], ['5等', 3000, 1500000], ['6等', 300, 15000000]],
};
const NEWS26 = { id: '261101', url: 'https://www.takarakuji-official.jp/news/recent/?newsId=261101', label: 'ジャンボ宝くじ等', title: '「年末ジャンボ」が11月24日（火）から発売開始！', date: '2026-11-05' };
const prodsOf = (html, today, news = NEWS26) => J.parseJumboNews(html).map((p) => ({ p, news, errors: J.checkJumbo(p, today) }));
const jumboRaw = JSON.parse(fx('jumbo.json').toString('utf8'));

t('宝ニュースの一覧（ジャンボ宝くじ等のお知らせを選ぶ）', () => {
  const list = J.parseNewsList(fx('takarakuji-news-list.html').toString('utf8'));
  const jumboNews = list.filter(J.isJumboNews);
  assert.deepEqual(jumboNews.map((x) => x.id), ['261001', '261002', '260902'], 'ジャンボ宝くじ等の種類のお知らせだけ（スクラッチ・抽せん会は選ばない）');
  assert.equal(jumboNews[0].url, 'https://www.takarakuji-official.jp/news/recent/?newsId=261001');
  assert.equal(jumboNews[0].date, '2026-10-05');
  assert.equal(jumboNews[2].title, '「ハロウィンジャンボ」が9月16日(水)から発売開始!');
  assert.ok(list.some((x) => x.id === '261003' && x.label === 'スクラッチ'));
});

t('ジャンボの賞金表の読み取り（宝ニュースのお知らせ）', () => {
  const ps = J.parseJumboNews(fx('takarakuji-news-jumbo.html').toString('utf8'));
  assert.deepEqual(ps.map((p) => [p.name, p.roundText]), [['ハロウィンジャンボ宝くじ', '第1126回全国自治宝くじ'], ['ハロウィンジャンボミニ', '第1127回全国自治宝くじ']]);
  const [h, m] = ps;
  assert.deepEqual([h.price, h.totalTickets, h.units, h.unitTickets, h.salesStart, h.salesEnd, h.drawDate, h.payStart], [300, 120000000, 12, 10000000, '2026-09-16', '2026-10-16', '2026-10-26', '2026-11-02']);
  assert.deepEqual(h.cands, { sales: 120000000, units: 120000000, lowest: 120000000 }, '発売総数を3つの方法で出して一致');
  assert.equal(h.tiers.length, 8);
  assert.deepEqual(h.tiers[2], { name: '1等の組違い賞', prize: 100000, count: 1188 });
  assert.equal(m.totalTickets, 50000000);
  for (const p of ps) assert.deepEqual(J.checkJumbo(p, '2026-10-12'), [], `${p.name} の検算`);
  // 手で登録した内容（2026年10月11日の写し）と同じ
  assert.deepEqual(J.diffJumbo(jumboRaw.halloween2026, h), []);
  assert.deepEqual(J.diffJumbo(jumboRaw.halloweenmini2026, m), []);
  // ジャンボではない普通くじの賞金表は読まない
  assert.deepEqual(J.parseJumboNews(fx('takarakuji-news-other.html').toString('utf8')), []);
  // 2018年の古い書き方（発売期間の表がない）は、検算に通らないので登録しない（読み取りで止まらない）
  const old = J.parseJumboNews(fx('takarakuji-news-jumbo-2018.html').toString('utf8'));
  assert.equal(old.length, 2);
  assert.equal(old[0].units, 9, '本数の見出しの（9ユニット）');
  assert.equal(old[0].tiers.at(-1).name, 'ハロウィン賞');
  assert.ok(J.checkJumbo(old[0], '2018-10-10').some((e) => e.includes('発売期間')));
  // 数の読み方
  assert.deepEqual(['1,380億', '2,000万', '200,000,000円', '1億5,000万円', '12本', 'あ', ''].map(J.jpNumber), [138000000000, 20000000, 200000000, 150000000, 12, null, null]);
  assert.deepEqual([1e7, 1e6, 2e7, 4782969].map(J.oddsJa), ['1,000万分の1', '100万分の1', '2,000万分の1', '4,782,969分の1']);
});

t('ジャンボの検算（読み違いを載せない）', () => {
  const base = prodsOf(newsPage([NEN26, NENMINI26]), '2026-11-06');
  assert.deepEqual(base.map((x) => x.errors), [[], []], '年末ジャンボ（賞金の合計は発売総額の約50%）と年末ジャンボミニ');
  const bad = (edit) => { const p = structuredClone(base[1].p); edit(p); return J.checkJumbo(p, '2026-11-06'); };
  assert.ok(bad((p) => { p.tiers.splice(3, 1); }).some((e) => e.includes('3等が見つかりません')), '等級が1行抜けた');
  const odd = prodsOf(newsPage([NENMINI26]).replace('<td class="ta_r">45,000本</td>', '<td class="ta_r">45,000本（予定）</td>'), '2026-11-06')[0];
  assert.ok(odd.errors.some((e) => e.includes('読み取れない行') && e.includes('3等')), '読めない行を読み飛ばしたまま載せない');
  assert.ok(bad((p) => { p.tiers[0].count = 151; }).some((e) => e.includes('ユニット数')), '1等の本数がユニット数で割り切れない');
  assert.ok(bad((p) => { p.tiers[1].count = 299; }).some((e) => e.includes('前後賞')), '前後賞が1等の2倍でない');
  assert.ok(bad((p) => { p.tiers[3].count = 450000; }).some((e) => e.includes('50%')), '賞金の合計が5割を超える');
  assert.ok(bad((p) => { p.cands.sales = 160000000; }).some((e) => e.includes('発売総数が合いません')), '発売総額とユニットが合わない');
  assert.ok(bad((p) => { p.price = 200; }).length, '値段の読み違い');
  assert.ok(bad((p) => { p.drawDate = '2026-12-20'; }).some((e) => e.includes('順番')), '抽せん日が発売の終わりより前');
  assert.ok(bad((p) => { p.tiers[2].name = '1等'; }).some((e) => e.includes('2回')), '同じ等級が2回');
  const kumi = structuredClone(base[0].p);
  kumi.tiers[2].count = 4600;
  assert.ok(J.checkJumbo(kumi, '2026-11-06').some((e) => e.includes('組違い賞')), '組違い賞は1等×（組の数−1）');
});

t('ジャンボの自動登録（足す・公式発表で置き換える・確認済みにする・違いを知らせる）', () => {
  const raw = { ...structuredClone(jumboRaw), megabig: { name: 'MEGA BIG', group: 'sports', model: 'parimutuel' } };
  const prods = prodsOf(newsPage([NEN26, NENMINI26]), '2026-11-06');
  const plan = J.planJumbo(raw, prods, { today: '2026-11-06', base: 'https://takarakuji-kangen.com', guides: { nenmatsu2026: { about: [{ text: '2026年は**11月24日から12月25日まで発売**、12月31日に抽せん。' }, { text: '11月21日から発売' }] } } });
  assert.equal(plan.changed, true);
  assert.deepEqual(Object.keys(plan.raw), ['_note', 'halloween2026', 'halloweenmini2026', 'nenmatsu2026', 'nenmatsumini2026', 'megabig'], 'ジャンボの並び（回号の順）に入れる');
  const mini = plan.raw.nenmatsumini2026;
  assert.deepEqual([mini.name, mini.round, mini.price, mini.totalTickets, mini.salesStart, mini.salesEnd, mini.drawDate, mini.tiers.length], ['年末ジャンボミニ', '第1135回全国自治宝くじ', 300, 150000000, '2026-11-24', '2026-12-25', '2026-12-31', 7]);
  assert.equal(mini.how, '組と番号が印刷された券を買う普通くじ。1ユニット1,000万枚・15ユニット（発売予定額450億円）');
  assert.deepEqual([mini.drawLabel, mini.deadline, mini.rules], ['12月31日（木）抽せん', '12月25日（金）まで', '1等・前後賞合わせて5,000万円。']);
  assert.ok(mini.verify.includes('2026年11月5日の宝くじ公式サイトの発表から自動で読み取った') && mini.verify.includes('確認待ち'));
  assert.equal(mini.autoFrom.hash, J.dataHash(mini));
  assert.equal(mini.sources[0].url, NEWS26.url);
  near(evaluate(resolveGames({ x: mini }).x).rate, 0.5, 1e-9, '年末ジャンボミニの還元率');
  // 報道をもとにした仮の登録（verify あり・autoFrom なし）は、公式発表の内容に置き換える
  const nen = plan.raw.nenmatsu2026;
  assert.ok(nen.autoFrom && nen.verify.includes('確認待ち') && !nen.verify.includes('報道'));
  assert.deepEqual(nen.autoFrom.changes, [], '数字は報道と同じ');
  assert.equal(nen.rules, '1等・前後賞合わせて10億円。', '「ミニは確認でき次第追加」の文は消える');
  assert.ok(nen.sources[0].url === NEWS26.url && nen.sources.some((s) => s.url.includes('fukuishimbun')), '出典は公式発表を先に（前の出典も残す）');
  const issues = Object.fromEntries(plan.items.filter((x) => x.type === 'raise').map((x) => [x.key, x]));
  const ka = J.autoKey('nenmatsumini2026', mini.autoFrom.hash);
  assert.ok(issues[ka].title.includes('自動で登録しました') && issues[ka].body.includes('| 1等 | 30,000,000円 | 150本 |') && issues[ka].body.includes('Close issue'));
  assert.ok(issues[ka].body.includes('https://takarakuji-kangen.com/kuji/nenmatsumini2026.html'));
  const kn = J.autoKey('nenmatsu2026', nen.autoFrom.hash);
  assert.ok(issues[kn].title.includes('公式発表の内容に更新しました') && issues[kn].body.includes('前の登録と、数字は同じでした'));
  assert.ok(issues[kn].body.includes('11月21日') && issues[kn].body.includes('data/guides.json'), '解説の日付が日程と合わないことも知らせる');
  // games.json の書き方（2つの空白で字下げ）で書いて読み直しても同じ
  assert.deepEqual(JSON.parse(JSON.stringify(plan.raw, null, 2)), plan.raw);

  // 次の日：変わらない（確認待ちの Issue は開いたまま）
  const p2 = J.planJumbo(plan.raw, prods, { today: '2026-11-07' });
  assert.equal(p2.changed, false);
  assert.ok(p2.items.some((x) => x.type === 'raise' && x.key === ka));
  // Issue が閉じられた → 確認済み（verify を消す）
  const p3 = J.planJumbo(plan.raw, prods, { today: '2026-11-08', closed: new Set([ka]) });
  assert.equal(p3.changed, true);
  assert.ok(!('verify' in p3.raw.nenmatsumini2026) && 'verify' in p3.raw.nenmatsu2026);
  assert.ok(p3.items.some((x) => x.type === 'clear' && x.key === ka) && !p3.items.some((x) => x.type === 'raise' && x.key === ka));
  // 公式発表が直された：確認待ちなら読み直す（新しい Issue）。確認済みなら知らせるだけ
  const fixedHtml = newsPage([NEN26, { ...NENMINI26, tiers: NENMINI26.tiers.map((x) => (x[0] === '2等' ? ['2等', 1e6, 120] : x)) }]);
  const fixedProds = prodsOf(fixedHtml, '2026-11-09');
  assert.deepEqual(fixedProds[1].errors, []);
  const p4 = J.planJumbo(plan.raw, fixedProds, { today: '2026-11-09' });
  assert.ok(p4.changed && p4.raw.nenmatsumini2026.tiers[2].count === 120);
  assert.ok(p4.items.some((x) => x.type === 'clear' && x.key === ka && x.note.includes('読み直しました')));
  const ka2 = J.autoKey('nenmatsumini2026', p4.raw.nenmatsumini2026.autoFrom.hash);
  assert.ok(ka2 !== ka && p4.items.find((x) => x.key === ka2).body.includes('2等：1,000,000円×150本 → 1,000,000円×120本'));
  const p5 = J.planJumbo(p3.raw, fixedProds, { today: '2026-11-09' });
  assert.equal(p5.changed, false, '確認済みの登録は自動では変えない');
  const diff = p5.items.find((x) => x.type === 'raise' && x.key.startsWith('jumbo-diff-nenmatsumini2026-'));
  assert.ok(diff && diff.body.includes('2等：1,000,000円×150本 → 1,000,000円×120本'));
  assert.ok(!J.planJumbo(p3.raw, fixedProds, { today: '2026-11-09', closed: new Set([diff.key]) }).items.some((x) => x.key === diff.key && x.type === 'raise'), '閉じた違いは、もう知らせない');
  // 人が直した確認待ちの項目は、公式発表で上書きしない
  const edited = structuredClone(plan.raw);
  edited.nenmatsumini2026.tiers[2].count = 140;
  const p6 = J.planJumbo(edited, fixedProds, { today: '2026-11-09' });
  assert.equal(p6.raw.nenmatsumini2026.tiers[2].count, 140);
});

t('ジャンボの自動登録（登録しない・読み取れない・発売中なのに未登録）', () => {
  // 発売が終わったジャンボは登録しない
  const ended = prodsOf(newsPage([{ ...NENMINI26, round: 1083, period: '令和7年11月21日（金）～令和7年12月23日（火）', draw: '令和7年12月31日（水）' }]), '2026-10-12', { ...NEWS26, date: '2025-11-05' });
  assert.deepEqual(ended[0].errors, []);
  const pe = J.planJumbo(jumboRaw, ended, { today: '2026-10-12' });
  assert.equal(pe.changed, false);
  assert.ok(pe.lines[0].includes('発売が終わっている'));
  // 検算に通らない → 載せずに知らせる（閉じたら、もう知らせない）
  const broken = prodsOf(newsPage([{ ...NENMINI26, tiers: NENMINI26.tiers.slice(0, -1) }]), '2026-11-06');
  assert.ok(broken[0].errors.length);
  const pb = J.planJumbo(jumboRaw, broken, { today: '2026-11-06' });
  assert.equal(pb.changed, false);
  const pi = pb.items.find((x) => x.type === 'raise');
  assert.equal(pi.key, 'jumbo-parse-1135');
  assert.ok(pi.title.includes('読み取れませんでした') && pi.body.includes('検算で引っかかったところ'));
  assert.ok(!J.planJumbo(jumboRaw, broken, { today: '2026-11-06', closed: new Set(['jumbo-parse-1135']) }).items.some((x) => x.type === 'raise'));
  // 同じ回が2つのお知らせにあれば、検算に通ったほうを使う
  const both = [...broken, ...prodsOf(newsPage([NENMINI26]), '2026-11-06')];
  assert.ok(J.planJumbo(jumboRaw, both, { today: '2026-11-06' }).raw.nenmatsumini2026);
  // 知らない名前のジャンボは jumbo＋回号、同じ年に2回目なら回号を付ける
  assert.equal(J.jumboId({ name: 'スプリングジャンボ宝くじ', round: 1200, salesStart: '2027-04-01' }), 'spring2027');
  assert.equal(J.jumboId({ name: 'ふしぎジャンボ', round: 1201, salesStart: '2027-04-01' }), 'jumbo1201');
  assert.equal(J.jumboId({ name: '年末ジャンボミニ', round: 1999, salesStart: '2026-11-24' }, { nenmatsumini2026: { round: '第1135回全国自治宝くじ' } }), 'nenmatsumini2026-1999');
  // 発売中のジャンボ（「現在取扱い中」の欄だけを見る。関連するお知らせの回は数えない）
  assert.deepEqual(J.parseOnSale(fx('takarakuji-onsale.html').toString('utf8')), [{ round: 1126, name: 'ハロウィンジャンボ宝くじ' }]);
  assert.equal(J.parseOnSale('<p>ページの作りが変わった</p>'), null);
  assert.ok(J.missingIssue({ round: 1140, name: 'バレンタインジャンボ宝くじ' }).title.includes('第1140回'));
});

t('ジャンボの自動登録のページ（確認待ちの注記・自動の解説・購入先・宝くじ一覧）', () => {
  // 本物の data/games.json からジャンボを全部外し（自動で足されたものがあっても結果が変わらないように）、見本のジャンボを入れる
  const raw = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(ROOT, 'data/games.json'), 'utf8'))).filter(([, g]) => !(g?.model === 'fixed' && g.group === 'takarakuji')));
  const withJ = J.insertGame(J.insertGame(raw, 'nenmatsu2026', structuredClone(jumboRaw.nenmatsu2026)), 'halloween2026', structuredClone(jumboRaw.halloween2026));
  const plan = J.planJumbo(withJ, prodsOf(newsPage([NEN26, NENMINI26]), '2026-11-06'), { today: '2026-11-06' });
  const defsA = resolveGames(plan.raw);
  assert.deepEqual(Object.keys(defsA).slice(6, 10), ['halloween2026', 'nenmatsu2026', 'nenmatsumini2026', 'megabig']);
  const nowA = { ...at('2026-11-30T12:00'), y: 2026 };
  const rowsA = computeAll(defsA, state, nowA, {});
  const guides = JSON.parse(readFileSync(path.join(ROOT, 'data/guides.json'), 'utf8'));
  const rd = createRenderer({
    site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {} },
    links, points, rows: rowsA, byId: Object.fromEntries(rowsA.map((r) => [r.id, r])), log: [], history: { days: {} },
    catalog: { order: ['loto6', 'halloween2026', 'nenmatsu2026', 'megabig'], items: {} }, guides, now: nowA, state, defs: defsA,
    order: Object.fromEntries(Object.keys(defsA).map((k, i) => [k, i])), preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x',
  });
  const mini = rowsA.find((r) => r.id === 'nenmatsumini2026');
  assert.ok(mini.listed, '発売中ならランキングに出る');
  const html = rd.game(mini).html;
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.ok(html.includes('<p class="notice">賞金・本数・発売期間は、2026年11月5日の宝くじ公式サイトの発表から自動で読み取ったものです（運営者の確認待ち）。</p>'), '確認待ちの注記');
  assert.ok(html.includes('<h2 id="about">年末ジャンボミニの特徴と還元率</h2>') && html.includes('gd-card gd-odds') && html.includes('100万分の1'), '自動の解説');
  assert.ok(html.includes('<dt>年末ジャンボミニはいつまで買えますか？</dt>') && html.includes('"@type":"FAQPage"'), '自動のよくある質問');
  assert.ok(html.includes('2026年11月5日の宝くじ公式サイトの発表をもとに自動で作成しています'), '自動の解説の注記');
  assert.ok(html.includes('宝くじ公式サイトをPayPayクレジットで払う方法（2.0%）'), 'ポイントが一番多い買い方');
  assert.ok(html.includes('みずほ銀行') && html.includes('href="https://www.takarakuji-official.jp/"'), '購入先（config/links.json の jumboDefault）');
  assert.ok(html.includes(NEWS26.url), '出典に公式発表');
  for (const bad of ['NaN', 'undefined', 'Infinity', '[object', '**']) assert.ok(!text.includes(bad), `${bad} が出ている`);
  // 手で書いた解説（年末ジャンボ）は、そのまま使い、注記を公式発表の日に
  const nen = rd.game(rowsA.find((r) => r.id === 'nenmatsu2026')).html;
  assert.ok(nen.includes('※賞金・本数・発売期間は、2026年11月5日の宝くじ公式サイトの発表にもとづきます。') && !nen.includes('報道にもとづきます'));
  assert.ok(nen.includes(guides.games.nenmatsu2026.faq[0].q), '手で書いたよくある質問');
  // 自動の解説の書き方は data/guides.json と同じ決まりを守る
  const g = J.autoGuide(defsA.nenmatsumini2026, { rate: 0.5, point: 'x' });
  for (const a of g.about) assert.ok(a.key.length <= 20 && (a.text.match(/\*\*/g) || []).length % 2 === 0, a.key);
  for (const f of g.faq) assert.ok(/？$/.test(f.q) && f.a.length >= 20);
  for (const bad of ['必ず当たる', '儲かる']) assert.ok(!JSON.stringify(g).includes(bad));
  // 宝くじ一覧：catalog.json の order にないジャンボは、games.json で直前のくじの後ろに。説明は賞金表から
  const ich = rd.ichiran().html;
  assert.ok(ich.indexOf('id="k-nenmatsu2026"') < ich.indexOf('id="k-nenmatsumini2026"') && ich.indexOf('id="k-nenmatsumini2026"') < ich.indexOf('id="k-megabig"'));
  assert.ok(ich.includes('2026年は1等3,000万円、1等の前後賞と合わせて5,000万円です。'));
  assert.deepEqual(mergeOrder(['a', 'c', 'x'], ['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(mergeOrder(['c', 'a'], ['z', 'a', 'b', 'c']), ['z', 'c', 'a', 'b']);
  // ポイント還元のページ：自動で登録したジャンボも、公式サイトで買えるくじに入る
  assert.ok(rd.point().html.includes('ジャンボ'));
});

/* ---------- 新しいくじ・くじのルールの見張り ---------- */

const PR = await import('./lib/products.mjs');

t('新しいくじの見張り（宝くじ公式サイトのメニュー・BIG系・DUNK）', () => {
  const listHtml = fx('takarakuji-news-list.html').toString('utf8');
  const menu = PR.takarakujiMenu(listHtml);
  assert.deepEqual(menu.net.map((x) => x.key), ['Jumbo', 'Loto7', 'Loto6', 'Miniloto', 'Bingo5', 'Numbers4', 'Numbers3', 'Quickone']);
  assert.deepEqual(menu.kuji.map((x) => x.key), ['jumbo', 'scratch', 'loto', 'bingo5', 'numbers', 'quickone']);
  assert.deepEqual(PR.unknownTakarakuji(menu), [], 'いまのメニューは全部知っている');
  const more = listHtml.replace('<li><a href="javascript:glonaviQuickoneForm.submit()">クイックワン</a></li>', '<li><a href="javascript:glonaviQuickoneForm.submit()">クイックワン</a></li><li><a href="javascript:glonaviLoto8Form.submit()">ロト8</a></li>');
  const unk = PR.unknownTakarakuji(PR.takarakujiMenu(more));
  assert.deepEqual(unk.map((x) => [x.key, x.name]), [['net-loto8', 'ロト8']]);
  assert.equal(PR.takarakujiKey(unk[0]), 'newproduct-takarakuji-net-loto8');
  assert.ok(PR.takarakujiIssue(unk[0]).title.includes('「ロト8」'));
  assert.equal(PR.takarakujiMenu('<p>メニューなし</p>'), null);
  // スポーツくじ：見本のページは全部知っているくじ
  for (const [f, kind] of [['big-info.html', 'big'], ['big-result.html', 'big'], ['dunk-info.html', 'dunk'], ['dunk-result.html', 'dunk']]) {
    const labels = PR.sportsLabels(fx(f).toString('utf8'), kind);
    assert.ok(labels.length >= 3, `${f} のくじの名前`);
    assert.deepEqual(PR.unknownSports(kind, labels), [], f);
  }
  const big = PR.sportsLabels(`${fx('big-info.html').toString('utf8')}<h3>第1700回 BIG 2000 くじ情報</h3>`, 'big');
  assert.deepEqual(PR.unknownSports('big', big), ['BIG 2000']);
  assert.deepEqual(PR.unknownSports('dunk', ['DUNK10', 'DUNK6', 'DUNK6-C', 'DUNK8']), ['DUNK6-C', 'DUNK8'], 'DUNK6 は DUNK6-A・B のまとめた呼び名');
  assert.equal(PR.sportsKey('big', 'BIG 2000'), 'newproduct-big-big2000');
  assert.ok(PR.sportsIssue('big', 'BIG 2000', '2026-11-01').body.includes('BIG_PRODUCTS'));
});

t('くじのルールの見張り（値段・賞金・確率・上限の公式ページ）', () => {
  const conf = JSON.parse(readFileSync(path.join(ROOT, 'config/watch.json'), 'utf8'));
  const rules = conf.pages.filter((p) => p.kind === 'rule');
  assert.deepEqual(rules.map((p) => p.id), ['rule-loto6', 'rule-loto7', 'rule-miniloto', 'rule-bingo5', 'rule-numbers4', 'rule-numbers3', 'rule-big', 'rule-dunk']);
  for (const p of conf.pages) assert.ok(p.id && p.kind && /^https:\/\//.test(p.url) && p.keywords?.length && p.file && p.what, `${p.id} の設定`);
  assert.ok(!conf.pages.some((p) => p.id === 'jumbo-takarakuji'), 'ジャンボは宝ニュースからの自動登録に移した');
  const loto6 = fx('rule-loto6.html').toString('utf8');
  const page = rules[0];
  const got = extractLines(loto6, page);
  for (const want of ['2億円', '1 / 6,096,454', '約1,000万円', '(原則固定) 1,000円', 'ロト6でに発生した1億円以上の当せん口数', '※100円未満の端数は切り捨てられます。']) assert.ok(got.includes(want), `「${want}」を見張る`);
  assert.ok(got.some((l) => l.includes('1口 200円') && l.includes('1等最高 6億円')), '1口の値段と1等の上限');
  assert.ok(!got.some((l) => /^\d$/.test(l) || l.includes('更新日')), '数字だけの飾り・更新日は見ない');
  // 年が変わっただけ・更新日だけでは知らせない。賞金が変わったら知らせる
  assert.equal(hashLines(extractLines(loto6.replace('2026年に発生', '2027年に発生').replace('2026年10月12日', '2027年1月5日'), page)), hashLines(got));
  const changed = extractLines(loto6.replace('<p>2億円</p>', '<p>3億円</p>'), page);
  assert.notEqual(hashLines(changed), hashLines(got));
  const issue = changeIssue(page, got, changed, '2026-11-01');
  assert.ok(issue.body.includes('くじのルール') && issue.body.includes('- 2億円') && issue.body.includes('- 3億円') && issue.body.includes('capCO'));
  // BIG と 100円BIG の同じ確率の行も、それぞれ数える（片方だけ変わっても気づく）
  const bigLines = extractLines(fx('rule-big.html').toString('utf8'), rules.find((p) => p.id === 'rule-big'));
  assert.equal(bigLines.filter((l) => l === '1等...4,782,969分の1').length, 2);
  assert.ok(bigLines.includes('1口 300円') && bigLines.includes('1等...80%') && !bigLines.some((l) => l.includes('実績')), '実績の本数は見ない');
  // ワークフロー：見張りの手順は、閉じた Issue を読むために GITHUB_TOKEN を使う
  const wf = readFileSync(path.join(ROOT, '.github/workflows/update.yml'), 'utf8');
  assert.ok(/run: node scripts\/watch\.mjs\n\s+env:\n\s+WATCH_FORCE: \$\{\{ inputs\.watch \}\}\n\s+GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/.test(wf));
  assert.ok(Array.isArray(links.jumboDefault) && links.jumboDefault.every((l) => links.shops[l.shop]), 'config/links.json の jumboDefault');
});

/* ---------- 終わったジャンボの整理・健康診断・Search Console・公開の見張り ---------- */

t('終わったジャンボ（ページは残し、一覧とサイドバーでは「終わったジャンボ宝くじ」に。買うボタンは出さない）', () => {
  const raw = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(ROOT, 'data/games.json'), 'utf8'))).filter(([, g]) => !(g?.model === 'fixed' && g.group === 'takarakuji')));
  const defsP = resolveGames(J.insertGame(J.insertGame(J.insertGame(raw, 'halloween2026', structuredClone(jumboRaw.halloween2026)), 'halloweenmini2026', structuredClone(jumboRaw.halloweenmini2026)), 'nenmatsu2026', structuredClone(jumboRaw.nenmatsu2026)));
  const mk = (s) => {
    const nowP = { ...at(s), y: +s.slice(0, 4) };
    const rowsP = computeAll(defsP, state, nowP, {});
    return { rowsP, rd: createRenderer({
      site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {} },
      links, points, rows: rowsP, byId: Object.fromEntries(rowsP.map((r) => [r.id, r])), log: [], history: { days: {} },
      catalog: { order: [], items: {} }, now: nowP, state, defs: defsP, order: Object.fromEntries(Object.keys(defsP).map((k, i) => [k, i])),
      preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x',
    }) };
  };
  // 11月30日：ハロウィンは抽せんも終わった。年末ジャンボは発売中
  const { rowsP, rd } = mk('2026-11-30T12:00');
  const hw = rd.game(rowsP.find((r) => r.id === 'halloween2026')).html;
  assert.ok(hw.includes('ハロウィンジャンボ宝くじの発売は2026年10月16日（金）で終わりました。抽せん日は2026年10月26日（月）で、抽せんも終わっています。'), '終わったお知らせ');
  assert.ok(hw.includes('いま発売中・発売予定のジャンボ宝くじ：<a href="../kuji/nenmatsu2026.html">年末ジャンボ宝くじ</a>（12月25日（金）まで発売中）'), '発売中のジャンボへの案内');
  assert.ok(!hw.includes('class="cta-box"'), '買うボタンは出さない');
  const ich = rd.ichiran().html;
  assert.ok(!ich.includes('id="k-halloween2026"') && ich.includes('<h2 id="past">終わったジャンボ宝くじ</h2>') && ich.includes('href="kuji/halloween2026.html">ハロウィンジャンボ宝くじ（第1126回全国自治宝くじ）</a>'), '宝くじ一覧は終わったジャンボを下にまとめる');
  assert.ok(ich.includes('id="k-nenmatsu2026"') && ich.includes('<a href="#past">終わったジャンボ宝くじ</a>'));
  const side = rd.index().html.split('<aside class="side"')[1] || '';
  assert.ok(!side.includes('kuji/halloween2026.html') && side.includes('kuji/nenmatsu2026.html'), 'サイドバーのくじ別には出さない');
  // 10月20日：ハロウィンは発売が終わったが、抽せん前（一覧にはまだ出す）。年末ジャンボは発売前で「〇月〇日から買えます」
  const b = mk('2026-10-20T12:00');
  const hw2 = b.rd.game(b.rowsP.find((r) => r.id === 'halloween2026')).html;
  assert.ok(hw2.includes('抽せん日は2026年10月26日（月）です。') && hw2.includes('11月24日（火）から発売'));
  assert.ok(b.rd.ichiran().html.includes('id="k-halloween2026"'));
  assert.ok(b.rd.game(b.rowsP.find((r) => r.id === 'nenmatsu2026')).html.includes('<p class="cta-title">年末ジャンボ宝くじは11月24日（火）から買えます</p>'));
  // 購入先は config/links.json の jumboDefault（ジャンボごとに書かなくてよい）
  assert.ok(Object.keys(links.games).every((id) => !/(jumbo|nenmatsu|halloween|valentine|dream|summer)/.test(id)), 'links.json の games にジャンボを書かない');
});

t('ジャンボの「何枚買うと当たる？」とミニとの比較（賞金表から自動で作る）', () => {
  const hw = { ...jumboRaw.halloween2026, id: 'halloween2026' };
  const mini = { ...jumboRaw.halloweenmini2026, id: 'halloweenmini2026' };
  // 1枚で1万円以上：(12+24+1188+24+120+240,000)本 ÷ 1億2,000万枚
  near(J.chanceAtLeast(hw, 10000), 241368 / 120000000, 1e-15, '1万円以上');
  near(J.chanceOfN(0.01, 10), 1 - 0.99 ** 10, 1e-15, '10枚');
  assert.deepEqual([0.0297, 0.0033, 0.00011, 1 / 66667, 5e-7, 1e-7, 5e-9].map(J.chanceText), ['3.0%', '0.33%', '0.011%', '約6.7万分の1', '約200万分の1', '約1,000万分の1', '約2億分の1']);
  const bc = J.buyChances(hw, 0.4733);
  assert.deepEqual(bc.levels.map((l) => l.label), ['1万円以上', '10万円以上', '100万円以上', '1等（2億円）']);
  assert.deepEqual(bc.rows.map((x) => [x.n, x.cost, J.chanceText(x.chances[0])]), [[10, 3000, '2.0%'], [30, 9000, '5.9%'], [100, 30000, '18.2%']]);
  near(bc.rows[0].back, 3000 * 0.4733, 1e-9, '10枚で平均で戻る金額');
  assert.equal(bc.lowest.name, '6等');
  // ミニは10万円以上と100万円以上の確率が同じ（間の賞がない）ので、100万円以上だけ残す
  assert.deepEqual(J.buyChances(mini, 0.47).levels.map((l) => l.label), ['1万円以上', '100万円以上', '1等（2,000万円）']);
  // 同じ日に発売・抽せんのジャンボ
  const defsJ = { halloween2026: hw, halloweenmini2026: mini, nenmatsu2026: { ...jumboRaw.nenmatsu2026, id: 'nenmatsu2026' } };
  assert.equal(J.jumboSibling(hw, defsJ).id, 'halloweenmini2026');
  assert.equal(J.jumboSibling(defsJ.nenmatsu2026, defsJ), null);
  assert.equal(J.compareSentence(hw, mini), '1等の金額はハロウィンジャンボ宝くじが10倍、1等の当せん確率はハロウィンジャンボミニが10倍高い計算です。1万円以上が当たる確率はハロウィンジャンボミニのほうが2倍高くなります。');
  // 自動の解説のよくある質問にも入る
  const g = J.autoGuide(hw, { rate: 0.4733, sibling: mini });
  assert.ok(g.faq.some((f) => f.q === 'ハロウィンジャンボ宝くじを何枚買えば、1万円以上が当たりますか？' && f.a.includes('平均すると497枚に1枚')));
  assert.ok(g.faq.some((f) => f.q.includes('どちらが当たりやすいですか？')));
  // ページ：年の付いた題名・目次・表。ジャンボ以外のページは今までどおり
  const nowJ = { ...at('2026-10-12T19:47'), y: 2026 };
  const defsP = resolveGames({ ...Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(ROOT, 'data/games.json'), 'utf8'))).filter(([, x]) => !(x?.model === 'fixed' && x.group === 'takarakuji'))), ...jumboRaw });
  const rowsJ = computeAll(defsP, state, nowJ, {});
  const rdJ = createRenderer({
    site: { siteName: '宝くじ還元率ランキング', tagline: 't', baseUrl: 'https://example.com', adsense: {} },
    links, points, rows: rowsJ, byId: Object.fromEntries(rowsJ.map((r) => [r.id, r])), log: [], history: { days: {} },
    catalog: { order: [], items: {} }, now: nowJ, state, defs: defsP, order: Object.fromEntries(Object.keys(defsP).map((k, i) => [k, i])),
    preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x',
  });
  const page = rdJ.game(rowsJ.find((r) => r.id === 'halloween2026')).html;
  assert.ok(page.includes('<title>ハロウィンジャンボ宝くじ2026の還元率と当たる確率（10月12日更新）｜宝くじ還元率ランキング</title>'));
  assert.ok(page.includes('<h1 class="page-title">ハロウィンジャンボ宝くじ2026の還元率と当たる確率</h1>'));
  assert.ok(page.includes('<a href="#count">何枚買うと当たる？（買う枚数ごとの確率）</a>') && page.includes('<a href="#compare">ハロウィンジャンボミニとの比較</a>'));
  assert.ok(page.includes('<td class="r">2.0%</td>') && page.includes('約1,420円') && page.includes('href="../kuji/halloweenmini2026.html">ハロウィンジャンボミニ</a>'));
  assert.ok(page.indexOf('id="tiers"') < page.indexOf('id="count"') && page.indexOf('id="count"') < page.indexOf('id="compare"'));
  const nen = rdJ.game(rowsJ.find((r) => r.id === 'nenmatsu2026')).html;
  assert.ok(nen.includes('id="count"') && !nen.includes('id="compare"'), 'ミニが登録されるまでは比較なし');
  const l6 = rdJ.game(rowsJ.find((r) => r.id === 'loto6')).html;
  assert.ok(!l6.includes('id="count"') && l6.includes('<h1 class="page-title">ロト6の還元率</h1>'), 'ジャンボ以外は今までどおり');
  // トップページ：発売中・45日以内に発売のジャンボ
  const top = rdJ.index().html;
  assert.ok(top.includes('<h2 id="jumbo">ジャンボ宝くじ（発売中・発売予定）</h2>') && top.includes('<a href="#jumbo">'));
  assert.equal((top.match(/class="jb-card/g) || []).length, 3, 'ハロウィン・ミニ・年末');
  assert.ok(top.includes('11月24日（火）から発売') && top.includes('10月16日（金）まで発売中'));
  const late = { ...at('2026-12-28T12:00'), y: 2026 };
  const rowsL = computeAll(defsP, state, late, {});
  const topL = createRenderer({
    site: { siteName: 's', tagline: 't', baseUrl: 'https://example.com', adsense: {} }, links, points, rows: rowsL, byId: Object.fromEntries(rowsL.map((r) => [r.id, r])), log: [], history: { days: {} },
    catalog: { order: [], items: {} }, now: late, state, defs: defsP, order: Object.fromEntries(Object.keys(defsP).map((k, i) => [k, i])), preview: false, placeholders: false, inlineCss: false, css: '', cssVersion: 'x',
  }).index().html;
  assert.ok(!topL.includes('id="jumbo"'), '発売中・発売予定のジャンボがなければ出さない');
});

const H = await import('./lib/health.mjs');

t('サイトと自動更新の健康診断（公開中のサイト・証明書・ドメイン・外部タイマー・トークン）', () => {
  assert.equal(H.parseUpdated('<p class="updated"><span class="badge">毎日更新</span><span>最終更新：2026年10月12日（月） 7:47</span></p>'), '2026-10-12T07:47:00+09:00');
  assert.equal(H.parseUpdated('<p>なし</p>'), null);
  assert.equal(H.rdapExpiry({ events: [{ eventAction: 'registration', eventDate: '2026-10-11T03:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-10-11T03:00:00Z' }] }), '2027-10-11');
  const base = 'https://takarakuji-kangen.com';
  const run = (o) => Object.fromEntries(H.healthChecks({ now: '2026-10-12T04:00:00Z', today: '2026-10-12', base, ...o }).map((c) => [c.key, c]));
  // ふだん：何も知らせない（閉じるだけ）
  let k = run({ site: { ok: true, updated: '2026-10-12T12:47:00+09:00' }, cert: { validTo: '2026-12-30' }, domain: { expires: '2027-10-11' }, timer: { count: 20, last: '2026-10-12T03:47:08Z' }, tokenExpires: '2027-10-13' });
  assert.ok(Object.values(k).every((c) => c.type === 'clear'), JSON.stringify(Object.keys(k)));
  // 開けない／20時間以上更新されていない
  assert.equal(run({ site: { ok: false, error: 'HTTP 404' } })['site-down'].type, 'raise');
  k = run({ site: { ok: true, updated: '2026-10-11T07:47:00+09:00' } });
  assert.equal(k['site-stale'].type, 'raise');
  assert.ok(k['site-stale'].title.includes('29時間'));
  assert.equal(run({ site: { ok: true, updated: null } })['site-stale'], undefined, '最終更新が読めないときは判断しない');
  // 証明書は14日前から、ドメインとトークンは30日前から（期限ごとに別の Issue）
  assert.equal(run({ cert: { validTo: '2026-10-26' } })['cert-expiry-2026-10-26'].type, 'raise');
  assert.equal(run({ cert: { validTo: '2026-10-27' } })['cert-expiry-2026-10-27'].type, 'clear');
  assert.ok(run({ domain: { expires: '2026-11-11' } })['domain-expiry-2026-11-11'].title.includes('あと30日'));
  assert.equal(run({ tokenExpires: '2026-11-10' })['timer-token-2026-11-10'].type, 'raise');
  assert.equal(run({ tokenExpires: '' })['timer-token-'], undefined);
  // 外部タイマー：13時間より長く来ていなければ知らせる。一度も使っていなければ知らせない
  assert.equal(run({ timer: { count: 20, last: '2026-10-11T14:47:00Z' } })['timer-stopped'].type, 'raise');
  assert.equal(run({ timer: { count: 20, last: '2026-10-11T15:47:00Z' } })['timer-stopped'].type, 'clear', '1回抜けただけ（12時間）は知らせない');
  assert.equal(run({ timer: { count: 0, last: null } })['timer-stopped'], undefined);
  // ワークフロー：毎回の健康診断・公開の失敗のお知らせ・プルリクエストの確認・部品の更新
  const wf = readFileSync(path.join(ROOT, '.github/workflows/update.yml'), 'utf8');
  assert.ok(/name: サイトと自動更新の健康診断\n\s+if: github\.event_name != 'push'\n\s+run: node scripts\/health\.mjs\n\s+env:\n\s+GITHUB_TOKEN:/.test(wf), '健康診断の手順');
  assert.ok(wf.includes('actions: read'), '実行の一覧を読む権限');
  assert.ok(/name: 公開の結果を知らせる\n\s+if: always\(\)\n\s+run: node scripts\/notify\.mjs\n\s+env:\n\s+GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n\s+DEPLOY_STATUS: \$\{\{ steps\.deployment\.outcome \}\}/.test(wf), '公開の失敗を知らせる');
  assert.ok(wf.includes("if: github.event_name != 'push' && steps.deployment.outcome == 'success'"), '公開できたときだけ IndexNow に送る');
  assert.ok(wf.includes('GSC_CREDENTIALS: ${{ secrets.GSC_CREDENTIALS }}'));
  const check = readFileSync(path.join(ROOT, '.github/workflows/check.yml'), 'utf8');
  assert.ok(check.includes('pull_request:') && check.includes('node scripts/test.mjs') && check.includes('node scripts/build.mjs --no-history'), 'プルリクエストの確認');
  assert.ok(readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8').includes('package-ecosystem: github-actions'), 'GitHub Actions の部品の更新');
  const siteConf = JSON.parse(readFileSync(path.join(ROOT, 'config/site.json'), 'utf8'));
  assert.ok(!siteConf.timerTokenExpires || /^\d{4}-\d{2}-\d{2}$/.test(siteConf.timerTokenExpires), 'timerTokenExpires は YYYY-MM-DD');
  // IndexNow：設定の誤り（形式・キー・URL）だけ Issue にする
  assert.deepEqual([400, 403, 422, 429, 500, 200].map(ix.isConfigError), [true, true, true, false, false, false]);
  assert.ok(ix.indexNowIssue(403, '', base, 'abcdef12').body.includes(`${base}/abcdef12.txt`));
});

const G = await import('./lib/gsc.mjs');
const { generateKeyPairSync, createVerify } = await import('node:crypto');

await ta('Search Console の自動チェック（ログイン・サイトマップ・ページの登録状況）', async () => {
  // サービス アカウントのキー（見本）で JWT を作り、署名を確かめる
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const cred = G.readCredentials(JSON.stringify({ type: 'service_account', client_email: 'kt@example.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' }));
  assert.ok(cred && !G.readCredentials('{"a":1}') && !G.readCredentials('こわれた'));
  const jwt = G.signedJwt(cred, Date.parse('2026-10-12T00:00:00Z'));
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { iss: 'kt@example.iam.gserviceaccount.com', scope: G.SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: 1791763200, exp: 1791766800 });
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')), '署名');
  // 判定：登録済み・待ち・直す必要がある
  assert.equal(G.judgePage({ verdict: 'PASS', coverageState: '送信して登録されました' }).status, 'indexed');
  assert.equal(G.judgePage({ verdict: 'NEUTRAL', coverageState: 'URL が Google に認識されていません' }).status, 'waiting');
  assert.equal(G.judgePage({ verdict: 'FAIL', indexingState: 'BLOCKED_BY_META_TAG' }).reason, 'noindex のタグで登録が止められています');
  assert.equal(G.judgePage({ verdict: 'FAIL', pageFetchState: 'NOT_FOUND' }).status, 'problem');
  assert.equal(G.judgePage({ robotsTxtState: 'DISALLOWED' }).status, 'problem');
  assert.deepEqual(G.sitemapUrls('<url><loc>https://a.jp/</loc></url><url><loc> https://a.jp/b.html </loc></url>'), ['https://a.jp/', 'https://a.jp/b.html']);
  assert.equal(G.needSubmit(null, '2026-10-12'), true);
  assert.equal(G.needSubmit({ lastDownloaded: '2026-10-10T01:00:00Z' }, '2026-10-12'), false);
  assert.equal(G.needSubmit({ lastDownloaded: '2026-10-01T01:00:00Z' }, '2026-10-12'), true, '7日より前なら送り直す');
  assert.equal(G.needSubmit({ isPending: true }, '2026-10-12'), false);
  // API の呼び方（見本の応答）
  const calls = [];
  const fake = async (url, opt = {}) => {
    calls.push(`${opt.method || 'GET'} ${url}`);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://oauth2')) return json({ access_token: 'T' });
    if (url.includes('/sitemaps/')) return new Response(null, { status: 204 });
    if (url.endsWith('/sitemaps')) return json({ sitemap: [{ path: 'https://takarakuji-kangen.com/sitemap.xml', errors: '0', warnings: '0', lastDownloaded: '2026-10-11T00:00:00Z' }] });
    if (url.includes('urlInspection')) return json({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: '送信して登録されました' } } });
    return json({}, 404);
  };
  const gc = G.gscClient(cred, { fetchImpl: fake });
  const sms = await gc.sitemaps('sc-domain:takarakuji-kangen.com');
  await gc.submit('sc-domain:takarakuji-kangen.com', 'https://takarakuji-kangen.com/sitemap.xml');
  const r = await gc.inspect('sc-domain:takarakuji-kangen.com', 'https://takarakuji-kangen.com/');
  assert.equal(sms.length, 1);
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual(calls, [
    'POST https://oauth2.googleapis.com/token',
    'GET https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Atakarakuji-kangen.com/sitemaps',
    'PUT https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Atakarakuji-kangen.com/sitemaps/https%3A%2F%2Ftakarakuji-kangen.com%2Fsitemap.xml',
    'POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
  ], 'ログインは1回だけ');
  // 知らせること：ログインできない・サイトマップのエラー・登録できないページ（待ちのページは知らせない）
  const base = 'https://takarakuji-kangen.com';
  const keys = (o) => Object.fromEntries(G.gscChecks({ base, site: 'sc-domain:takarakuji-kangen.com', ...o }).map((c) => [c.key, c.type]));
  assert.deepEqual(keys({ error: { message: 'HTTP 403', auth: true } }), { 'gsc-auth': 'raise' });
  assert.deepEqual(keys({ error: { message: 'timeout', auth: false } }), {}, '一時的な失敗は知らせない');
  assert.deepEqual(keys({ sitemap: sms[0], pages: [{ url: `${base}/`, status: 'indexed' }, { url: `${base}/a.html`, status: 'waiting' }] }), { 'gsc-auth': 'clear', 'gsc-sitemap': 'clear', 'gsc-pages': 'clear' });
  const bad = G.gscChecks({ base, site: 'x', sitemap: { ...sms[0], errors: '2' }, pages: [{ url: `${base}/kuji/x.html`, status: 'problem', reason: 'ページが見つかりません（404）' }] });
  assert.ok(bad.find((c) => c.key === 'gsc-sitemap').title.includes('2件'));
  assert.ok(bad.find((c) => c.key === 'gsc-pages').body.includes('/kuji/x.html：ページが見つかりません（404）'));
});

console.log(`\n${n}件すべて成功`);
