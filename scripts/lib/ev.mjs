// 期待値エンジン
// 売上の一定割合を当せん者で山分けする「パリミュチュエル方式」のくじについて、
//   ・キャリーオーバー
//   ・1口あたりの当せん金の上限
//   ・同じ等級の当せん者との山分け（当せん口数はポアソン分布で近似）
// を考慮し、「1口買ったときに戻ってくる金額の平均（期待値）」を求める。
// 外部ライブラリは使わない。

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log Γ(x)（Lanczos 近似） */
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(W ≤ k), W ~ Poisson(lambda) */
export function poissonCdf(k, lambda) {
  if (k < 0) return 0;
  if (!(lambda > 0)) return 1;
  const sd = Math.sqrt(lambda);
  if (k >= lambda + 40 * sd + 60) return 1;
  const lo = Math.max(0, Math.floor(lambda - 40 * sd - 60));
  if (k < lo) return 0;
  const logL = Math.log(lambda);
  let logp = -lambda + lo * logL - lgamma(lo + 1);
  let sum = 0;
  for (let i = lo; i <= k; i++) {
    sum += Math.exp(logp);
    logp += logL - Math.log(i + 1);
  }
  return Math.min(1, sum);
}

/**
 * 自分が当せんしたときの受取額の平均  E[ min(cap, pool / (1 + W)) ]
 *   pool   : その等級の原資（円）
 *   lambda : 自分以外の当せん口数の平均（= 他の購入口数 × 当せん確率）
 *   cap    : 1口あたりの上限（なければ Infinity）
 * 恒等式 Σ_{k>K} P(W=k)/(k+1) = P(W ≥ K+2) / lambda を使って閉じた形で計算する。
 */
export function expectedShare(pool, lambda, cap = Infinity) {
  if (!(pool > 0)) return 0;
  if (!(lambda > 1e-12)) return Math.min(pool, cap);
  const uncapped = (pool * -Math.expm1(-lambda)) / lambda;
  if (!Number.isFinite(cap) || pool <= cap) return uncapped;
  const K = Math.floor(pool / cap - 1); // W ≤ K なら上限で頭打ち
  return cap * poissonCdf(K, lambda) + (pool * (1 - poissonCdf(K + 1, lambda))) / lambda;
}

/** ビンゴ5：中央FREEを除く8マス（各5択）で、成立ライン数ごとの組合せ数（全 5^8 通り） */
export function bingo5Counts() {
  const cells = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]];
  const lines = [
    [[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2]], [[2, 0], [2, 1], [2, 2]],
    [[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 1], [2, 1]], [[0, 2], [1, 2], [2, 2]],
    [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]],
  ];
  const out = {};
  for (let mask = 0; mask < 256; mask++) {
    const hit = new Set(['1,1']);
    let matched = 0;
    cells.forEach((c, i) => {
      if ((mask >> i) & 1) { hit.add(c.join(',')); matched++; }
    });
    const n = lines.filter((l) => l.every((c) => hit.has(c.join(',')))).length;
    out[n] = (out[n] || 0) + 4 ** (8 - matched); // はずれのマスは残り4通り
  }
  return out;
}

/** 定義ファイルの等級から、確率 p と「売上に対する原資の割合」alpha を求める */
export function prepareGame(def) {
  const g = structuredClone(def);
  if (g.countsFrom === 'bingo5') {
    const c = bingo5Counts();
    for (const t of g.tiers) t.count = c[t.lines] || 0;
  }
  if (g.model === 'parimutuel' || g.model === 'theoretical') {
    for (const t of g.tiers) {
      t.p = t.count / g.combos;
      if (t.fixed != null) {
        t.theo = t.fixed;
        t.alpha = (t.p * t.fixed) / g.price;
      } else if (t.share != null) {
        t.alpha = g.payoutRate * t.share;
        t.theo = (t.alpha * g.price) / t.p;
      } else {
        t.alpha = (t.p * t.theo) / g.price;
      }
    }
  }
  if (g.model === 'numbers') {
    for (const t of g.types) {
      for (const h of t.hits) h.p = h.count / g.combos;
      t.p = t.hits.reduce((s, h) => s + h.p, 0);
      t.ev = t.hits.reduce((s, h) => s + h.p * h.prize, 0);
    }
  }
  return g;
}

