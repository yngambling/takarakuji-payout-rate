// 「最近の結果とキャリーオーバーの動き」に載せる1件分（くじごと・回ごと）

export const NAMES = {
  loto6: 'ロト6', loto7: 'ロト7', big: 'BIG', megabig: 'MEGA BIG', big100: '100円BIG',
  big1000: 'BIG1000', minibig: 'mini BIG', dunk10: 'DUNK10', dunk6a: 'DUNK6-A', dunk6b: 'DUNK6-B',
};

/**
 * r: ロトの抽せん結果 { round, date, tiers, carryover }
 *    またはスポーツくじの結果 { round, resultDate, tiers, carryoverOut }
 */
export function resultEntry(game, r, fallbackDate = null) {
  const t1 = r.tiers?.find((t) => t.tier === 1);
  return {
    key: `${game}-${r.round}`,
    date: r.date || r.resultDate || fallbackDate,
    game,
    round: r.round,
    firstWinners: t1 ? t1.winners : null,
    firstPrize: t1 ? t1.prize : null,
    carryover: r.carryover ?? r.carryoverOut ?? 0,
  };
}
