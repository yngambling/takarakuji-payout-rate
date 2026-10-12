// 新しいくじが出ていないかを見つける（通信しない部分）
//   スポーツくじ：BIG系・DUNK の「くじ情報」「くじ結果」ページの、くじの名前（fetch.mjs が毎回 data/state.json の products に残す）
//   宝くじ：宝くじ公式サイトのメニュー（ネット購入・宝くじ商品のご案内）に並ぶくじ（watch.mjs が毎朝「宝ニュース」のページで見る）
// 知らないくじが出ていたら、Issue でお知らせする（サイトの表示は変えない）。

import { htmlToText, normalize, BIG_PRODUCTS, DUNK_PRODUCTS } from './parse.mjs';
import { HOW_TO_FIX } from './alerts.mjs';

const DASH = '[-‐‑–—−]';

/** ページの中のくじの名前（BIG系は「第N回 〇〇 くじ情報／くじ結果」の見出し、DUNK は「DUNK10」「DUNK6-A」などの名前） */
export function sportsLabels(html, kind) {
  const text = htmlToText(html);
  const out = new Set();
  if (kind === 'big') {
    for (const m of text.matchAll(/第\s*\d+\s*回\s*([^\n|]{1,24}?)\s*くじ(?:情報|結果)/g)) out.add(m[1].replace(/\s+/g, ' ').trim());
  } else if (kind === 'dunk') {
    for (const m of text.matchAll(new RegExp(`DUNK\\s*\\d+(?:\\s*${DASH}\\s*[A-Za-z](?![A-Za-z]))?`, 'gi'))) out.add(m[0].replace(/\s+/g, '').toUpperCase());
  }
  return [...out];
}

// 名前の一部として出てくるだけの、くじではない言葉（DUNK6 は DUNK6-A・DUNK6-B のまとめた呼び名）
const EXTRA_KNOWN = { big: [], dunk: [/^DUNK\s*6$/i] };

/** 知らないくじの名前だけを返す */
export function unknownSports(kind, labels) {
  const list = kind === 'big' ? BIG_PRODUCTS : kind === 'dunk' ? DUNK_PRODUCTS : [];
  return (labels || []).filter((l) => {
    const t = normalize(l).trim();
    return t && !list.some((p) => p.re.test(t)) && !(EXTRA_KNOWN[kind] || []).some((re) => re.test(t));
  });
}

/** 宝くじ公式サイトのメニュー → { net: [{ key, name }], kuji: [{ key, name }] }（読み取れなければ null） */
export function takarakujiMenu(html) {
  const s = String(html);
  const net = new Map();
  for (const m of s.matchAll(/href\s*=\s*"javascript:\s*glonavi(\w+?)Form\.submit\(\)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!net.has(m[1])) net.set(m[1], htmlToText(m[2]));
  }
  const kuji = new Map();
  for (const m of s.matchAll(/href\s*=\s*"\/kuji\/([a-z0-9_-]+)\/(?:\?[^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!kuji.has(m[1])) kuji.set(m[1], htmlToText(m[2]));
  }
  if (!net.size && !kuji.size) return null;
  return { net: [...net].map(([key, name]) => ({ key, name })), kuji: [...kuji].map(([key, name]) => ({ key, name })) };
}

// このサイトが知っている宝くじ（扱っていないクイックワン・スクラッチも「知っている」に入れる）
export const KNOWN_TAKARAKUJI = {
  net: ['Jumbo', 'Loto7', 'Loto6', 'Miniloto', 'Bingo5', 'Numbers4', 'Numbers3', 'Quickone'],
  kuji: ['jumbo', 'scratch', 'loto', 'bingo5', 'numbers', 'quickone'],
};

/** 知らない宝くじ → [{ key（Issue の key に使う）, name }] */
export function unknownTakarakuji(menu) {
  if (!menu) return [];
  const out = [];
  for (const x of menu.net) if (!KNOWN_TAKARAKUJI.net.includes(x.key)) out.push({ key: `net-${x.key.toLowerCase()}`, name: x.name || x.key, where: 'ネット購入のメニュー' });
  for (const x of menu.kuji) if (!KNOWN_TAKARAKUJI.kuji.includes(x.key)) out.push({ key: `kuji-${x.key}`, name: x.name || x.key, where: '「宝くじ商品のご案内」のメニュー' });
  return out;
}

const slug = (s) => normalize(s).toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/g, '').slice(0, 40) || 'x';
export const sportsKey = (kind, label) => `newproduct-${kind}-${slug(label)}`;
export const takarakujiKey = (x) => `newproduct-takarakuji-${x.key}`;

const SPORTS_PAGE = {
  big: 'BIG系の「くじ情報」「くじ結果」（スポーツくじオフィシャルサイト）',
  dunk: 'DUNK の「くじ情報」「くじ結果」（スポーツくじオフィシャルサイト）',
};

export function sportsIssue(kind, label, firstSeen) {
  return {
    title: `【お知らせ】スポーツくじに、新しいくじ「${label}」が出ています`,
    body: [
      `${SPORTS_PAGE[kind] || 'スポーツくじの公式ページ'}に、このサイトがまだ扱っていないくじ「${label}」が出ています${firstSeen ? `（${firstSeen}に見つけました）` : ''}。このくじは、ランキングにも計算にも入っていません。サイトの表示は何も変えていません。`,
      '',
      '### やること',
      '1. スポーツくじの公式サイトで、新しいくじのしくみ（1口の値段・当せん確率・賞金の配分・1等の上限）を確認します。',
      '2. サイトに載せるときは、くじの定義（`data/games.json`）と、公式ページの読み取り（`scripts/lib/parse.mjs` の `BIG_PRODUCTS`・`DUNK_PRODUCTS`）に足す必要があります。この Issue を Claude に見せて「このくじを追加して」と頼んでください。読み取りに足すと、この Issue は自動で閉じます。',
      '3. 載せなくてよければ、この Issue を閉じてください。同じくじについては、もう知らせません。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

export function takarakujiIssue(x) {
  return {
    title: `【お知らせ】宝くじ公式サイトに、新しいくじ「${x.name}」が出ています`,
    body: [
      `宝くじ公式サイトの${x.where}に、このサイトがまだ知らないくじ「${x.name}」が増えています。新しい種類の宝くじが始まった可能性があります。サイトの表示は何も変えていません。`,
      '',
      '- ページ：[宝くじ公式サイト](https://www.takarakuji-official.jp/kuji/top.html)',
      '',
      '### やること',
      '1. 宝くじ公式サイトで、新しいくじのしくみ（1口の値段・当せん金・確率・発売日）を確認します。',
      '2. サイトに載せるときは、この Issue を Claude に見せて「このくじを追加して」と頼んでください（`data/games.json` への追加と、データの取り方を決める必要があります）。',
      '3. 載せなくてよければ、この Issue を閉じてください。同じくじについては、もう知らせません。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}