/**
 * 1ゲームの期待値を計算する。
 * st: { salesEst: 推定販売額(円), carryover: 繰越額(円) }
 */
export function evaluate(def, st = {}) {
  const g = prepareGame(def);
  const base = { id: g.id, name: g.name, price: g.price, model: g.model };

  if (g.model === 'none') return { ...base, computable: false };

  if (g.model === 'fixed') {
    const rows = g.tiers.map((t) => {
      const p = t.count / g.totalTickets;
      return { name: t.name, cond: t.cond || '', p, count: t.count, expected: t.prize, theo: t.prize, contrib: p * t.prize };
    });
    const ev = rows.reduce((s, r) => s + r.contrib, 0);
    return { ...base, computable: true, ev, rate: ev / g.price, rows, top: rows[0], fixedPrize: true };
  }

  if (g.model === 'numbers') {
    const rows = g.types.map((t) => ({ name: t.name, cond: t.cond, p: t.p, hits: t.hits, contrib: t.ev }));
    const ev = rows[0].contrib; // どの申込タイプでもほぼ同じ（ストレートを代表値にする）
    return { ...base, computable: true, ev, rate: ev / g.price, rows, numbers: true };
  }

  if (g.model === 'theoretical') {
    const rows = g.tiers.map((t) => ({
      name: t.name, cond: t.cond, p: t.p, count: t.count, theo: t.theo, expected: t.theo,
      fixed: t.fixed != null, contrib: t.p * t.theo,
    }));
    const ev = rows.reduce((s, r) => s + r.contrib, 0);
    return { ...base, computable: true, ev, rate: ev / g.price, rows, top: rows[0] };
  }

  // parimutuel
  const S = Number(st.salesEst) || 0;
  if (!(S > 0)) return { ...base, computable: false, reason: '販売額のデータがありません' };
  const N = S / g.price;
  const C = Math.max(0, Number(st.carryover) || 0);
  const rows = g.tiers.map((t) => {
    const lambda = N * t.p;
    if (t.fixed != null) {
      return { name: t.name, cond: t.cond, p: t.p, count: t.count, theo: t.fixed, expected: t.fixed, fixed: true, lambda, contrib: t.p * t.fixed };
    }
    const pool = t.alpha * S + (t.top ? C : 0);
    const cap = t.top ? ((C > 0 ? t.capCO : t.capNormal) ?? Infinity) : (t.cap ?? Infinity);
    const expected = expectedShare(pool, lambda, cap);
    return { name: t.name, cond: t.cond, p: t.p, count: t.count, theo: t.theo, pool, cap, lambda, expected, contrib: t.p * expected, top: !!t.top };
  });
  const ev = rows.reduce((s, r) => s + r.contrib, 0);
  const top = rows.find((r) => r.top) || rows[0];
  // 参考：山分けを考えない（自分だけが当せんする）と仮定した場合
  const naive = rows.reduce((s, r) => {
    if (r.fixed) return s + r.contrib;
    const prize = r.top ? Math.min(r.pool, r.cap) : r.theo;
    return s + r.p * prize;
  }, 0);
  return {
    ...base, computable: true, ev, rate: ev / g.price, rows, top, naiveRate: naive / g.price,
    salesEst: S, tickets: N, carryover: C,
    capNow: top.cap, capNormal: g.tiers.find((t) => t.top)?.capNormal ?? null,
    capCO: g.tiers.find((t) => t.top)?.capCO ?? null,
    capBound: Number.isFinite(top.cap) && top.pool > top.cap * 2,
  };
}

/** キャリーオーバーが無限に大きくても超えられない還元率（1等が上限で頭打ちになるため） */
export function maxRate(def, salesEst) {
  const g = prepareGame(def);
  if (g.model !== 'parimutuel') return null;
  const top = g.tiers.find((t) => t.top);
  if (!top || !Number.isFinite(top.capCO)) return null;
  const r = evaluate(def, { salesEst, carryover: top.capCO * 1000 });
  return r.computable ? r.rate : null;
}
