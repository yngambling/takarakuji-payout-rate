// くじの定義（games.json）と取得データ（state.json）から、
// 「今日の時点で次に買える回」の状況と還元率をまとめる。

import { evaluate, maxRate } from './ev.mjs';
import { nextDrawDate, median, fmtMd, fmtShort, man, capLabel } from './util.mjs';
import { specialOf, withSpecialCap } from './special.mjs';

export const DRAW_CLOSE_MIN = 18 * 60 + 20; // 数字選択式のネット販売締切の目安（18:20）

/** extends（DUNK6-A/B が DUNK6 を引き継ぐなど）を展開した定義の一覧 */
export function resolveGames(raw) {
  const out = {};
  for (const [id, g] of Object.entries(raw)) {
    if (id.startsWith('_') || g.template) continue;
    const merged = g.extends ? { ...structuredClone(raw[g.extends]), ...structuredClone(g) } : structuredClone(g);
    delete merged.extends;
    delete merged.template;
    out[id] = { ...merged, id };
  }
  return out;
}

const hhmm = (now) => `${String(now.hh).padStart(2, '0')}:${String(now.mm).padStart(2, '0')}`;
const key = (iso, t) => `${iso}T${t || '00:00'}`;

function drawStatus(def, st, now) {
  const mins = now.hh * 60 + now.mm;
  const draws = st?.draws || [];
  const last = draws[0] || null;
  let next;
  let stale = false;
  if (last) {
    next = nextDrawDate({ weekdays: def.drawDays, after: last.date, today: now.iso });
    const firstAfter = nextDrawDate({ weekdays: def.drawDays, after: last.date, today: last.date });
    if (firstAfter && firstAfter < now.iso) stale = true;
  } else {
    next = nextDrawDate({ weekdays: def.drawDays, today: now.iso, skipToday: mins >= DRAW_CLOSE_MIN });
  }
  const closedToday = next === now.iso && mins >= DRAW_CLOSE_MIN;
  const round = last && !stale ? last.round + 1 : null;
  let text = `${fmtMd(next)}抽せん`;
  if (next === now.iso) text = closedToday ? '本日抽せん（販売終了・結果待ち）' : `本日${fmtMd(next)}抽せん`;
  return {
    kind: closedToday ? 'closed' : 'onsale', next, round, stale, last,
    label: round ? `第${round}回` : '',
    text,
    deadline: closedToday ? '' : `${fmtShort(next)} 18:20ごろ締切（ネット）`,
    short: `${round ? `第${round}回 ` : ''}${fmtShort(next)}抽せん`,
    shortSub: closedToday ? '本日の販売は終了' : '18:20ごろ締切（ネット）',
  };
}

function roundStatus(def, st, now) {
  const results = st?.results || [];
  const nowK = key(now.iso, hhmm(now));
  let o = st?.onSale;
  // 販売中の回が終わっていて、次の回（nextSale）の情報があればそちらを使う
  if (st?.nextSale && (!o || !o.salesEnd || nowK > key(o.salesEnd, o.salesEndTime || '23:59'))) o = st.nextSale;
  if (!o || !o.salesEnd) {
    return { kind: 'unknown', text: '販売中の回を確認できません', label: '', deadline: '', short: '確認中', shortSub: '', last: results[0] || null };
  }
  const endK = key(o.salesEnd, o.salesEndTime || '23:59');
  const startK = o.salesStart ? key(o.salesStart, o.salesStartTime || '00:00') : '0000'; // 開始日が不明なら販売中とみなす
  const label = `第${o.round}回`;
  const endTxt = `${fmtShort(o.salesEnd)}${o.salesEndTime ? ` ${o.salesEndTime}` : ''}締切`;
  if (nowK > endK) {
    return { kind: 'stale', o, label, text: `${label}は販売終了（次の回の情報を取得中）`, deadline: '', short: `${label}は販売終了`, shortSub: '次の回を確認中', last: results[0] || null };
  }
  if (nowK < startK) {
    const from = `${fmtShort(o.salesStart)}${o.salesStartTime ? ` ${o.salesStartTime}` : ''}`;
    return { kind: 'before', o, label, text: `${label}は${fmtMd(o.salesStart)}${o.salesStartTime ? ` ${o.salesStartTime}` : ''}から販売`, deadline: endTxt, short: label, shortSub: `${from}から販売`, last: results[0] || null };
  }
  return {
    kind: 'onsale', o, label,
    text: `${label}販売中${o.resultDate ? `（${fmtMd(o.resultDate)}結果発表）` : ''}`,
    deadline: `${endTxt}（ネット）`, short: label, shortSub: endTxt, last: results[0] || null,
  };
}

