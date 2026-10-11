// 特別開催回（BIG777）の判定
//
// BIG は「毎月7日を含む週」の回だけ、1等の上限がキャリーオーバーの有無にかかわらず
// 7億7万7千円に上がる（日本スポーツ振興センターの発表）。どの回が対象になるかは細かく
// 公表されていないので、過去の当せん金と合う決め方にしている。
//   ・週は日曜〜土曜で数え、その週に販売が終わる回を対象にする
//     （2026年6月は 6/6 締切の第1633回の1等が6億円ちょうどで、対象外だった）
//   ・その週に販売が終わる回が2つ以上あるときは、最後に販売が終わる回
//     （2026年3月 第1614回・4月 第1621回・8月 第1644回・10月 第1660回が、週の最後に締め切る回だった）
// 判定の順番：手で決めた回（data/overrides.json の big777）→ 実際の1等の当せん金 → 日付の決まり

import { weekdayOf } from './util.mjs';

const DAY = 86400000;
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
export const addDaysIso = (iso, k) => isoOf(Date.parse(`${iso}T00:00:00Z`) + k * DAY);

/** その月の7日を含む週（日曜〜土曜）。d は 'YYYY-MM-DD' */
export function weekWith7(d) {
  const y = +d.slice(0, 4);
  const m = +d.slice(5, 7);
  const t7 = Date.UTC(y, m - 1, 7);
  const w = new Date(t7).getUTCDay();
  return { from: isoOf(t7 - w * DAY), to: isoOf(t7 + (6 - w) * DAY), month: d.slice(0, 7) };
}

/** 分かっている回（結果・販売中・次の回）を、回の番号の順に並べる */
export function knownRounds(st) {
  const map = new Map();
  for (const r of st?.results || []) {
    if (r?.round) map.set(r.round, { round: r.round, salesStart: r.salesStart || null, salesEnd: r.salesEnd || null, result: r });
  }
  for (const o of [st?.onSale, st?.nextSale]) {
    if (!o?.round) continue;
    const cur = map.get(o.round);
    map.set(o.round, { round: o.round, salesStart: o.salesStart || cur?.salesStart || null, salesEnd: o.salesEnd || cur?.salesEnd || null, result: cur?.result || null });
  }
  return [...map.values()].sort((a, b) => a.round - b.round);
}

/** 実際の1等の当せん金から分かること：通常の上限を超えていれば対象、通常の上限ちょうどなら対象外、それ以外は分からない（null） */
export function payoutVerdict(def, result) {
  const t1 = result?.tiers?.find((t) => t.tier === 1);
  const capCO = def?.tiers?.find((t) => t.top)?.capCO;
  if (!def?.special || !t1 || !(t1.winners > 0) || !(t1.prize > 0) || !Number.isFinite(capCO)) return null;
  if (t1.prize > capCO) return true;
  if (t1.prize === capCO) return false;
  return null;
}

/**
 * 日付の決まり：7日を含む週（日〜土）に販売が終わる回のうち、最後に販売が終わる回。
 * 次の回がまだ分からず、この回が週の途中（日〜木）に締め切るときは、あとから同じ週に締め切る回が
 * 出てくるかもしれないので「未確定」（sure: false）にして、通常の回として扱う。
 */
export function ruleVerdict(rounds, round) {
  const i = rounds.findIndex((r) => r.round === round);
  const me = rounds[i];
  if (!me?.salesEnd) return { on: false, sure: false };
  const w = weekWith7(me.salesEnd);
  if (me.salesEnd < w.from || me.salesEnd > w.to) return { on: false, sure: true };
  const next = rounds.slice(i + 1).find((r) => r.salesEnd);
  if (next) return { on: next.salesEnd > w.to, sure: true };
  return weekdayOf(me.salesEnd) >= 5 ? { on: true, sure: true } : { on: false, sure: false };
}

/**
 * ある回が特別開催回かどうか。def.special がないくじは null。
 * 戻り値：{ on, sure, why: 'manual' | 'payout' | 'rule', round, week, name, cap, capText }
 */
export function specialOf(def, round, st, manual = {}) {
  const sp = def?.special;
  if (!sp || !round) return null;
  const rounds = knownRounds(st);
  const me = rounds.find((r) => r.round === round);
  const base = { round, name: sp.name, cap: sp.cap, capText: sp.capText, week: me?.salesEnd ? weekWith7(me.salesEnd) : null };
  const has = (k) => (manual?.[k] || []).map(Number).includes(round);
  if (has('add')) return { ...base, on: true, sure: true, why: 'manual' };
  if (has('remove')) return { ...base, on: false, sure: true, why: 'manual' };
  const paid = payoutVerdict(def, me?.result);
  if (paid !== null) return { ...base, on: paid, sure: true, why: 'payout' };
  return { ...base, ...ruleVerdict(rounds, round), why: 'rule' };
}

/** 特別開催回なら、1等の上限をキャリーオーバーの有無にかかわらず引き上げた定義を返す */
export function withSpecialCap(def, sp) {
  if (!sp?.on || !def?.tiers) return def;
  return { ...def, tiers: def.tiers.map((t) => (t.top ? { ...t, capNormal: sp.cap, capCO: sp.cap } : t)) };
}
