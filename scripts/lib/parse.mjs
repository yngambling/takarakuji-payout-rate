// 公式サイトの HTML / CSV から数値を取り出すパーサー（外部ライブラリなし）
//
// 取得元
//   ロト6・ロト7 : みずほ銀行が公開している当せん番号 CSV（Shift_JIS）
//   BIG 系・DUNK : スポーツくじオフィシャルサイト（store.toto-dream.com）の「くじ情報」「くじ結果」ページ
//
// HTML の細かい構造に依存しないよう、いったんテキストに直してから
// 「見出し → その後ろの数値」という並びで読み取る。

/** 全角英数・全角括弧などを半角にそろえる */
export function normalize(s) {
  return String(s ?? '').normalize('NFKC').replace(/ /g, ' ');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥', copy: '©', times: '×' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/**
 * HTML → 行単位のテキスト
 *   ・表のセルは " | " で区切り、行（tr）やブロック要素は改行にする
 *   ・画像は alt テキストに置き換える（くじ名がロゴ画像のことがあるため）
 */
export function htmlToText(html) {
  let s = String(html ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const alt = m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
    return alt ? ` ${alt} ` : ' ';
  });
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(td|th)\s*>/gi, ' | ');
  s = s.replace(/<\/?(p|div|h[1-6]|li|tr|table|thead|tbody|tfoot|section|article|header|footer|ul|ol|dl|dt|dd|form|nav|main|aside|caption)\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = normalize(s);
  s = s.replace(/[ \t\r\f\v]+/g, ' ');
  return s
    .split('\n')
    .map((l) => l.trim().replace(/^\|\s*/, '').replace(/\s*\|$/, ''))
    .filter((l) => l && l !== '|')
    .join('\n');
}