function fixedStatus(def, now) {
  if (def.salesStart && now.iso < def.salesStart) {
    return { kind: 'upcoming', text: `${fmtMd(def.salesStart)}発売予定`, deadline: '', label: def.round || '', short: `${fmtShort(def.salesStart)}発売`, shortSub: `${fmtShort(def.drawDate)}抽せん` };
  }
  if (def.salesEnd && now.iso > def.salesEnd) {
    return { kind: 'ended', text: `販売終了（${fmtMd(def.drawDate)}抽せん）`, deadline: '', label: def.round || '', short: '販売終了', shortSub: `${fmtShort(def.drawDate)}抽せん` };
  }
  return {
    kind: 'onsale', label: def.round || '',
    text: `${fmtMd(def.salesEnd)}まで発売・${fmtMd(def.drawDate)}抽せん`,
    deadline: `${fmtShort(def.salesEnd)}まで`,
    short: `${fmtShort(def.salesEnd)}まで発売`, shortSub: `${fmtShort(def.drawDate)}抽せん`,
  };
}

/** 想定する販売額（同じ曜日の直近4回の中央値。足りなければ直近の中央値） */
function salesEstimate(def, st, status) {
  if (def.model !== 'parimutuel') return { salesEst: null, salesNote: '' };
  const draws = st?.draws;
  if (draws?.length) {
    const wd = status.next ? new Date(`${status.next}T00:00:00Z`).getUTCDay() : null;
    const same = draws.filter((d) => d.sales > 0 && (wd == null || new Date(`${d.date}T00:00:00Z`).getUTCDay() === wd)).slice(0, 4);
    const pool = same.length >= 2 ? same : draws.filter((d) => d.sales > 0).slice(0, 4);
    if (pool.length) {
      return { salesEst: median(pool.map((d) => d.sales)), salesNote: `直近${pool.length}回${same.length >= 2 && def.drawDays?.length > 1 ? '（同じ曜日）' : ''}の販売実績の中央値` };
    }
  }
  const results = st?.results;
  if (results?.length) {
    const pool = results.filter((r) => r.sales > 0).slice(0, 3);
    if (pool.length) return { salesEst: median(pool.map((r) => r.sales)), salesNote: `直近${pool.length}回の売上金額の中央値` };
  }
  if (def.defaultSales) return { salesEst: def.defaultSales, salesNote: '過去の売上の目安（取得データなし）' };
  return { salesEst: null, salesNote: '' };
}

function carryoverOf(def, st, status) {
  if (!def.carryover) return { carryover: 0, carryNote: '', provisional: false };
  if (def.model === 'parimutuel' && st?.draws?.length) {
    const d = st.draws[0];
    return {
      carryover: d.carryover || 0,
      carryNote: `第${d.round}回（${fmtMd(d.date)}）の結果で確定した金額`,
      provisional: !!status.stale,
    };
  }
  const o = status.o;
  if (o && Number.isFinite(o.carryoverIn) && status.kind !== 'stale') {
    return { carryover: o.carryoverIn, carryNote: `第${o.round}回に繰り越された金額（確定）`, provisional: false };
  }
  const r = st?.results?.[0];
  if (r) {
    const wait = o && o.round !== r.round ? `。第${o.round}回への繰越額は、前の回の結果が出ると確定します` : '';
    // 繰越がほぼ出ないくじ（BIG1000・mini BIG・DUNK6）で 0円のときは「暫定」を付けない
    const big = (r.carryoverOut || 0) > 0 || def.tiers?.some((t) => t.top && t.capCO);
    return { carryover: r.carryoverOut || 0, carryNote: `第${r.round}回の結果時点の金額${wait}`, provisional: !!wait && big };
  }
  return { carryover: 0, carryNote: 'データなし', provisional: true };
}

export function applyOverride(row, ov, today) {
  if (!ov || (ov.until && today > ov.until)) return;
  if (Number.isFinite(ov.carryover)) { row.carryover = ov.carryover; row.carryNote = ov.note || '手動で入力した値'; row.provisional = false; }
  if (Number.isFinite(ov.salesEst)) { row.salesEst = ov.salesEst; row.salesNote = ov.note || '手動で入力した値'; }
}

/**
 * 1つのくじについて、表示と計算に必要なものをまとめる。
 * manualSpecial は data/overrides.json の big777 など（特別開催回を手で決める場所）
 */
export function computeGame(def, st, now, override, manualSpecial) {
  let status;
  if (def.model === 'fixed') status = fixedStatus(def, now);
  else if (def.model === 'none') status = { kind: 'other', text: def.drawLabel || '', deadline: '', label: '' };
  else if (def.drawDays) status = drawStatus(def, st, now);
  else status = roundStatus(def, st, now);

  const row = { id: def.id, def, status, ...salesEstimate(def, st, status), ...carryoverOf(def, st, status) };
  applyOverride(row, override, now.iso);

  // 特別開催回（BIG777）なら、1等の上限を引き上げて計算する
  row.special = def.special && status.o?.round ? specialOf(def, status.o.round, st, manualSpecial) : null;
  const calc = withSpecialCap(def, row.special);
  row.calcDef = calc;

  const ev = evaluate(calc, { salesEst: row.salesEst, carryover: row.carryover });
  row.ev = ev;
  row.computable = !!ev.computable;
  row.rate = ev.computable ? ev.rate : null;
  row.maxRate = def.model === 'parimutuel' && row.salesEst ? maxRate(calc, row.salesEst) : null;
  row.hasCO = !!def.carryover;
  const topTier = calc.tiers?.find((t) => t.top);
  row.capNormal = topTier?.capNormal ?? null;
  row.capCO = topTier?.capCO ?? null;
  if (row.special?.on) row.capText = `${def.special.capText}（${def.special.name}）`;
  else row.capText = row.capCO ? `${capLabel(row.capNormal)}（繰越時${capLabel(row.capCO)}）` : row.capNormal ? capLabel(row.capNormal) : '';
  row.listed = row.computable && !['upcoming', 'ended'].includes(status.kind);
  return row;
}

