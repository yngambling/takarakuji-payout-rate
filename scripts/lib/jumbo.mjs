// ジャンボ宝くじの自動登録（watch.mjs が1日1回使う、通信しない部分）
//   1. 宝くじ公式サイトの「宝ニュース」の一覧から、ジャンボ宝くじ等のお知らせを選ぶ（parseNewsList）
//   2. お知らせの「〇〇の当せん金・本数」の表と、発売期間・抽せん日・発売価格を読み取る（parseJumboNews）
//   3. 検算する（checkJumbo）。すべて通ったものだけ、data/games.json に足す・直す（planJumbo）
//   4. 発売中なのに登録されていないジャンボがないか、「ジャンボ宝くじ等の普通くじ」のページで確かめる（parseOnSale）
// 自動で載せた賞金表は、ページに「確認待ち」の注記を出し、Issue で公式発表との見比べをお願いする。
// Issue が閉じられたら確認済みとして、注記を外す（verify を消す）。

import { createHash } from 'node:crypto';
import { htmlToText, findDates, normalize, decodeEntities } from './parse.mjs';
import { fmtMd, fmtYmd, num, yen, man, pct, addDays } from './util.mjs';
import { HOW_TO_FIX } from './alerts.mjs';

export const ORIGIN = 'https://www.takarakuji-official.jp';
export const NEWS_LIST_URL = `${ORIGIN}/news/top.html`;
export const ONSALE_URL = `${ORIGIN}/kuji/jumbo/`;
/** 見張りで何日続けて「宝ニュース」を読めなかったら知らせるか */
export const NEWS_DOWN_DAYS = 3;

const pad = (n) => String(n).padStart(2, '0');
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ymd = (iso) => (isDate(iso) ? `${+iso.slice(0, 4)}年${+iso.slice(5, 7)}月${+iso.slice(8, 10)}日` : '');
const slash = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
const nameKey = (s) => normalize(s).replace(/\s/g, '');
const manNoYen = (n) => man(n).replace(/円$/, '');

/** 「第1126回全国自治宝くじ」→ 1126 */
export const roundNo = (s) => {
  const m = String(s ?? '').match(/第\s*(\d+)\s*回/);
  return m ? Number(m[1]) : null;
};

/** 「1,380億」「2,000万」「200,000,000円」「1億5,000万円」「12本」→ 数（読めなければ null） */
export function jpNumber(s) {
  const t = normalize(s).replace(/[,\s]/g, '').replace(/[円枚本]$/, '');
  const m = t.match(/^(?:(\d+(?:\.\d+)?)兆)?(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)万)?(\d+)?$/);
  if (!t || !m || m.slice(1).every((x) => x == null)) return null;
  return Math.round(Number(m[1] || 0) * 1e12 + Number(m[2] || 0) * 1e8 + Number(m[3] || 0) * 1e4 + Number(m[4] || 0));
}

/** 当せん確率の言い方：10,000,000 → 「1,000万分の1」 */
export function oddsJa(inv) {
  const r = Math.round(inv);
  return r >= 10000 && r % 10000 === 0 ? `${num(r / 10000)}万分の1` : `${num(r)}分の1`;
}

/* ---------------- 宝ニュースの一覧 ---------------- */

/**
 * 宝ニュースの一覧ページ → [{ id, url, label, title, date }]（ページの並び＝新しい順）
 * label はお知らせの種類（「ジャンボ宝くじ等」「スクラッチ」など）
 */
export function parseNewsList(html) {
  const items = new Map();
  for (const m of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*?newsId=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, id, inner] = m;
    const label = [...inner.matchAll(/<span\b[^>]*class\s*=\s*"[^"]*\bm_label\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)].map((x) => htmlToText(x[1])).join(' ').trim();
    const alt = normalize(decodeEntities((inner.match(/\balt\s*=\s*"([^"]*)"/i) || [])[1] || '')).trim();
    const lines = htmlToText(inner.replace(/<img\b[^>]*>/gi, ' ')).split('\n').map((l) => l.trim()).filter(Boolean);
    const dm = lines.join(' ').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    const longest = lines.filter((l) => !/^\d{4}\/\d/.test(l) && l !== label).sort((a, b) => b.length - a.length)[0] || '';
    const item = {
      id,
      url: new URL(decodeEntities(href), ORIGIN).href,
      label,
      title: alt || longest.replace(/\.\.\.$|…$/, ''),
      date: dm ? `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}` : null,
    };
    const old = items.get(id);
    items.set(id, old ? { ...old, label: old.label || item.label, title: old.title || item.title, date: old.date || item.date } : item);
  }
  return [...items.values()];
}

/** ジャンボ宝くじ等のお知らせか（種類のラベルか題名に「ジャンボ」） */
export const isJumboNews = (it) => /ジャンボ/.test(`${it.label} ${it.title}`);

/* ---------------- お知らせの中の賞金表 ---------------- */

const HEAD_RE = /「([^」]*ジャンボ[^」]*)」\s*\(\s*([^)]*?)\s*第\s*(\d+)\s*回\s*([^)]*?)\s*\)\s*の当せん金/;

/** 表の行 → セルの文字の配列（HTML の改行の入り方に左右されないよう、<tr> と <th>/<td> で区切る） */
function rowsOf(html) {
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => [...m[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => htmlToText(c[1]).replace(/\n/g, ' ').trim()));
}

/**
 * 宝ニュースのお知らせ → [{ name, round, roundText, price, tiers, totalSales, units, unitTickets, cands, totalTickets, salesStart, salesEnd, drawDate, payStart }]
 * 見出し「「〇〇ジャンボ…」（第N回 全国自治宝くじ）の当せん金・本数」ごとに、その下の表・注記・発売期間の表を読む。
 */
