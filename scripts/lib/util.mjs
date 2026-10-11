// 日付・数値・HTML の小物

export const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 日本時間の日時パーツ */
export function jstParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const iso = `${p.year}-${p.month}-${p.day}`;
  return { iso, y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, wd: weekdayOf(iso) };
}

export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function diffDays(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/** 年末年始（12/31〜1/3）は数字選択式の抽せんがない */
export function isYearEndBreak(iso) {
  const md = iso.slice(5);
  return md === '12-31' || md === '01-01' || md === '01-02' || md === '01-03';
}

/**
 * 次の抽せん日。
 *   weekdays: 抽せん曜日（0=日）
 *   after   : この日より後（最終抽せん日）。無ければ today 以降
 *   today   : 今日（日本時間）
 *   skipToday: 今日が抽せん日でも既に終わっている扱いにする
 */
export function nextDrawDate({ weekdays, after = null, today, skipToday = false }) {
  let d = after ? addDays(after, 1) : today;
  if (d < today) d = today;
  for (let i = 0; i < 400; i++) {
    const ok = weekdays.includes(weekdayOf(d)) && !isYearEndBreak(d) && !(skipToday && d === today);
    if (ok) return d;
    d = addDays(d, 1);
  }
  return null;
}

export function fmtMd(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日（${WEEK[weekdayOf(iso)]}）`;
}

/** 曜日なし：10月10日（タイトルなど括弧が重なる所で使う） */
export function fmtMdPlain(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日`;
}

export function fmtYmd(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日（${WEEK[weekdayOf(iso)]}）`;
}

export function fmtShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}（${WEEK[weekdayOf(iso)]}）`;
}

export const num = (n) => Math.round(n).toLocaleString('ja-JP');
export const yen = (n) => `${num(n)}円`;

/** 円を読みやすく：8,583,468,330 → 85億8,346万円 */
export function man(n) {
  n = Math.round(n || 0);
  if (n === 0) return '0円';
  if (n < 10000) return `${num(n)}円`;
  const oku = Math.floor(n / 1e8);
  const manPart = Math.floor((n % 1e8) / 1e4);
  if (oku > 0) return manPart > 0 ? `${num(oku)}億${num(manPart)}万円` : `${num(oku)}億円`;
  return `${num(manPart)}万円`;
}

/** 円をそのまま漢数字の単位で：5,001,651,420 → 50億165万1,420円 */
export function yenJa(n) {
  n = Math.round(n || 0);
  if (n < 10000) return `${num(n)}円`;
  const oku = Math.floor(n / 1e8);
  const manPart = Math.floor((n % 1e8) / 1e4);
  const rest = n % 1e4;
  return `${oku ? `${num(oku)}億` : ''}${manPart ? `${num(manPart)}万` : ''}${rest ? num(rest) : ''}円`;
}

/** 上限額の表示：1,200,000,000 → 12億円、700,000,020 → 7億円 */
export function capLabel(n) {
  if (!Number.isFinite(n)) return 'なし';
  const oku = n / 1e8;
  if (oku >= 1 && Math.abs(oku - Math.round(oku)) < 0.001) return `${Math.round(oku)}億円`;
  return man(n);
}

export const pct = (r, digits = 1) => `${(r * 100).toFixed(digits)}%`;

/** 当せん確率の表示：1/4,782,969 */
export function odds(p) {
  if (!(p > 0)) return '—';
  const inv = 1 / p;
  if (inv < 10) return `1/${inv.toFixed(1)}`;
  const rounded = Math.round(inv);
  const exact = Math.abs(inv - rounded) < 1e-6 * inv;
  return `${exact ? '' : '約'}1/${num(rounded)}`;
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Google Search Console の確認コードを取り出す。
 * 「HTML タグ」の <meta name="google-site-verification" content="…" /> をそのまま貼っても、content の中身だけでもよい。
 * # で始まる行は説明として読み飛ばす。コードとして正しくない文字が入っていたら '' を返す。
 */
export function verificationCode(text) {
  const body = String(text || '').split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join(' ');
  const m = body.match(/content\s*=\s*["']\s*([^"']+?)\s*["']/i);
  const code = (m ? m[1] : body).trim();
  return /^[A-Za-z0-9_-]{20,100}$/.test(code) ? code : '';
}