export function computeAll(defs, state, now, overrides = {}) {
  return Object.values(defs).map((def) => computeGame(def, state.games?.[def.id], now, overrides.games?.[def.id], def.special ? overrides[def.special.id] : undefined));
}

/**
 * 繰越額を変えたときの還元率（くじ別ページの表用）。
 * 1等を1人で当てたときの当せん金が上限に届く繰越額（threshold）で表を止める。
 */
export function carryoverTable(def, salesEst, currentCO = 0) {
  const top = def.tiers?.find((t) => t.top);
  if (def.model !== 'parimutuel' || !top?.capCO || !salesEst) return null;
  const base = evaluate(def, { salesEst, carryover: 0 });
  const pool0 = base.top.pool; // 繰越がないときの1等の原資（販売額×1等の配分）
  const threshold = Math.max(1, Math.ceil(top.capCO - pool0));
  const unit = threshold >= 2e8 ? 1e7 : threshold >= 2e7 ? 1e6 : 1e5;
  const steps = new Set([0, threshold]);
  for (const k of [0.25, 0.5, 0.75]) steps.add(Math.round((threshold * k) / unit) * unit);
  if (currentCO > 0 && currentCO < threshold) steps.add(Math.round(currentCO));
  const rows = [...steps].filter((c) => c >= 0 && c <= threshold).sort((a, b) => a - b).map((c) => {
    const r = evaluate(def, { salesEst, carryover: c });
    const cap = c > 0 ? top.capCO : top.capNormal;
    return {
      carryover: c,
      rate: r.rate,
      lonePrize: Math.min(cap, pool0 + c), // 1人で当たった場合の1等の当せん金
      current: currentCO > 0 && Math.round(currentCO) === c,
      atCap: c === threshold,
    };
  });
  return { rows, threshold, capNormal: top.capNormal, capCO: top.capCO, pool0, currentAbove: currentCO >= threshold };
}

/**
 * 還元率の推移。記録した日ごとの値（history）に、公開前の期間を公式データから計算し直した値を足す。
 *   ロト：前の回の繰越額と、その回の実際の販売実績額から、その回までの日の還元率を出す
 *   BIG系・DUNK：前の回の繰越額と、その回の売上金額から、販売期間中の還元率を出す（BIG777 の回は上限を引き上げて計算）
 */
export function rateSeries(def, st, historyDays = {}, manualSpecial) {
  const pts = new Map();
  const addDays = (from, to, v) => {
    if (!from || !to || !Number.isFinite(v)) return;
    let d = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let i = 0; d <= end && i < 120; i++) {
      pts.set(d.toISOString().slice(0, 10), { v, calc: true });
      d = new Date(d.getTime() + 86400000);
    }
  };
  if (def.model === 'parimutuel') {
    const draws = [...(st?.draws || [])].sort((a, b) => a.round - b.round);
    for (let i = 1; i < draws.length; i++) {
      const prev = draws[i - 1], cur = draws[i];
      if (cur.round !== prev.round + 1 || !(cur.sales > 0)) continue;
      const next = new Date(`${prev.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      addDays(next.toISOString().slice(0, 10), cur.date, evaluate(def, { salesEst: cur.sales, carryover: prev.carryover || 0 }).rate);
    }
    const results = [...(st?.results || [])].sort((a, b) => a.round - b.round);
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1], cur = results[i];
      if (!(cur.sales > 0) || !cur.salesStart) continue;
      const calc = def.special ? withSpecialCap(def, specialOf(def, cur.round, st, manualSpecial)) : def;
      addDays(cur.salesStart, cur.salesEnd || cur.salesStart, evaluate(calc, { salesEst: cur.sales, carryover: prev.carryoverOut || 0 }).rate);
    }
  }
  for (const [d, rec] of Object.entries(historyDays)) {
    if (Number.isFinite(rec?.[def.id])) pts.set(d, { v: rec[def.id], calc: false });
  }
  return [...pts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, x]) => ({ d, ...x }));
}

/** 「今日の一言」用：1位と、繰越が出ているくじ */
export function summaryLine(rows) {
  const list = rows.filter((r) => r.listed).sort((a, b) => b.rate - a.rate);
  const co = list.filter((r) => r.hasCO && r.carryover > 0);
  return { best: list[0], second: list[1], co };
}

export { man };