export function parseJumboNews(html) {
  const s = String(html);
  const heads = [...s.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const out = [];
  heads.forEach((h, i) => {
    const m = htmlToText(h[1]).replace(/\n/g, ' ').match(HEAD_RE);
    if (!m) return;
    out.push(readSection(m, s.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined)));
  });
  return out;
}

function readSection(m, seg) {
  const rows = rowsOf(seg);
  const text = htmlToText(seg).replace(/\n/g, ' ');
  // 賞金表：見出しの下で最初の表。見出し（等級等・当せん金・本数）の次の行から、1行ずつ「等級・金額・本数」を読む。
  // 読めない行があれば skipped に残す（検算で止めるため。行を読み飛ばしたまま載せない）
  const tiers = [];
  const skipped = [];
  const table = (seg.match(/<table\b[\s\S]*?<\/table>/i) || [''])[0];
  for (const c of rowsOf(table)) {
    if (!c.length || c.every((x) => !x) || /等級/.test(c[0])) continue;
    const prize = c.length >= 3 && /円$/.test(c[1]) ? jpNumber(c[1]) : null;
    const count = c.length >= 3 && /本$/.test(c[2]) ? jpNumber(c[2]) : null;
    if (prize == null || count == null) { skipped.push(c.join(' | ')); continue; }
    tiers.push({ name: c[0], prize, count });
  }
  // 「発売期間：」「抽せん日：」などの行（見出しのセルの右側）
  const cell = (re) => {
    const r = rows.find((c) => c.length >= 2 && re.test(c[0]));
    return r ? r.slice(1).join(' ') : '';
  };
  const datesOf = (re) => findDates(cell(re)).map((d) => d.iso);
  const salesM = text.match(/発売総額\s*([\d,.兆億万]+)\s*円/);
  const unitsM = text.match(/([\d,]+)\s*ユニット(?!\s*[\d,.]+\s*(?:万|億)?\s*枚)/);
  const perM = text.match(/1\s*ユニット\s*(?:[:=は])?\s*([\d,.]+\s*(?:億|万)?)\s*枚/);
  const priceM = cell(/発売価格/).match(/([\d,]+)\s*円/);
  const price = priceM ? jpNumber(priceM[1]) : null;
  const totalSales = salesM ? jpNumber(salesM[1]) : null;
  const units = unitsM ? jpNumber(unitsM[1]) : null;
  const unitTickets = perM ? jpNumber(perM[1]) : null;
  const low = tiers.length ? tiers.reduce((a, t) => (t.prize < a.prize ? t : a)) : null;
  // 発売総数は、3つの方法のうち分かるもので出し、検算で2つ以上が一致することを確かめる
  const cands = {
    sales: totalSales && price ? totalSales / price : null,
    units: units && unitTickets ? units * unitTickets : null,
    lowest: low && price && low.prize === price ? low.count * 10 : null,
  };
  const period = datesOf(/発売期間/);
  const kind = (m[4] || '').replace(/\s+/g, '') || '全国自治宝くじ';
  const round = Number(m[3]);
  return {
    name: m[1].trim(),
    round,
    roundText: `第${round}回${kind}`,
    price,
    tiers,
    skipped,
    totalSales,
    units,
    unitTickets,
    cands,
    totalTickets: cands.sales ?? cands.units ?? cands.lowest ?? null,
    salesStart: period[0] ?? null,
    salesEnd: period[1] ?? null,
    drawDate: datesOf(/抽せん日/)[0] ?? null,
    payStart: datesOf(/支払開始日/)[0] ?? null,
  };
}

/* ---------------- 検算 ---------------- */

/**
 * 読み取った賞金表を検算する。問題があれば、その内容（日本語）の一覧を返す（空なら合格）。
 *   ・発売総数を「発売総額÷1枚の値段」「ユニット数×1ユニットの枚数」「末等の本数×10」のうち2つ以上で確かめる
 *   ・賞金の合計が発売総額の40〜50%（法律で5割まで）
 *   ・末等は「1枚の値段と同じ額が10枚に1本」、1等の本数はユニット数で割り切れる、前後賞は1等の2倍、組違い賞は1等×（組の数−1）
 *   ・発売期間と抽せん日の順番、発売開始日が今日から1年以内
 */