/** "1,234,567円" → 1234567（数字が無ければ null） */
export function toInt(s) {
  const d = String(s ?? '').replace(/[^\d]/g, '');
  return d ? parseInt(d, 10) : null;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * テキスト中の日付をすべて取り出す（出現順）
 *   2026年10月10日 / 令和8年10月8日 / 10月03日（年なし → 直前の日付の年を引き継ぐ）
 * 戻り値: [{ iso, index, end }]
 */
export function findDates(text, defaultYear = null) {
  const re = /(?:(令和|平成)?\s*(\d{1,4}|元)\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
  const out = [];
  let lastY = defaultYear;
  let lastM = null;
  for (const m of String(text).matchAll(re)) {
    let y = null;
    if (m[2] != null) {
      const n = m[2] === '元' ? 1 : parseInt(m[2], 10);
      if (m[1] === '令和') y = 2018 + n;
      else if (m[1] === '平成') y = 1988 + n;
      else if (n >= 1900) y = n;
      else if (n < 100) y = 2018 + n; // 「8年」だけの表記は令和とみなす
    }
    const mo = parseInt(m[3], 10);
    const d = parseInt(m[4], 10);
    if (y == null) {
      if (lastY == null) continue;
      y = lastY;
      if (lastM != null && mo < lastM) y += 1; // 12月 → 1月 の年越し
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    lastY = y;
    lastM = mo;
    out.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, index: m.index, end: m.index + m[0].length });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* みずほ銀行 CSV（ロト6・ロト7）                                       */
/* ------------------------------------------------------------------ */

/** name.txt から CSV ファイル名の一覧（新しい順）を取り出す */
export function parseMizuhoNameList(text) {
  return [...String(text).matchAll(/A\d{3,4}\d+\.CSV/gi)].map((m) => m[0]);
}

/**
 * 当せん番号 CSV を読む。
 * 1行目: 識別記号 / 2行目: 第N回…,名称,和暦の抽せん日,抽せん会場
 * 「1等,1口,200000000円」のような等級行、「キャリーオーバー,388848円」「販売実績額,1270263600円」
 */
export function parseMizuhoCsv(text) {
  const rows = normalize(text)
    .split(/\r?\n/)
    .map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  const out = { round: null, date: null, sales: null, carryover: null, tiers: [], numbers: null, bonus: null };
  for (const cells of rows) {
    const c0 = cells[0] || '';
    if (out.round == null) {
      const m = c0.match(/第\s*(\d+)\s*回/);
      if (m) {
        out.round = parseInt(m[1], 10);
        const ds = findDates(cells.slice(1).join(' '));
        if (ds.length) out.date = ds[0].iso;
        continue;
      }
    }
    if (c0 === '本数字') {
      const bi = cells.findIndex((c) => c.includes('ボーナス'));
      const main = bi > 0 ? cells.slice(1, bi) : cells.slice(1);
      out.numbers = main.filter((x) => /^\d+$/.test(x)).map(Number);
      if (bi > 0) out.bonus = cells.slice(bi + 1).filter((x) => /^\d+$/.test(x)).map(Number);
      continue;
    }
    const tm = c0.match(/^(\d)\s*等$/);
    if (tm && cells.length >= 2 && (/\d\s*口/.test(cells[1]) || /該当なし/.test(cells[1]))) {
      const none = /該当なし/.test(cells[1]);
      out.tiers.push({
        tier: parseInt(tm[1], 10),
        winners: none ? 0 : toInt(cells[1]) ?? 0,
        prize: none || !/\d/.test(cells[2] || '') ? 0 : toInt(cells[2]),
      });
      continue;
    }
    if (/キャリーオーバー/.test(c0)) out.carryover = /\d/.test(cells[1] || '') ? toInt(cells[1]) : 0;
    else if (/販売実績額/.test(c0)) out.sales = toInt(cells[1] || '');
  }
  out.tiers.sort((a, b) => a.tier - b.tier);
  return out;
}

/* ------------------------------------------------------------------ */
/* スポーツくじ（BIG 系・DUNK）                                         */
/* ------------------------------------------------------------------ */

export const BIG_PRODUCTS = [
  { id: 'megabig', re: /^MEGA\s*BIG$/i },
  { id: 'big100', re: /^100円\s*BIG$/i },
  { id: 'big1000', re: /^BIG\s*1000$/i },
  { id: 'minibig', re: /^mini\s*BIG$/i },
  { id: 'big', re: /^BIG$/i },
];
const BIG_LABEL = '(MEGA\\s*BIG|100円\\s*BIG|BIG\\s*1000|mini\\s*BIG|BIG)';

export const DUNK_PRODUCTS = [
  { id: 'dunk10', re: /^DUNK\s*10$/i },
  { id: 'dunk6a', re: /^DUNK\s*6\s*[-‐‑–—−]\s*A$/i },
  { id: 'dunk6b', re: /^DUNK\s*6\s*[-‐‑–—−]\s*B$/i },
];
const DUNK_LABEL = '(DUNK\\s*10|DUNK\\s*6\\s*[-‐‑–—−]\\s*A|DUNK\\s*6\\s*[-‐‑–—−]\\s*B)';

function productIdOf(label, list) {
  const l = normalize(label).trim();
  for (const p of list) if (p.re.test(l)) return p.id;
  return null;
}

/** 結果一覧ページから開催回 ID（holdCntId）を新しい順に */
export function parseHoldCntIds(html) {
  const ids = [...String(html).matchAll(/holdCntId=(\d+)/g)].map((m) => m[1]);
  return [...new Set(ids)].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
}

const AMT = '(?:([\\d,]+)\\s*円|(-|該当なし))';
const CNT = '(?:([\\d,]+)\\s*口|(-|該当なし))';
const TIER_RE = new RegExp(`(\\d)\\s*等[\\s|]*${AMT}[\\s|]*${CNT}(?:[\\s|]*([\\d,]+)\\s*円)?`, 'g');

/** 「1等 | 600,000,000円 | 1口 | 5,001,651,420円」の並びを読む（最後の列は次回への繰越金） */
export function parseTierRows(body) {
  const tiers = new Map();
  for (const m of String(body).matchAll(TIER_RE)) {
    const tier = parseInt(m[1], 10);
    if (tiers.has(tier)) continue;
    tiers.set(tier, {
      tier,
      prize: m[2] != null ? toInt(m[2]) : 0,
      winners: m[4] != null ? toInt(m[4]) : 0,
      carry: m[6] != null ? toInt(m[6]) : null,
    });
  }
  return [...tiers.values()].sort((a, b) => a.tier - b.tier);
}

/** 「売上金額 | 投票口数 | 投票枚数」の値（円・口・枚の並び） */
export function parseSalesTriple(body) {
  const m = String(body).match(/([\d,]+)\s*円[\s|]*([\d,]+)\s*口[\s|]*([\d,]+)\s*枚/);
  return m ? { sales: toInt(m[1]), units: toInt(m[2]), sheets: toInt(m[3]) } : null;
}

/** 販売開始日・販売終了日・結果発表日（「販売開始日」という語の後ろに出てくる順） */
export function parseSchedule(body) {
  const s = String(body);
  let i = s.indexOf('販売開始日');
  if (i < 0) i = s.indexOf('販売期間');
  if (i < 0) return {};
  const seg = s.slice(i, i + 1500);
  const ds = findDates(seg);
  const timeAfter = (d) => {
    if (!d) return null;
    const tail = seg.slice(d.end, d.end + 90);
    const m = tail.match(/(\d{1,2}):(\d{2})/);
    return m ? `${pad(m[1])}:${m[2]}` : null;
  };
  return {
    salesStart: ds[0]?.iso ?? null,
    salesStartTime: timeAfter(ds[0]),
    salesEnd: ds[1]?.iso ?? null,
    salesEndTime: timeAfter(ds[1]),
    resultDate: ds[2]?.iso ?? null,
  };
}

function amountOrDash(s) {
  if (s == null) return undefined;
  return /^-$/.test(s.trim()) ? null : toInt(s);
}

/** くじ情報ページの1ブロック（販売中の回）を読む */
export function parseInfoBlock(body) {
  const b = String(body);
  const sched = parseSchedule(b);
  const co = b.match(/キャリーオーバー\)?[\s|:]*(-|[\d,]+\s*円)/);
  let pool;
  for (const m of b.matchAll(/1等配当金総額(?:とは)?[\s|:]*(-|[\d,]+\s*円)/g)) {
    pool = amountOrDash(m[1]);
    break;
  }
  let salesSoFar = null;
  const sm = b.match(/売上金額[\s|:]*([\d,]+)\s*円/);
  if (sm) salesSoFar = toInt(sm[1]);
  else salesSoFar = parseSalesTriple(b)?.sales ?? null;
  const at = b.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(?:\(.\))?\s*(\d{1,2})時\s*(\d{1,2})分\s*時点/);
  return {
    ...sched,
    salesSoFar,
    carryoverIn: co ? amountOrDash(co[1]) : undefined,
    firstPool: pool,
    asOf: at ? `${at[1]}-${pad(at[2])}-${pad(at[3])}T${pad(at[4])}:${pad(at[5])}:00+09:00` : null,
  };
}

/** 見出しで区切ったブロック（同じくじの見出しが複数あれば、中身の多い方を使う） */
function sectionsBy(text, headRe, list, scoreFn) {
  const hits = [...text.matchAll(headRe)];
  const best = {};
  hits.forEach((m, i) => {
    const id = productIdOf(m[2], list);
    if (!id) return;
    const body = text.slice(m.index + m[0].length, i + 1 < hits.length ? hits[i + 1].index : undefined);
    const score = scoreFn(body);
    if (!best[id] || score > best[id].score) best[id] = { round: parseInt(m[1], 10), body, score };
  });
  return best;
}

const resultScore = (body) => (/くじ販売なし/.test(body) ? -1 : parseTierRows(body).length * 2 + (parseSalesTriple(body) ? 3 : 0));
const infoScore = (body) => {
  const x = parseInfoBlock(body);
  return (x.salesStart ? 2 : 0) + (x.salesEnd ? 2 : 0) + (x.salesSoFar != null ? 2 : 0) + (x.carryoverIn !== undefined ? 1 : 0);
};

function resultFromBody(round, body) {
  if (/くじ販売なし/.test(body)) return null;
  const tiers = parseTierRows(body);
  const sales = parseSalesTriple(body);
  if (!tiers.length || !sales) return null;
  const top = tiers.find((t) => t.tier === 1);
  return {
    round,
    ...parseSchedule(body),
    sales: sales.sales,
    units: sales.units,
    tiers: tiers.map(({ tier, prize, winners }) => ({ tier, prize, winners })),
    carryoverOut: top?.carry ?? 0,
  };
}

/** BIG 系「くじ結果」詳細ページ → { big: {...}, megabig: {...}, ... } */
export function parseBigResult(html) {
  const text = htmlToText(html);
  const secs = sectionsBy(text, new RegExp(`第\\s*(\\d+)\\s*回\\s*${BIG_LABEL}\\s*くじ結果`, 'gi'), BIG_PRODUCTS, resultScore);
  const out = {};
  for (const [id, s] of Object.entries(secs)) {
    const r = resultFromBody(s.round, s.body);
    if (r) out[id] = r;
  }
  return out;
}

/** BIG 系「くじ情報」（販売中の回）ページ → { big: {round, salesStart, ...}, ... } */
export function parseBigInfo(html) {
  const text = htmlToText(html);
  const secs = sectionsBy(text, new RegExp(`第\\s*(\\d+)\\s*回\\s*${BIG_LABEL}\\s*くじ情報`, 'gi'), BIG_PRODUCTS, infoScore);
  const out = {};
  for (const [id, s] of Object.entries(secs)) {
    const x = parseInfoBlock(s.body);
    if (s.score > 0) out[id] = { round: s.round, ...x };
  }
  return out;
}

/** DUNK「くじ結果」詳細ページ（見出しは「第2回DUNK10」のように空白なし） */
export function parseDunkResult(html) {
  const text = htmlToText(html);
  const secs = sectionsBy(text, new RegExp(`第\\s*(\\d+)\\s*回\\s*${DUNK_LABEL}`, 'gi'), DUNK_PRODUCTS, resultScore);
  const out = {};
  for (const [id, s] of Object.entries(secs)) {
    const r = resultFromBody(s.round, s.body);
    if (r) out[id] = r;
  }
  return out;
}

/** DUNK「くじ情報」ページ：「くじ情報 第6回」の下に DUNK10 / DUNK6-A / DUNK6-B の見出しが並ぶ */
export function parseDunkInfo(html) {
  const text = htmlToText(html);
  const head = text.match(/くじ情報[\s|]*第\s*(\d+)\s*回/) || text.match(/第\s*(\d+)\s*回[\s|]*くじ情報/);
  if (!head) return {};
  const round = parseInt(head[1], 10);
  const after = text.slice(head.index + head[0].length);
  // くじ名が本文中（「DUNK10の1等配当金総額とは」など）に再び出てきても、
  // 同じくじの断片をつなぎ合わせて読むので取りこぼさない
  const hits = [...after.matchAll(new RegExp(DUNK_LABEL, 'gi'))];
  const bodies = {};
  hits.forEach((m, i) => {
    const id = productIdOf(m[1], DUNK_PRODUCTS);
    if (!id) return;
    const body = after.slice(m.index + m[0].length, i + 1 < hits.length ? hits[i + 1].index : undefined);
    bodies[id] = (bodies[id] ? bodies[id] + '\n' : '') + body;
  });
  const out = {};
  for (const [id, body] of Object.entries(bodies)) {
    if (infoScore(body) > 0) out[id] = { round, ...parseInfoBlock(body) };
  }
  return out;
}