export function checkJumbo(p, today) {
  const e = [];
  if (!p?.name || !/ジャンボ/.test(p.name)) e.push('くじの名前を読み取れません');
  if (!(p?.round > 0)) e.push('回号（第〇回）を読み取れません');
  if (!(Number.isInteger(p?.price) && p.price >= 100 && p.price <= 1000 && p.price % 100 === 0)) e.push(`1枚の値段を読み取れません（${p?.price ?? 'なし'}）`);
  const tiers = p?.tiers || [];
  if (p?.skipped?.length) e.push(`賞金の表に、読み取れない行があります（${p.skipped.slice(0, 3).join('／')}）`);
  if (tiers.length < 3) e.push(`賞金の表を読み取れません（${tiers.length}行）`);
  else {
    if (tiers[0].name !== '1等') e.push(`表の最初が「1等」ではありません（${tiers[0].name}）`);
    // 「1等」「2等」…の番号が抜けていないか（行を読み飛ばしていないか）
    const nums = tiers.map((t) => Number((t.name.match(/^(\d+)\s*等$/) || [])[1])).filter((x) => x > 0);
    for (let k = 1; k <= Math.max(0, ...nums); k++) if (!nums.includes(k)) e.push(`${k}等が見つかりません`);
    const seen = new Set();
    for (const t of tiers) {
      if (seen.has(nameKey(t.name))) e.push(`等級「${t.name}」が2回出てきます`);
      seen.add(nameKey(t.name));
      if (!(Number.isInteger(t.prize) && t.prize > 0 && Number.isInteger(t.count) && t.count > 0)) e.push(`「${t.name}」の賞金か本数を読み取れません`);
    }
  }
  const c = p?.cands || {};
  const known = Object.values(c).filter((x) => x != null);
  const show = (x) => (x == null ? '不明' : `${num(x)}枚`);
  if (known.length < 2) e.push(`発売総数を2つの方法で確かめられません（発売総額÷値段＝${show(c.sales)}、ユニット数×1ユニットの枚数＝${show(c.units)}、末等の本数×10＝${show(c.lowest)}）`);
  else if (!known.every((x) => x === known[0] && Number.isInteger(x))) e.push(`発売総数が合いません（発売総額÷値段＝${show(c.sales)}、ユニット数×1ユニットの枚数＝${show(c.units)}、末等の本数×10＝${show(c.lowest)}）`);
  const T = p?.totalTickets;
  if (!e.length && T > 0) {
    const paid = tiers.reduce((s, t) => s + t.prize * t.count, 0);
    const ratio = paid / (p.price * T);
    if (!(ratio >= 0.4 && ratio <= 0.5 + 1e-9)) e.push(`賞金の合計が発売総額の${pct(ratio, 2)}です（40〜50%の範囲の外）`);
    const low = tiers.reduce((a, t) => (t.prize < a.prize ? t : a));
    if (!(low.prize === p.price && low.count * 10 === T)) e.push(`いちばん安い賞（${low.name}）が「1枚の値段と同じ額が10枚に1本」になっていません`);
    for (const t of tiers) if (t.count > T) e.push(`「${t.name}」の本数が発売総数より多くなっています`);
    const first = tiers[0];
    if (p.units > 0 && first.count % p.units !== 0) e.push(`1等の本数（${num(first.count)}本）がユニット数（${p.units}）で割り切れません`);
    const zengo = tiers.find((t) => /前後賞/.test(t.name));
    if (zengo && zengo.count !== first.count * 2) e.push(`前後賞の本数（${num(zengo.count)}本）が1等の2倍ではありません`);
    const kumi = tiers.find((t) => /組違い/.test(t.name));
    if (kumi && p.unitTickets > 0 && p.unitTickets % 100000 === 0 && kumi.count !== first.count * (p.unitTickets / 100000 - 1)) e.push(`組違い賞の本数（${num(kumi.count)}本）が合いません`);
  }
  if (!(isDate(p?.salesStart) && isDate(p?.salesEnd) && isDate(p?.drawDate))) e.push('発売期間か抽せん日を読み取れません');
  else {
    if (!(p.salesStart <= p.salesEnd && p.salesEnd < p.drawDate)) e.push('発売期間と抽せん日の順番がおかしくなっています');
    if (p.drawDate > addDays(p.salesEnd, 40)) e.push('抽せん日が、発売の終わりから40日以上あとになっています');
    if (p.salesStart < addDays(today, -400) || p.salesStart > addDays(today, 400)) e.push('発売開始日が今日から1年以上離れています');
  }
  return e;
}

/* ---------------- data/games.json の項目 ---------------- */

const SEASONS = [['年末', 'nenmatsu'], ['バレンタイン', 'valentine'], ['ドリーム', 'dream'], ['サマー', 'summer'], ['ハロウィン', 'halloween'], ['オータム', 'autumn'], ['グリーン', 'green'], ['スプリング', 'spring']];

/** くじのID：年末ジャンボミニ（2026年発売）→ nenmatsumini2026。知らない名前のジャンボは jumbo＋回号 */
export function jumboId(p, raw = {}) {
  const base = SEASONS.find(([k]) => p.name.includes(k))?.[1];
  const size = /ミニ/.test(p.name) ? 'mini' : /プチ/.test(p.name) ? 'petit' : '';
  const year = isDate(p.salesStart) ? p.salesStart.slice(0, 4) : '';
  let id = base && year ? `${base}${size}${year}` : `jumbo${p.round}`;
  if (raw[id] && roundNo(raw[id].round) !== p.round) id = `${id}-${p.round}`;
  return id;
}

/** 比べる中身（値段・発売総数・日付・賞金表）のハッシュ。自動で入れた値を人が直したかどうかの目印にも使う */
export function dataHash(d) {
  const body = JSON.stringify([d.price, d.totalTickets, d.salesStart, d.salesEnd, d.drawDate, (d.tiers || []).map((t) => [nameKey(t.name), t.prize, t.count])]);
  return createHash('sha256').update(body).digest('hex').slice(0, 8);
}

export const autoKey = (id, hash) => `jumbo-auto-${id}-${hash}`;

export function verifyText(news) {
  return `賞金・本数・発売期間は、${news?.date ? `${ymd(news.date)}の` : ''}宝くじ公式サイトの発表から自動で読み取ったものです（運営者の確認待ち）。`;
}

/** 読み取った賞金表 → data/games.json の1項目（halloween2026 などと同じ形） */
export function buildDef(p, news = {}, today = '') {
  const T = p.totalTickets;
  const first = p.tiers[0];
  const zengo = p.tiers.find((t) => /前後賞/.test(t.name));
  const unit = p.unitTickets ? `1ユニット${manNoYen(p.unitTickets)}枚・` : '';
  const def = {
    name: p.name,
    round: p.roundText,
    group: 'takarakuji',
    category: 'ジャンボ宝くじ',
    price: p.price,
    model: 'fixed',
    totalTickets: T,
  };
  if (p.units) def.units = p.units;
  if (p.unitTickets) def.unitTickets = p.unitTickets;
  Object.assign(def, {
    salesStart: p.salesStart,
    salesEnd: p.salesEnd,
    drawDate: p.drawDate,
    how: `組と番号が印刷された券を買う普通くじ。${unit}${p.units ? `${p.units}ユニット` : `${manNoYen(T)}枚`}（発売予定額${man(p.price * T)}）`,
    drawLabel: `${fmtMd(p.drawDate)}抽せん`,
    deadline: `${fmtMd(p.salesEnd)}まで`,
    payoutNote: '賞金は固定。キャリーオーバーなし',
    verify: verifyText(news),
    tiers: p.tiers.map(({ name, prize, count }) => ({ name, prize, count })),
    rules: zengo ? `1等・前後賞合わせて${man(first.prize + zengo.prize * 2)}。` : `1等は${man(first.prize)}。`,
    sources: news.url ? [{ title: `宝くじ公式サイト「宝ニュース」${news.title ? `：${news.title}` : ''}`, url: news.url }] : [],
    autoFrom: { url: news.url || '', title: news.title || '', date: news.date || '', on: today, hash: dataHash(p) },
  });
  return def;
}

/** 登録済みの項目を、公式発表の内容で置き換える（ほかの書き足し（defaultSales など）は残す） */
function updateDef(def, p, news, today, changes) {
  const fresh = buildDef(p, news, today);
  fresh.sources = [...fresh.sources, ...(def.sources || []).filter((s) => !fresh.sources.some((x) => x.url === s.url))];
  fresh.autoFrom.changes = changes || []; // 前の登録から変わったところ（Issue に書く。空なら「数字は同じ」）
  fresh.autoFrom.from = def.autoFrom ? 'official' : 'provisional'; // 前の登録：自動で読み取った公式発表／報道などをもとにした仮の登録
  const rest = Object.fromEntries(Object.entries(def).filter(([k]) => !(k in fresh) && k !== 'verify' && k !== 'units' && k !== 'unitTickets'));
  return { ...fresh, ...rest };
}

/** 登録済みの項目と公式発表の違い（日本語の行の一覧。同じなら空） */
export function diffJumbo(def, p) {
  const out = [];
  if (def.price !== p.price) out.push(`1枚の値段：${yen(def.price)} → ${yen(p.price)}`);
  if (def.totalTickets !== p.totalTickets) out.push(`発売総数：${num(def.totalTickets || 0)}枚 → ${num(p.totalTickets)}枚`);
  if (def.salesStart !== p.salesStart || def.salesEnd !== p.salesEnd) out.push(`発売期間：${fmtMd(def.salesStart)}〜${fmtMd(def.salesEnd)} → ${fmtMd(p.salesStart)}〜${fmtMd(p.salesEnd)}`);
  if (def.drawDate !== p.drawDate) out.push(`抽せん日：${fmtMd(def.drawDate)} → ${fmtMd(p.drawDate)}`);
  const a = def.tiers || [];
  const b = p.tiers || [];
  const tx = (t) => `${yen(t.prize)}×${num(t.count)}本`;
  for (const t of b) {
    const o = a.find((x) => nameKey(x.name) === nameKey(t.name));
    if (!o) out.push(`${t.name}：（なし） → ${tx(t)}`);
    else if (o.prize !== t.prize || o.count !== t.count) out.push(`${t.name}：${tx(o)} → ${tx(t)}`);
  }
  for (const o of a) if (!b.some((t) => nameKey(t.name) === nameKey(o.name))) out.push(`${o.name}：${tx(o)} → （なし）`);
  if (!out.length && a.map((t) => nameKey(t.name)).join('|') !== b.map((t) => nameKey(t.name)).join('|')) out.push('等級の並び順が違います');
  return out;
}

/** games.json の並び：宝くじのジャンボの中で、回号の順になる位置に入れる */
export function insertGame(raw, id, def) {
  const keys = Object.keys(raw);
  const r = roundNo(def.round) ?? Infinity;
  const jumbos = keys.map((k, i) => [i, roundNo(raw[k]?.round) ?? 0, raw[k]]).filter(([, , g]) => g?.model === 'fixed' && g.group === 'takarakuji');
  const after = jumbos.filter(([, n]) => n <= r).pop();
  const before = jumbos.find(([, n]) => n > r);
  // 新しい項目を keys[pos] の前に入れる：回号が前のジャンボの後ろ → 回号が後のジャンボの前 → 宝くじの最後
  const pos = after ? after[0] + 1 : before ? before[0] : keys.reduce((a, k, i) => (raw[k]?.group === 'takarakuji' ? i + 1 : a), keys.length);
  const out = {};
  keys.forEach((k, i) => {
    if (i === pos) out[id] = def;
    out[k] = raw[k];
  });
  if (!(id in out)) out[id] = def;
  return out;
}

const findByRound = (raw, round) => Object.entries(raw).find(([k, g]) => !k.startsWith('_') && g?.model === 'fixed' && roundNo(g.round) === round) || null;

/** 解説（data/guides.json）の中の「〇月〇日」で、いまの発売期間・抽せん日のどれとも合わないもの */
export function guideDateMismatch(guide, def) {
  if (!guide) return [];
  const ok = new Set([def.salesStart, def.salesEnd, def.drawDate].filter(isDate).map((d) => `${+d.slice(5, 7)}月${+d.slice(8, 10)}日`));
  const text = JSON.stringify([guide.about, guide.faq]);
  const found = [...new Set([...normalize(text).matchAll(/(\d{1,2})月(\d{1,2})日/g)].map((m) => `${+m[1]}月${+m[2]}日`))];
  return found.filter((d) => !ok.has(d));
}

/* ---------------- お知らせ（Issue）の文面 ---------------- */

function tierTable(d) {
  return ['| 等級 | 当せん金 | 本数 |', '|---|---:|---:|', ...d.tiers.map((t) => `| ${t.name} | ${yen(t.prize)} | ${num(t.count)}本 |`)].join('\n');
}

export function autoIssue(id, d, { base = '', guide = null } = {}) {
  const T = d.totalTickets;
  const paid = d.tiers.reduce((s, t) => s + t.prize * t.count, 0);
  const updated = Array.isArray(d.autoFrom?.changes);
  const mism = guideDateMismatch(guide, d);
  return {
    title: updated
      ? `【確認のお願い】${d.name}（${d.round}）を公式発表の内容に更新しました`
      : `【確認のお願い】${d.name}（${d.round}）を自動で登録しました`,
    body: [
      !updated
        ? '宝くじ公式サイトの発表（宝ニュース）から、新しいジャンボ宝くじの賞金表を読み取り、サイトに載せました。'
        : d.autoFrom.from === 'official'
          ? `${d.name}は、公式発表から自動で登録していましたが、公式発表の内容が変わったので、読み直して置き換えました。`
          : `${d.name}は、公式発表の前の情報（報道など）をもとに登録していました。宝くじ公式サイトの発表が出たので、読み取った内容に置き換えました。`,
      '読み取った数字の検算（発売総数の一致・賞金の合計が発売総額の5割以下・いちばん安い賞が10枚に1本 など）は、すべて通っています。',
      '',
      `- 公式の発表：[${d.autoFrom?.title || '宝ニュース'}](${d.autoFrom?.url})`,
      base ? `- サイトのページ：${base}/kuji/${id}.html` : null,
      `- 発売期間：${fmtYmd(d.salesStart)}〜${fmtYmd(d.salesEnd)}／抽せん日：${fmtYmd(d.drawDate)}`,
      `- 1枚${yen(d.price)}・発売総数${num(T)}枚${d.units ? `（${d.units}ユニット）` : ''}・還元率 約${pct(paid / (d.price * T))}`,
      '',
      tierTable(d),
      ...(updated && d.autoFrom.changes.length ? ['', '#### 前の登録から変わったところ', ...d.autoFrom.changes.map((c) => `- ${c}`)] : []),
      ...(updated && !d.autoFrom.changes.length ? ['', '前の登録と、数字は同じでした。'] : []),
      ...(mism.length ? ['', `#### 解説の文章（\`data/guides.json\` の \`${id}\`）に、いまの日程と合わない日付があります`, `- ${mism.join('・')}`] : []),
      '',
      '### やること',
      '1. 上の「公式の発表」を開き、表の数字・発売期間・抽せん日が同じか見比べます。',
      '2. 同じなら、この Issue を閉じてください（いちばん下の「Close issue」）。次の朝の更新で、ページの「確認待ち」の注記が自動で消えます。',
      '3. 違っていたら、閉じずに、この Issue の内容を Claude に見せて「直して」と頼んでください。',
      guide ? `4. くじ別ページの解説（\`data/guides.json\` の \`${id}\`）は自動では変えていません。日付や金額が変わっていないかも見てください。` : null,
      '',
      `ページにはいま「${d.verify}」と表示しています。`,
    ].filter((x) => x !== null).join('\n'),
  };
}

export function diffIssue(id, d, p, news, changes) {
  return {
    title: `【要確認】${d.name}の登録内容が、公式発表と違います`,
    body: [
      `宝くじ公式サイトの発表と、サイトに登録している ${d.name}（\`data/games.json\` の \`${id}\`）の内容が違います。確認済みの登録なので、サイトの表示は自動では変えていません。`,
      '',
      `- 公式の発表：[${news.title || '宝ニュース'}](${news.url})`,
      '',
      '#### 違うところ（登録 → 公式発表）',
      ...changes.map((c) => `- ${c}`),
      '',
      '### やること',
      `1. 公式の発表が正しければ、\`data/games.json\` の \`${id}\` を直します（この Issue を Claude に見せて「直して」と頼めます）。直すと、この Issue は自動で閉じます。`,
      '2. 登録のほうが正しい（公式の発表が古いなど）なら、この Issue を閉じてください。同じ違いについては、もう知らせません。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

export function parseIssue(x) {
  const p = x.p || {};
  return {
    title: `【要確認】ジャンボ宝くじの公式発表を読み取れませんでした（${p.name || '名前不明'} 第${p.round}回）`,
    body: [
      '宝くじ公式サイトの発表（宝ニュース）に、まだ登録していないジャンボ宝くじの賞金表がありますが、読み取った数字が検算に通らなかったため、サイトには載せていません。',
      '',
      `- 公式の発表：[${x.news?.title || '宝ニュース'}](${x.news?.url})`,
      '',
      '#### 検算で引っかかったところ',
      ...x.errors.map((e) => `- ${e}`),
      '',
      '### やること',
      '1. 上の発表を開いて、賞金表が載っているか確認します。',
      '2. 載っていれば、`data/games.json` に手で追加します（README の「新しいジャンボ宝くじ」。この Issue を Claude に見せて「追加して」と頼めます）。登録されると、この Issue は自動で閉じます。',
      '3. 公式の発表の書き方が変わったために読み取れないこともあります。その場合は、読み取りの処理（`scripts/lib/jumbo.mjs`）も直します。',
      '4. 載せなくてよいくじなら、この Issue を閉じてください。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

export function missingIssue(x) {
  return {
    title: `【要確認】発売中の${x.name}（第${x.round}回）がサイトに載っていません`,
    body: [
      `宝くじ公式サイトの「現在取扱い中のジャンボ宝くじ等の普通くじ」に ${x.name}（第${x.round}回）が出ていますが、サイトに登録されていません。公式発表（宝ニュース）からの自動登録が、うまくいかなかった可能性があります。`,
      '',
      `- 公式サイト：[ジャンボ宝くじ等の普通くじのご案内](${ONSALE_URL})`,
      '',
      '### やること',
      '1. 宝くじ公式サイトで、このくじの賞金（各等の金額と本数）・発売期間・抽せん日・発売総数を確認します。',
      '2. `data/games.json` に追加します（この Issue を Claude に見せて「追加して」と頼めます）。登録されると、この Issue は自動で閉じます。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

export function newsDownIssue(error, days) {
  return {
    title: '【確認のお願い】宝くじ公式サイトの「宝ニュース」を読み取れません',
    body: [
      `ジャンボ宝くじを自動で登録するために毎朝見ている「宝ニュース」の一覧を、${days}日続けて読み取れませんでした。ページの場所や作りが変わった可能性があります。この間、新しいジャンボ宝くじは自動で登録されません。`,
      '',
      `- ページ：[宝ニュース](${NEWS_LIST_URL})`,
      `- エラー：${error}`,
      '',
      '### やること',
      '1. 上のページが開けるか確認します。',
      '2. 開けるのに続くときは、読み取りの処理（`scripts/lib/jumbo.mjs` の `parseNewsList`）を直す必要があります。読み取れるようになると、この Issue は自動で閉じます。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

/* ---------------- 足す・直す・知らせるを決める ---------------- */

/**
 * 公式発表のジャンボ（products）と data/games.json（raw）を見比べて、足す・直す・知らせるを決める。
 *   products … [{ p（parseJumboNews の1件）, news（parseNewsList の1件）, errors（checkJumbo の結果） }]（新しいお知らせが先）
 *   closed   … 閉じられた Issue の key の一覧（確認済み・知らせなくてよい の目印）
 *   guides   … data/guides.json の games（解説の日付が合っているかの確認用）
 * 戻り値：{ raw（変えたあとの games.json の中身）, changed, items: [{ type: 'raise'|'clear', key, title?, body? }], lines }
 */
export function planJumbo(raw, products, { today, closed = new Set(), base = '', guides = {} } = {}) {
  let next = structuredClone(raw);
  let changed = false;
  const items = [];
  const lines = [];
  const raise = (key, issue) => { if (!closed.has(key)) items.push({ type: 'raise', key, ...issue }); };
  const clear = (key, note) => items.push({ type: 'clear', key, ...(note ? { note } : {}) });

  // 1) 確認待ちの Issue が閉じられた項目は、確認済みにする（verify を消すと、ページの注記が消える）
  for (const [id, d] of Object.entries(next)) {
    if (id.startsWith('_') || !d?.verify || !d.autoFrom?.hash) continue;
    if (closed.has(autoKey(id, d.autoFrom.hash))) {
      delete d.verify;
      changed = true;
      lines.push(`✓ ${d.name}：確認の Issue が閉じられたので、確認済みにしました（ページの「確認待ち」の注記を外します）`);
    }
  }

  // 2) 同じ回が複数のお知らせにあれば、新しいお知らせで検算に通ったものを使う
  const byRound = new Map();
  for (const x of products) {
    const r = x.p?.round;
    if (!r) continue;
    const have = byRound.get(r);
    if (!have || (have.errors.length && !x.errors.length)) byRound.set(r, x);
  }

  for (const [round, x] of byRound) {
    const found = findByRound(next, round);
    const p = x.p;
    if (x.errors.length) {
      if (found || (isDate(p.salesEnd) && p.salesEnd < today)) { clear(`jumbo-parse-${round}`); continue; }
      raise(`jumbo-parse-${round}`, parseIssue(x));
      lines.push(`⚠ ${p.name || 'ジャンボ'}（第${round}回）：公式発表を読み取れませんでした（${x.errors[0]}）`);
      continue;
    }
    clear(`jumbo-parse-${round}`);
    if (!found) {
      if (p.salesEnd < today) { lines.push(`${p.name}（第${round}回）：発売が終わっているので登録しません`); continue; }
      const id = jumboId(p, next);
      next = insertGame(next, id, buildDef(p, x.news, today));
      changed = true;
      lines.push(`★ ${p.name}（第${round}回）を、公式発表から自動で登録しました（${id}）`);
      continue;
    }
    const [id, def] = found;
    const changes = diffJumbo(def, p);
    if (def.verify && !def.autoFrom) {
      // 報道などをもとにした仮の登録 → 公式発表の内容に置き換える
      next[id] = updateDef(def, p, x.news, today, changes);
      changed = true;
      lines.push(`★ ${def.name}（第${round}回）を、公式発表の内容に更新しました（${changes.length ? `${changes.length}か所が変わりました` : '数字は同じでした'}）`);
      continue;
    }
    if (def.verify && def.autoFrom) {
      // 自動で登録して確認待ち。人が直していなければ、公式発表が直されたときに読み直す
      if (changes.length && dataHash(def) === def.autoFrom.hash) {
        clear(autoKey(id, def.autoFrom.hash), '公式の発表の内容が変わったので、新しい内容で読み直しました。確認のお願いは、新しい Issue でお届けします。この Issue は閉じます。');
        next[id] = updateDef(def, p, x.news, today, changes);
        changed = true;
        lines.push(`★ ${def.name}（第${round}回）：公式発表が変わったので、読み直しました`);
      }
      continue;
    }
    // 確認済みの登録は自動では変えない。公式発表と違えば知らせる
    const key = `jumbo-diff-${id}-${dataHash(p)}`;
    if (changes.length) {
      raise(key, diffIssue(id, def, p, x.news, changes));
      lines.push(`⚠ ${def.name}：登録内容が公式発表と違います（${changes[0]}）`);
    } else clear(key);
  }

  // 3) 確認待ちの項目は、確認されるまで Issue でお願いする（Issue が開いていれば、新しくは作らない）
  for (const [id, d] of Object.entries(next)) {
    if (id.startsWith('_') || !d?.autoFrom?.hash) continue;
    const key = autoKey(id, d.autoFrom.hash);
    if (d.verify) raise(key, autoIssue(id, d, { base, guide: guides[id] || null }));
    else clear(key);
  }
  return { raw: next, changed, items, lines };
}

/* ---------------- 発売中のジャンボ ---------------- */

/** 「ジャンボ宝くじ等の普通くじのご案内」の「現在取扱い中」→ [{ round, name }]（ジャンボだけ）。見出しがなければ null */
export function parseOnSale(html) {
  const text = htmlToText(html);
  const i = text.indexOf('現在取扱い中');
  if (i < 0) return null;
  let sec = text.slice(i);
  const end = sec.search(/当せん番号のご案内|関連する宝ニュース|現在取扱い中の宝くじをもっと見る/);
  if (end > 0) sec = sec.slice(0, end);
  const out = new Map();
  for (const m of sec.matchAll(/「([^」]*ジャンボ[^」]*)」\s*\(\s*[^)]*?第\s*(\d+)\s*回/g)) out.set(Number(m[2]), m[1].trim());
  for (const m of sec.matchAll(/第\s*(\d+)\s*回[^\n]*\n([^\n]*ジャンボ[^\n]*)/g)) if (!out.has(Number(m[1]))) out.set(Number(m[1]), m[2].trim());
  return [...out].map(([round, name]) => ({ round, name }));
}

/* ---------------- 自動で作る解説（data/guides.json に書いていないジャンボ用） ---------------- */

/**
 * ジャンボ宝くじの解説とよくある質問を、賞金表から作る（data/guides.json と同じ形）。
 *   rate  … このサイトの計算の還元率（0.47 など）
 *   point … ポイントが一番多い買い方の説明（「宝くじ公式サイトをPayPayクレジットで払う方法（2.0%）」など）
 */
export function autoGuide(d, { rate = null, point = '', sibling = null } = {}) {
  const T = d.totalTickets;
  const first = d.tiers?.[0];
  if (!(T > 0) || !first || !isDate(d.salesStart) || !isDate(d.salesEnd) || !isDate(d.drawDate)) return null;
  const y = d.salesStart.slice(0, 4);
  const md = (iso) => `${+iso.slice(5, 7)}月${+iso.slice(8, 10)}日`;
  const zengo = d.tiers.find((t) => /前後賞/.test(t.name));
  const low = d.tiers.reduce((a, t) => (t.prize < a.prize ? t : a));
  const oddsText = oddsJa(T / first.count);
  const ratePct = Number.isFinite(rate) ? Math.round(rate * 100) : null;
  const tenth = low.prize === d.price && low.count * 10 === T;
  const about = [
    {
      type: 'rules',
      key: `1枚${num(d.price)}円・${slash(d.salesStart)}〜${slash(d.salesEnd)}`,
      text: `${d.name}は、組と番号があらかじめ印刷された券を買う、ジャンボ宝くじ（普通くじ）です。${y}年は**${md(d.salesStart)}から${md(d.salesEnd)}まで発売**され、**${md(d.drawDate)}に抽せん**があります。1枚${num(d.price)}円で、連番やバラなら10枚単位で買えます。`,
    },
    {
      type: 'rate',
      key: ratePct ? `約${ratePct}%・賞金は固定` : '賞金は固定',
      text: `賞金と本数があらかじめ決まっているので、**還元率は発売中に変わりません**。${ratePct ? `このサイトの計算では**約${ratePct}%**です。` : ''}キャリーオーバーはなく、${zengo ? `1等・前後賞合わせて**${man(first.prize + zengo.prize * 2)}**です。` : `1等は**${man(first.prize)}**です。`}`,
    },
    {
      type: 'odds',
      key: `1等は${oddsText}`,
      text: `1等（${man(first.prize)}）は${manNoYen(T)}枚の中に${num(first.count)}本あり、当せん確率は**${oddsText}**です。${tenth ? `一番下の${low.name}（${num(low.prize)}円）は**10枚に1枚**の割合で当たります。` : ''}`,
    },
    {
      type: 'buy',
      key: '公式サイト・みずほ銀行',
      text: `ネットでは、宝くじ公式サイトと、みずほ銀行のインターネット宝くじサービスで買えます。${point ? `**ポイントが一番多いのは、${point}**です。` : ''}宝くじ売り場でも買えます。`,
    },
  ];
  const faq = [
    { q: `${d.name}はいつまで買えますか？`, a: `${y}年は${fmtMd(d.salesStart)}から${fmtMd(d.salesEnd)}まで発売されます。抽せんは${fmtMd(d.drawDate)}です。` },
    { q: `${d.name}の1等の当せん確率はどれくらいですか？`, a: `${oddsText}です。発売総数${manNoYen(T)}枚の中に、1等が${num(first.count)}本あります。` },
  ];
  if (tenth) faq.push({ q: '10枚買うと必ず当たりますか？', a: `連番またはバラで10枚買うと、下1ケタが0〜9までそろうので、${low.name}（${num(low.prize)}円）が必ず1枚当たります。それ以外の等級が当たるかどうかは運しだいです。` });
  faq.push(...dynamicFaq(d, { sibling }));
  const when = d.autoFrom?.date || d.autoFrom?.on;
  return {
    about,
    faq,
    sources: [],
    note: `※しくみと数値は、${when ? `${ymd(when)}の` : ''}宝くじ公式サイトの発表をもとに自動で作成しています。`,
    auto: true,
  };
}

/** 「宝くじ一覧」の説明文（data/catalog.json に書いていないジャンボ用） */
export function autoLead(d) {
  const first = d.tiers?.[0];
  if (!first || !isDate(d.salesStart)) return '';
  const zengo = d.tiers.find((t) => /前後賞/.test(t.name));
  return `組と番号が印刷された券を買うジャンボ宝くじです。抽せんで決まった当せん番号と一致すれば当せんです。${d.salesStart.slice(0, 4)}年は1等${man(first.prize)}${zengo ? `、1等の前後賞と合わせて${man(first.prize + zengo.prize * 2)}` : ''}です。`;
}

/* ---------------- 何枚買うと当たる？・ミニとの比較（くじ別ページ用の計算） ---------------- */

/** 1枚で、min 円以上の賞のどれかが当たる確率 */
export function chanceAtLeast(d, min) {
  const T = d?.totalTickets;
  if (!(T > 0)) return null;
  return (d.tiers || []).filter((t) => t.prize >= min).reduce((s, t) => s + t.count, 0) / T;
}

/** n 枚買って、1枚以上当たる確率（1枚ずつ別々に当たると考えた目安） */
export const chanceOfN = (p, n) => 1 - (1 - p) ** n;

/** 確率の書き方：0.0297 → 「3.0%」、0.0033 → 「0.33%」、0.000015 → 「約6.7万分の1」、0.0000005 → 「約200万分の1」 */
export function chanceText(p) {
  if (!(p > 0)) return '—';
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  if (p >= 0.0001) return `${Number((p * 100).toPrecision(2))}%`;
  const inv = 1 / p;
  const [unit, label] = inv >= 1e8 ? [1e8, '億'] : [1e4, '万'];
  const v = inv / unit;
  const r = v >= 100 ? Math.round(v / 10) * 10 : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10; // 2けたくらいに丸める
  return `約${r.toLocaleString('ja-JP')}${label}分の1`;
}

export const BUY_COUNTS = [10, 30, 100];

/**
 * 買う枚数ごとの「1枚以上当たる確率」と、平均で戻る金額
 *   列：1万円以上・10万円以上・100万円以上・1等（同じ確率になる列は、高い金額のほうだけ残す）
 *   rate … このサイトの計算の還元率（平均で戻る金額に使う）
 */
export function buyChances(d, rate = null) {
  const first = d?.tiers?.[0];
  if (!first || !(d.totalTickets > 0)) return null;
  let levels = [
    { label: '1万円以上', min: 10000 },
    { label: '10万円以上', min: 100000 },
    { label: '100万円以上', min: 1000000 },
    { label: `1等（${man(first.prize)}）`, min: first.prize, first: true },
  ].filter((l) => l.first || l.min < first.prize).map((l) => ({ ...l, p: l.first ? first.count / d.totalTickets : chanceAtLeast(d, l.min) }));
  levels = levels.filter((l, i) => l.p > 0 && !(i + 1 < levels.length && levels[i + 1].p === l.p));
  return {
    levels,
    rows: BUY_COUNTS.map((n) => ({ n, cost: n * d.price, chances: levels.map((l) => chanceOfN(l.p, n)), back: Number.isFinite(rate) ? n * d.price * rate : null })),
    lowest: (() => { const low = d.tiers.reduce((a, t) => (t.prize < a.prize ? t : a)); return low.prize === d.price && low.count * 10 === d.totalTickets ? low : null; })(),
  };
}

/** 同じ日に発売・抽せんされるもう一方のジャンボ（年末ジャンボと年末ジャンボミニなど） */
export function jumboSibling(d, defs) {
  return Object.values(defs || {}).find((x) => x && x.id !== d.id && x.model === 'fixed' && x.group === d.group
    && x.salesStart === d.salesStart && x.drawDate === d.drawDate) || null;
}

/**
 * 賞金表から計算する「よくある質問」（何枚買えば1万円以上が当たるか・同じ日のジャンボとどちらが当たりやすいか）。
 * 手で書いた解説（data/guides.json）のジャンボにも足す。数字は賞金表から毎回計算するので、賞金表が変わってもずれない
 */
export function dynamicFaq(d, { sibling = null } = {}) {
  const out = [];
  const first = d?.tiers?.[0];
  const p1 = chanceAtLeast(d, 10000);
  if (first && p1 > 0 && first.prize > 10000) {
    out.push({ q: `${d.name}を何枚買えば、1万円以上が当たりますか？`, a: `1万円以上の賞が当たる確率は1枚あたり${chanceText(p1)}で、平均すると${num(Math.round(1 / p1))}枚に1枚です。10枚買うと${chanceText(chanceOfN(p1, 10))}、100枚買うと${chanceText(chanceOfN(p1, 100))}の確率で、1枚以上当たる計算です（1枚ずつ別々に当たると考えた目安）。` });
  }
  if (first && sibling?.tiers?.length && sibling.totalTickets > 0) {
    out.push({ q: `${d.name}と${sibling.name}は、どちらが当たりやすいですか？`, a: compareSentence(d, sibling) });
  }
  return out;
}

/** ジャンボの比較の一文（数字だけで中立に） */
export function compareSentence(a, b) {
  const fa = a.tiers[0];
  const fb = b.tiers[0];
  const [big, small] = fa.prize >= fb.prize ? [a, b] : [b, a];
  const ratio = (x, y) => (x / y >= 10 ? Math.round(x / y) : Math.round((x / y) * 10) / 10);
  const pBig = big.tiers[0].count / big.totalTickets;
  const pSmall = small.tiers[0].count / small.totalTickets;
  const m = (d) => chanceAtLeast(d, 10000);
  const parts = [`1等の金額は${big.name}が${ratio(big.tiers[0].prize, small.tiers[0].prize)}倍`];
  if (pSmall > pBig) parts.push(`1等の当せん確率は${small.name}が${ratio(pSmall, pBig)}倍高い`);
  const mb = m(big);
  const ms = m(small);
  let tail;
  if (mb > 0 && ms > 0) {
    const r = ms / mb;
    if (r > 1.1) tail = `1万円以上が当たる確率は${small.name}のほうが${ratio(ms, mb)}倍高くなります`;
    else if (r < 1 / 1.1) tail = `1万円以上が当たる確率は${big.name}のほうが${ratio(mb, ms)}倍高くなります`;
    else tail = '1万円以上が当たる確率は、ほぼ同じです';
  }
  return `${parts.join('、')}計算です。${tail ? `${tail}。` : ''}`;
}

/** 自動で登録した項目の、解説の下の注記（data/guides.json の解説を、公式発表より前に確認したとき） */
export function autoSourceNote(d) {
  const when = d.autoFrom?.date || d.autoFrom?.on;
  return `※賞金・本数・発売期間は、${when ? `${ymd(when)}の` : ''}宝くじ公式サイトの発表にもとづきます。`;
}
