// ページの HTML をつくる
import { esc, num, yenJa, man, pct, odds, fmtMd, fmtMdPlain, fmtYmd, fmtShort } from './util.mjs';
import { carryoverTable, rateSeries } from './model.mjs';
import { autoGuide, autoLead, autoSourceNote, buyChances, jumboSibling, compareSentence, chanceText, chanceAtLeast, chanceOfN, oddsJa, dynamicFaq, firstPrizeNeed } from './jumbo.mjs';
import { renderGuideBody, giftTax, GIFT_AMOUNTS } from './guide.mjs';

const GROUP_LABEL = { takarakuji: '宝くじ', sports: 'スポーツくじ' };

/** 宝くじのジャンボ（賞金が決まっているくじ）か */
const isJumbo = (d) => d?.model === 'fixed' && d.group === 'takarakuji';
/** 抽せんが終わったジャンボか（ページは残し、宝くじ一覧とサイドバーでは「終わったジャンボ宝くじ」にまとめる） */
export const isPastJumbo = (d, today) => isJumbo(d) && !!d.drawDate && d.drawDate < today;
/** ジャンボは年を付けた名前で呼ぶ（「年末ジャンボ 2026」のように年を付けて探す人が多いため）：年末ジャンボ宝くじ2026 */
export const yearName = (d) => (isJumbo(d) && /^\d{4}-/.test(d.salesStart || '') && !/\d{4}/.test(d.name) ? `${d.name}${d.salesStart.slice(0, 4)}` : d.name);

/**
 * 「宝くじ一覧」の並び：data/catalog.json の order のとおり。order にないくじ（自動で登録したジャンボなど）は、
 * data/games.json で直前にあるくじのすぐ後ろに入れる
 */
export function mergeOrder(order = [], ids = []) {
  const out = order.filter((id) => ids.includes(id));
  ids.forEach((id, i) => {
    if (out.includes(id)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) at = out.indexOf(ids[j]);
    out.splice(at + 1, 0, id);
  });
  return out;
}

/** 金額はすべて「○億○万○円」 */
const yen = (n) => yenJa(Math.round(Number(n) || 0));

/** シェアの画像の大きさ：サイト共通の og.png（1.91:1）と、くじ別の画像（static/og。Google Discover の推奨の16:9） */
const OG_DEFAULT = { width: 1200, height: 630 };
export const OG_SIZE = { width: 1200, height: 675 };

/** 当せん確率の%表示：1/6,096,454 → 0.0000164% */
export function probPct(p) {
  if (!(p > 0)) return '—';
  const v = p * 100;
  let s = v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toPrecision(3);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return `${s}%`;
}

const pct2 = (r) => `${(r * 100).toFixed(2)}%`;

/** 当選確率の文での言い方：1/6,096,454 → 609万6,454分の1（割り切れないときは「約」を付ける） */
export function oddsKanji(p) {
  if (!(p > 0)) return '—';
  const inv = 1 / p;
  const r = Math.round(inv);
  return `${Math.abs(inv - r) < 1e-6 * inv ? '' : '約'}${yenJa(r).replace(/円$/, '')}分の1`;
}

/** ポイント還元率の表示：0.02 → 2.0%、0.00333 → 0.33% */
export function fmtPt(v) {
  const x = (Number(v) || 0) * 100;
  return `${x >= 1 || x === 0 ? x.toFixed(1) : String(Math.round(x * 100) / 100)}%`;
}

const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const isoOfDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const addDays = (iso, k) => isoOfDay(dayNum(iso) + k);
const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;

const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2.3 7.4l5.1 4.1L12 4.3l4.6 7.2 5.1-4.1-2.1 11.6H4.4z"/><rect fill="currentColor" x="4.4" y="20" width="15.2" height="2.3" rx=".6"/></svg>';
const CLOCK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 6.8V12l3.6 2.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

/**
 * 「目的別のおすすめ」（購入場所のページ）。route は config/points.json の id。
 * pay を書くと、その支払い方法で払ったときの率を書く（書かなければ、いちばんポイントが付く支払い方法）
 */
const PICKS = [
  { title: 'ジャンボもロトも1か所で買いたい', route: 'takarakuji' },
  { title: 'BIG・DUNKをポイント重視で買いたい', route: 'rakuten_toto' },
  { title: 'dポイントを貯めている', route: 'docomo_toto', pay: 'dカードで払う' },
  { title: '銀行口座ひとつにまとめたい', route: 'rakutenbank_toto' },
];

export function createRenderer(ctx) {
  const { site, links, rows, byId, log, history, catalog, now, preview } = ctx;
  const points = ctx.points || { routes: [] };
  const base = String(site.baseUrl || '').replace(/\/$/, '');
  const hhmm = `${String(now.hh).padStart(2, '0')}:${String(now.mm).padStart(2, '0')}`;
  const nowText = `${fmtMd(now.iso)}${now.hh}時${String(now.mm).padStart(2, '0')}分`;
  const listed = rows.filter((r) => r.listed).sort((a, b) => Math.round(b.rate * 1000) - Math.round(a.rate * 1000) || ctx.order[a.id] - ctx.order[b.id]);
  const rankOf = Object.fromEntries(listed.map((r) => [r.id, 1 + listed.filter((x) => Math.round(x.rate * 1000) > Math.round(r.rate * 1000)).length]));
  const coList = listed.filter((r) => r.hasCO && r.carryover > 0).sort((a, b) => b.carryover - a.carryover);
  const hasContact = !!(site.contactFormUrl || site.contactEmail);
  const overrides = ctx.overrides || {};
  const guides = ctx.guides?.games || {}; // くじ別ページの解説とよくある質問（data/guides.json）
  const shops = links.shops || {};
  const signups = links.signups || {};
  /** くじの購入先（config/links.json の games。書いていないジャンボは jumboDefault） */
  const gameLinks = (id) => links.games?.[id] || (isJumbo(ctx.defs[id]) ? links.jumboDefault || [] : []);

  /** くじ別ページの画像（static/og。build.mjs がファイル名の一覧を渡す） */
  const ogSet = new Set(ctx.ogImages || []);
  /** くじの ID と同じ名前の画像。ジャンボは季節ごと（年末ジャンボミニ2026 → jumbo-nenmatsu）、なければ jumbo。どれもなければ null（サイト共通の og.png） */
  function ogKeyOf(id) {
    if (ogSet.has(id)) return id;
    if (!isJumbo(ctx.defs[id])) return null;
    const season = (String(id).match(/^([a-z]+?)(?:mini|petit)?\d{4}/) || [])[1];
    if (season && ogSet.has(`jumbo-${season}`)) return `jumbo-${season}`;
    return ogSet.has('jumbo') ? 'jumbo' : null;
  }
  const ogImage = (key, alt) => (key && ogSet.has(key) ? { src: `og/${key}.png`, ...OG_SIZE, alt } : null);

  /** 解説ページ（content/guide/*.md を build.mjs が読んで渡す。order の順） */
  const HUB_NAME = '宝くじの基礎知識';
  const HUB_PATH = 'guide.html';
  const guideList = [...(ctx.guidePages || [])].sort((a, b) => (a.meta.order ?? 99) - (b.meta.order ?? 99) || a.slug.localeCompare(b.slug));
  const guideBySlug = Object.fromEntries(guideList.map((g) => [g.slug, g]));
  const guidePath = (g) => `guide/${g.slug}.html`;
  const guideName = (g) => g.meta.h1 || g.meta.title || g.slug;
  /** ほかのページから解説ページへの「くわしく」のリンク（そのページがなければ何も出さない） */
  const guideMore = (slug, rel) => (guideBySlug[slug] ? `<p class="more-link"><a href="${rel}${guidePath(guideBySlug[slug])}">${esc(guideName(guideBySlug[slug]))} ›</a></p>` : '');
  const guideLinks = (rel, exclude = null) => `<div class="related guides">${guideList.filter((g) => g.slug !== exclude).map((g) => `<a href="${rel}${guidePath(g)}"><span>${esc(g.meta.short || guideName(g))}</span></a>`).join('')}</div>`;
  const guideListCards = (rel) => `<div class="guide-list">${guideList.map((g) => `<a class="gl-card" href="${rel}${guidePath(g)}"><b>${esc(guideName(g))}</b><span>${esc(g.meta.description || '')}</span><span class="gl-more">読む ›</span></a>`).join('')}</div>`;

  /* ---------------- ポイント ---------------- */

  const byOrder = (a, b) => (ctx.order[a] ?? 99) - (ctx.order[b] ?? 99);
  const shopGames = {};
  for (const gid of Object.keys(ctx.defs)) {
    for (const l of gameLinks(gid)) if (shops[l.shop] && !(shopGames[l.shop] ||= []).includes(gid)) shopGames[l.shop].push(gid);
  }
  for (const k of Object.keys(shopGames)) shopGames[k].sort(byOrder);
  const routes = (points.routes || []).filter((rt) => shops[rt.shop]);
  const routeByShop = Object.fromEntries(routes.map((rt) => [rt.shop, rt]));
  const campaigns = (points.campaigns || []).filter((c) => !c.until || c.until >= now.iso);
  const noPoint = new Set(points.noPoint || []);
  const checkedOn = points.checkedOn || now.iso;

  /**
   * 期間限定のキャンペーン（config/campaigns.json。抽せんや特典なので、ポイント込みの還元率には足さない）。
   * from から until までのあいだだけ出す。games がなければ shop で買えるくじすべて（shop もなければ、すべてのくじ）
   */
  const cpData = ctx.campaigns || {};
  const cpItems = (cpData.items || []).filter((c) => c?.title && c.url && (!c.from || c.from <= now.iso) && (!c.until || c.until >= now.iso))
    .sort((a, b) => String(a.until || '9999').localeCompare(String(b.until || '9999')) || String(a.title).localeCompare(String(b.title)));
  const cpFor = (gid) => cpItems.filter((c) => (c.games ? c.games.includes(gid) : c.shop ? (shopGames[c.shop] || []).includes(gid) : true));
  /** キャンペーンの対象のくじ（ジャンボは年付きの名前） */
  function cpTarget(c) {
    const ids = (c.games || (c.shop ? shopGames[c.shop] || [] : [])).filter((id) => ctx.defs[id]);
    if (!ids.length) return '';
    return c.games && ids.some((id) => isJumbo(ctx.defs[id])) ? ids.map((id) => yearName(ctx.defs[id])).join('・') : gamesLabel(ids);
  }
  function cpList(list, { target = false } = {}) {
    return `<ul class="cp-list">${list.map((c) => {
      const who = [c.shop && shops[c.shop] ? shops[c.shop].name : '購入場所を問わず', target && cpTarget(c) ? `対象：${cpTarget(c)}` : ''].filter(Boolean).join('・');
      return `<li><p class="cp-name"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>${c.until ? `<span class="cp-until">${esc(c.until.slice(0, 4) === String(now.y) ? fmtMd(c.until) : fmtYmd(c.until))}まで</span>` : ''}</p><p class="cp-who">${esc(who)}</p><p>${esc(c.text || '')}</p></li>`;
    }).join('')}</ul>`;
  }
  const cpNote = () => `<p class="note">※条件と期間は、リンク先の公式ページで確かめてください（${fmtYmd(cpData.checkedOn || now.iso)}に確認）。抽せんの特典は、還元率とポイント込みの還元率には入れていません。</p>`;

  const partRate = (p, price) => (Number.isFinite(p.rate) ? p.rate : Number.isFinite(p.perUnit) && price > 0 ? p.perUnit / price : null);

  /**
   * その買い方で、あるくじを買ったときのポイント還元率（分かっている分だけ足す）。
   * 支払い方法のポイント（parts の pay がある項目。PayPayクレジット・楽天カード・リクルートカードなど）は、
   * どれか1つで払うので、いちばん高いものだけを足す。how は、その支払い方法の説明（pay がなければ route の how）
   */
  function routeRateFor(rt, gid, onlyPay = null) {
    const price = ctx.defs[gid]?.price || 0;
    let rate = 0;
    let plus = false;
    let pay = null;
    let payUnknown = false;
    for (const p of rt.parts || []) {
      const v = partRate(p, price);
      if (p.pay && onlyPay && p.pay !== onlyPay) continue; // 支払い方法を決めたとき（目的別のおすすめ）は、それだけ
      if (p.pay) { if (v == null) payUnknown = true; else if (!pay || v > pay.v + 1e-12) pay = { v, p }; continue; }
      if (v == null) plus = true; else rate += v;
    }
    // 率の分かる支払い方法があれば、そのいちばん高いもの。率の分からない支払い方法（ほかのカード）しかなければ「＋α」
    if (pay) rate += pay.v; else if (payUnknown) plus = true;
    for (const c of campaigns) if (c.route === rt.id && Number.isFinite(c.rate) && (!c.games || c.games.includes(gid))) rate += c.rate;
    return { rate, plus, how: pay ? pay.p.pay : rt.how || '' };
  }

  /** 買い方の最大のポイント還元率（買えるくじのうち一番高いもの）。onlyPay … 支払い方法を決めるとき（pay の文） */
  function routeMax(rt, onlyPay = null) {
    let best = { rate: 0, plus: false, how: rt.how || '' };
    for (const gid of shopGames[rt.shop] || []) {
      const x = routeRateFor(rt, gid, onlyPay);
      if (x.rate > best.rate || (x.rate === best.rate && x.plus)) best = x;
    }
    return best;
  }
  /** 支払い方法のポイントが2つ以上ある買い方（「どれか1つ」と添える） */
  const payCount = (rt) => (rt.parts || []).filter((p) => p.pay).length;

  const bestCache = {};
  /** そのくじを一番ポイントが付く買い方で買ったとき */
  function bestRoute(gid) {
    if (gid in bestCache) return bestCache[gid];
    let best = null;
    for (const rt of routes) {
      if (!(shopGames[rt.shop] || []).includes(gid)) continue;
      const x = routeRateFor(rt, gid);
      if (!(x.rate > 0)) continue;
      if (!best || x.rate > best.rate + 1e-9) best = { route: rt, ...x };
    }
    bestCache[gid] = best;
    return best;
  }
  const effRate = (r) => r.rate + (bestRoute(r.id)?.rate || 0);

  /**
   * そのくじでポイントがいちばん付く買い方の説明（同じ率の買い方は全部）。解説の文に使う：
   *   「宝くじ公式サイトをPayPayクレジットで払う方法（2.0%）」「楽天toto・ドコモスポーツくじをリクルートカードで払う方法（どちらも2.2%）」
   *   「楽天totoを楽天カードで払う方法と、ドコモスポーツくじをdカードで払う方法（どちらも2.0%）」。ポイントが付く買い方がなければ空
   */
  function bestPointText(gid) {
    const list = [];
    for (const rt of routes) {
      if (!(shopGames[rt.shop] || []).includes(gid)) continue;
      const x = routeRateFor(rt, gid);
      if (x.rate > 0) list.push({ rt, ...x });
    }
    if (!list.length) return '';
    const top = Math.max(...list.map((x) => x.rate));
    const tops = list.filter((x) => x.rate > top - 1e-9);
    const name = (x) => shops[x.rt.shop]?.name || x.rt.shop;
    const way = (names, how) => `${names}${how ? `を${how}方法` : 'で買う方法'}`;
    const hows = [...new Set(tops.map((x) => x.how))];
    const body = hows.length === 1 ? way(tops.map(name).join('・'), hows[0]) : tops.map((x) => way(name(x), x.how)).join('と、');
    return `${body}（${tops.length > 2 ? 'いずれも' : tops.length === 2 ? 'どちらも' : ''}${fmtPt(top)}）`;
  }
  /** data/guides.json の文の {{pt}} を、そのくじでポイントがいちばん付く買い方に置き換える（ポイントの率が変わっても文を直さなくてよいように） */
  const gdFill = (text, gid) => String(text).replace(/\{\{pt\}\}/g, () => bestPointText(gid) || 'ポイント還元ランキングで比べている買い方');

  const routesRanked = routes.map((rt) => ({ rt, ...routeMax(rt) }))
    .sort((a, b) => b.rate - a.rate || (b.plus ? 0 : 1) - (a.plus ? 0 : 1) || (shopGames[b.rt.shop]?.length || 0) - (shopGames[a.rt.shop]?.length || 0));
  const routeRank = (x) => 1 + routesRanked.filter((y) => y.rate > x.rate + 1e-9).length;
  const topRoutes = routesRanked.filter((x) => x.rate > 0);

  function shopPoint(shopId) {
    const rt = routeByShop[shopId];
    if (!rt) return null;
    return routeMax(rt);
  }

  function ptText(x) {
    if (!x) return '';
    if (x.rate > 0) return `${fmtPt(x.rate)}${x.plus ? '＋α' : ''}`;
    return x.plus ? 'カードのポイント' : '';
  }

  /** くじの名前をまとめて短く：BIG 5種 → BIG系5種、ナンバーズ4・3 → ナンバーズ */
  function gamesLabel(ids) {
    const set = new Set(ids);
    const bigs = ['big', 'megabig', 'big100', 'big1000', 'minibig'].filter((x) => ctx.defs[x]);
    const dunks = ['dunk10', 'dunk6a', 'dunk6b'].filter((x) => ctx.defs[x]);
    const allIn = (a) => a.length > 1 && a.every((x) => set.has(x));
    const out = [];
    for (const id of [...ids].sort(byOrder)) {
      const d = ctx.defs[id];
      let label = d.name;
      if (d.model === 'fixed') label = 'ジャンボ';
      else if ((id === 'numbers4' || id === 'numbers3') && set.has('numbers4') && set.has('numbers3')) label = 'ナンバーズ';
      else if (bigs.includes(id) && allIn(bigs)) label = 'BIG系5種';
      else if (dunks.includes(id) && allIn(dunks)) label = 'DUNK';
      if (!out.includes(label)) out.push(label);
    }
    return out.join('・');
  }

  /* ---------------- 共通部品 ---------------- */

  const relOf = (path) => { const d = path.split('/').length - 1; return d ? '../'.repeat(d) : ''; };
  const home = (rel) => (preview ? `${rel}index.html` : rel || './');
  const pageUrl = (path) => `${base}/${path === 'index.html' ? '' : path}`;

  /** くじの購入先（ポイントが多い順。同じならリンク集の順） */
  function shopLinks(id) {
    const list = gameLinks(id).map((l, i) => {
      const shop = shops[l.shop] || {};
      const own = !!l.url && (l.affiliate || !shop.affiliate);
      const rt = routeByShop[l.shop];
      return {
        key: l.shop, i,
        name: l.name || shop.name || l.shop,
        short: shop.short || shop.name || l.shop,
        note: l.note || shop.note || '',
        url: own ? l.url : shop.url,
        affiliate: own ? !!l.affiliate : !!shop.affiliate,
        pt: rt ? routeRateFor(rt, id) : null,
      };
    }).filter((l) => l.url);
    return list.sort((a, b) => (b.pt?.rate || 0) - (a.pt?.rate || 0) || a.i - b.i);
  }

  /** リンク先の URL から、どの購入場所・申し込み先かを引く（ボタンに店のキーを渡していない所のため） */
  const linkKey = new Map();
  for (const [sid, s] of Object.entries(shops)) if (s.url) linkKey.set(s.url, { shop: sid, kind: 'buy' });
  for (const list of [...Object.values(links.games || {}), links.jumboDefault || []]) for (const l of list) if (l.url && l.shop && !linkKey.has(l.url)) linkKey.set(l.url, { shop: l.shop, kind: 'buy' });
  for (const [k, s] of Object.entries(signups)) if (s.url && !linkKey.has(s.url)) linkKey.set(s.url, { shop: k, kind: 'signup' });
  /**
   * ASP の決まりで HTML を変えられない広告リンク（config/links.json の html）。リンク先の URL から引く。
   * ASP のコードはそのまま入れ、文字は editText が true の ASP（楽天アフィリエイトの「テキストのみ」など）のときだけボタンの文字に置き換える
   */
  const snippets = new Map();
  for (const s of [...Object.values(shops), ...Object.values(signups)]) if (s.url && s.html) snippets.set(s.url, s);
  /**
   * 購入場所・申し込みのボタン。クリックの計測（GA4 の shop_click）のため、どこへのリンクかを data-shop・data-kind に書く。
   *   data-shop … config/links.json の shops のキー（申し込みは signups のキー）。data-kind … buy（購入場所）か signup（口座開設・カード・会員登録）
   *   ページ内の場所（data-place）とくじ（data-kuji）は、ボタンを囲む要素から計測のスクリプトが読む
   */
  function aBtn(l, cls, label) {
    const rel = l.affiliate ? 'sponsored noopener' : 'noopener';
    const key = l.signup ? { shop: l.signup, kind: 'signup' } : l.key || l.shop ? { shop: l.key || l.shop, kind: 'buy' } : linkKey.get(l.url);
    const data = key ? ` data-shop="${esc(key.shop)}" data-kind="${key.kind}"` : '';
    const sn = snippets.get(l.url);
    if (sn) {
      // ASP のコードの中には手を加えず、ボタンの形・計測の印（data-shop）・PR は外側の枠に付ける
      const code = sn.editText ? sn.html.replace(/(<a\b[^>]*>)[\s\S]*?(<\/a>)/, (m, open, close) => `${open}${esc(label)}${close}`) : sn.html;
      return `<span class="btn ${cls} aff is-ad"${data}>${code}</span>`;
    }
    return `<a class="btn ${cls}${l.affiliate ? ' is-ad' : ''}" href="${esc(l.url)}" target="_blank" rel="${rel}"${data}>${esc(label)}</a>`;
  }

  /**
   * 広告（アフィリエイト）のボタンを含むまとまりの上に、1行だけ「PR（広告を含みます）」と書く（ボタンごとには付けない）。
   * 文字はサイトのふつうの文字に近い大きさにする（ASP の案内：小さすぎる文字や、背景と見分けにくい色はだめ）
   */
  const hasAd = (html) => /class="btn [^"]*\bis-ad\b/.test(html);
  const prLine = (text = '広告を含みます') => `<p class="pr-note"><b>PR</b>（${text}）</p>\n`;
  const prNote = (html, text) => (hasAd(html) ? prLine(text) : '') + html;

  function signupBtn(key, cls, label) {
    const s = signups[key];
    if (!s?.url) return '';
    return aBtn({ url: s.url, affiliate: !!s.affiliate, signup: key }, cls, label || s.label || s.name);
  }

  /** 店のリンクのほかに出す、口座開設・カードのボタン */
  function extraSignups(shopId) {
    const keys = [];
    const sk = shops[shopId]?.signup;
    if (sk && signups[sk]?.kind === 'bank') keys.push(sk);
    for (const k of routeByShop[shopId]?.signups || []) if (signups[k]?.kind === 'card' && !keys.includes(k)) keys.push(k);
    return keys;
  }

  /** 表の中：すべての購入先を小さなボタンで */
  function miniButtons(id) {
    const ls = shopLinks(id);
    if (!ls.length) return '<span class="sub">—</span>';
    return `<span class="minis">${ls.map((l, i) => aBtn(l, `btn-mini${i === 0 ? ' first' : ''}`, l.short)).join('')}</span>`;
  }

  const MICRO = '<p class="micro"><span>スマホで1口から</span><span>売り場に行かなくていい</span><span>当せんの照合は自動</span></p>';

  /** 大きな購入ボタン（1つ目を目立たせ、いくつかを並べる） */
  function bigButtons(id, { max = 3, rel = '', self = false, first = '' } = {}) {
    const ls = shopLinks(id);
    if (!ls.length) return '';
    if (first) ls.sort((a, b) => (b.key === first) - (a.key === first)); // 先に出す購入場所（ほかはポイントの順のまま）
    const name = ctx.defs[id]?.name || '';
    const shown = ls.slice(0, max + 1);
    const rest = ls.length - shown.length;
    const more = rest > 0 ? `<a class="btn-more" href="${self ? '' : `${rel}kuji/${id}.html`}#buy">ほか${rest}か所の購入場所 ›</a>` : '';
    return prNote(`<div class="btns">${shown.map((l, i) => (i === 0 ? aBtn(l, 'btn-main', `${l.name}で${name}を買う`) : aBtn(l, 'btn-sub', l.name))).join('')}${more}</div>`);
  }

  /** 締切（分かる場合だけ）。iso があればカウントダウンする */
  function deadlineOf(r) {
    const s = r.status || {};
    if (s.kind !== 'onsale') return null;
    if (r.def.drawDays && s.next) return { iso: `${s.next}T18:20:00+09:00`, label: `${fmtShort(s.next)} 18:20` };
    if (s.o?.salesEnd && s.o.salesEndTime) return { iso: `${s.o.salesEnd}T${s.o.salesEndTime}:00+09:00`, label: `${fmtShort(s.o.salesEnd)} ${s.o.salesEndTime}` };
    return null;
  }

  function cdHtml(r, { short = false } = {}) {
    const dl = deadlineOf(r);
    if (!dl) return '';
    return `<span class="cd" data-deadline="${dl.iso}">${CLOCK}<span class="cd-l">${short ? '締切' : r.def.drawDays ? 'ネット締切' : '販売締切'}</span><b class="cd-t">${esc(dl.label)}</b><span class="cd-r"></span></span>`;
  }

  /**
   * 店頭の発売日より前から、ネットで申し込めるジャンボ（data/games.json の earlyNet：{ from, shop }。みずほ銀行のインターネット宝くじサービスなど）。
   * 申し込める日（from）になっていて、まだ店頭の発売前なら { from, shop, name }
   */
  function earlyNetOf(d) {
    const e = d?.earlyNet;
    if (!isJumbo(d) || !e?.from || !shops[e.shop] || e.from > now.iso || now.iso >= d.salesStart) return null;
    return { from: e.from, shop: e.shop, name: shops[e.shop].name };
  }

  function ctaBox(id, r) {
    const d = ctx.defs[id];
    // 発売が終わったジャンボは買えないので、購入ボタンを出さない。発売前のジャンボは、いつから買えるかを書く
    const kind = byId[id]?.status?.kind;
    if (isJumbo(d) && kind === 'ended') return '';
    // 発売前でもネットで申し込める所があれば、その所のボタンを先に出す
    const early = kind === 'upcoming' ? earlyNetOf(d) : null;
    const b = bigButtons(id, { max: 3, self: true, first: early?.shop });
    if (!b) return '';
    const title = isJumbo(d) && kind === 'upcoming'
      ? early ? `${esc(d.name)}は${fmtMd(d.salesStart)}発売。${esc(early.name)}のネットでは${fmtMd(early.from)}から申し込めます` : `${esc(d.name)}は${fmtMd(d.salesStart)}から買えます`
      : `${esc(d.name)}をネットで買う`;
    return `<div class="cta-box"${r ? ' data-sticky-anchor' : ''} data-place="${r ? 'cta_top' : 'cta_bottom'}"><p class="cta-title">${title}</p>${r ? cdHtml(r) : ''}${b}${MICRO}</div>`;
  }

  /** 発売が終わったジャンボのページの上に出すお知らせ（いま買えるジャンボへの案内つき） */
  function endedNotice(r, rel) {
    const d = r.def;
    if (!isJumbo(d) || r.status.kind !== 'ended') return '';
    const drawn = d.drawDate < now.iso;
    const others = rows.filter((x) => x.id !== r.id && isJumbo(x.def) && ['onsale', 'upcoming'].includes(x.status.kind))
      .sort((a, b) => ctx.order[a.id] - ctx.order[b.id])
      .map((x) => `<a href="${rel}kuji/${x.id}.html">${esc(x.def.name)}</a>（${x.status.kind === 'onsale' ? `${fmtMd(x.def.salesEnd)}まで発売中` : `${fmtMd(x.def.salesStart)}から発売`}）`);
    return `<p class="notice">${esc(d.name)}の発売は${fmtYmd(d.salesEnd)}で終わりました。抽せん日は${fmtYmd(d.drawDate)}${drawn ? 'で、抽せんも終わっています' : 'です'}。${others.length ? `いま発売中・発売予定のジャンボ宝くじ：${others.join('、')}` : '次のジャンボ宝くじは、発表されしだいこのサイトに載せます。'}</p>`;
  }

  function rankMark(rank) {
    if (rank <= 3) return `<span class="rk rk${rank}">${CROWN}<b>${rank}</b><i>位</i></span>`;
    return `<span class="rk rkn"><b>${rank}</b><i>位</i></span>`;
  }

  function bar(rate) {
    const w = Math.max(0, Math.min(100, rate * 100));
    return `<span class="bar" aria-hidden="true"><i class="${rate >= 0.5 ? 'hi' : ''}" style="width:${w.toFixed(1)}%"></i></span>`;
  }

  /** 数字のカウントアップ（JSがなくても最終の値が出る） */
  const cuPct = (rate) => `<span class="cu" data-to="${(rate * 100).toFixed(1)}" data-dec="1">${(rate * 100).toFixed(1)}</span>`;
  const cuYen = (n) => `<span class="cuy" data-to="${Math.round(n)}">${yen(n)}</span>`;

  function statusBadges(r, { co = true } = {}) {
    const t = [];
    if (r.special?.on) t.push(`<span class="badge gold" title="1等の上限${esc(r.special.capText)}">${esc(r.special.name)}</span>`);
    if (co && r.hasCO && r.carryover > 0) t.push('<span class="badge hot">キャリーオーバー発生中</span>');
    if (r.provisional) t.push('<span class="badge wait">暫定</span>');
    if (r.status.kind === 'before') t.push('<span class="badge gray">販売前</span>');
    if (r.status.kind === 'closed') t.push('<span class="badge gray">結果待ち</span>');
    if (r.status.kind === 'stale' || r.status.kind === 'unknown') t.push('<span class="badge gray">情報待ち</span>');
    return t.join(' ');
  }

  /** 1等の金額・確率 */
  function firstPrize(r) {
    const d = r.def;
    if (d.model === 'numbers') {
      const h = d.types[0].hits[0];
      return { amount: h.prize, note: 'ストレート・理論値', p: h.count / d.combos };
    }
    const top = r.ev.top || r.ev.rows?.[0];
    if (!top) return null;
    if (d.model === 'fixed') return { amount: top.expected, note: `${num(top.count)}本`, p: top.p };
    if (d.model === 'theoretical') return { amount: top.theo, note: '理論値', p: top.p };
    const capped = Number.isFinite(top.cap) && top.expected >= top.cap * 0.995;
    return { amount: capped ? top.cap : top.expected, note: Number.isFinite(top.cap) ? `上限${yen(top.cap)}` : '', capped, p: top.p };
  }

  /** くじの決まりとしての1等の上限：3億円（キャリーオーバー時6億円） */
  function capBaseText(d) {
    const top = d.tiers?.find((t) => t.top);
    if (!top?.capNormal) return '';
    return top.capCO ? `${yen(top.capNormal)}（キャリーオーバー時${yen(top.capCO)}）` : yen(top.capNormal);
  }

  /** 宝くじ一覧用：BIG777 のような特別開催回の上限も書き添える */
  function capRuleText(d) {
    const base = capBaseText(d);
    return base && d.special ? `${base}。${d.special.name}の回（毎月7日を含む週）は、キャリーオーバーの有無にかかわらず${d.special.capText}` : base;
  }

  /** いま販売中の回の1等の上限 */
  const capTextOf = (r) => {
    if (r.special?.on) return `${r.special.capText}（第${r.special.round}回は${r.special.name}の回のため、キャリーオーバーの有無にかかわらず。通常は${capBaseText(r.def)}）`;
    return r.capCO ? `${yen(r.capNormal)}（キャリーオーバー時${yen(r.capCO)}）` : r.capNormal ? yen(r.capNormal) : '';
  };

  const seriesCache = {};
  const seriesOf = (r) => {
    if (!seriesCache[r.id]) {
      const s = rateSeries(r.def, ctx.state.games?.[r.id], history.days, r.def.special ? overrides[r.def.special.id] : undefined);
      if (r.listed && Number.isFinite(r.rate) && !s.some((p) => p.d === now.iso)) s.push({ d: now.iso, v: Math.round(r.rate * 10000) / 10000, calc: false });
      seriesCache[r.id] = s;
    }
    return seriesCache[r.id];
  };

  /** 前日比（前の日の値があるときだけ） */
  function delta(r) {
    if (!Number.isFinite(r.rate)) return '';
    const prev = [...seriesOf(r)].reverse().find((p) => p.d < now.iso);
    if (!prev || prev.d < addDays(now.iso, -3)) return '';
    const diff = (r.rate - prev.v) * 100;
    if (Math.abs(diff) < 0.05) return '<span class="delta">前日と同じ</span>';
    return `<span class="delta ${diff > 0 ? 'up' : 'down'}">前日比 ${diff > 0 ? '▲+' : '▼'}${diff.toFixed(1)}pt</span>`;
  }

  function ad(slot) {
    const a = site.adsense || {};
    if (!preview && a.client && a.slots?.[slot]) {
      return `<div class="ad"><span class="ad-label">スポンサーリンク</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(a.client)}" data-ad-slot="${esc(a.slots[slot])}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`;
    }
    if (site.showAdPlaceholders || ctx.placeholders) {
      return `<div class="ad"><span class="ad-label">スポンサーリンク</span><div class="ad-ph">広告枠（${esc(slot)}）<br>AdSense の審査に通ると、ここに広告が表示されます</div></div>`;
    }
    return '';
  }

  function share(path, text) {
    const u = encodeURIComponent(pageUrl(path));
    const t = encodeURIComponent(text);
    return `<div class="share" role="group" aria-label="この記事をシェア">
<a class="sx" href="https://twitter.com/intent/tweet?text=${t}&amp;url=${u}" target="_blank" rel="noopener">Xでポスト</a>
<a class="sl" href="https://social-plugins.line.me/lineit/share?url=${u}" target="_blank" rel="noopener">LINEで送る</a>
<a class="sf" href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener">Facebook</a>
<a class="sh" href="https://b.hatena.ne.jp/add?mode=confirm&amp;url=${u}" target="_blank" rel="noopener">はてブ</a>
</div>`;
  }

  function toc(items) {
    return `<nav class="toc" aria-label="目次"><p class="toc-title">目次</p><ol>${items.map(([id, t]) => `<li><a href="#${id}">${esc(t)}</a></li>`).join('')}</ol></nav>`;
  }

  function crumbs(rel, items) {
    const all = [{ name: 'トップ', href: home(rel) }, ...items];
    return `<p class="crumbs">${all.map((c, i) => (i < all.length - 1 ? `<a href="${c.href}">${esc(c.name)}</a>` : esc(c.name))).join(' ＞ ')}</p>`;
  }

  /** パンくずの構造化データ。parent（{ name, path }）を渡すと、トップとページの間に入れる */
  function breadcrumbLd(path, name, parent = null) {
    const items = [{ name: 'トップ', item: `${base}/` }, ...(parent ? [{ name: parent.name, item: pageUrl(parent.path) }] : []), { name, item: pageUrl(path) }];
    return {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, ...x })),
    };
  }

  const updatedLine = (extra = '') => `<p class="updated"><span class="badge">毎日更新</span><span>最終更新：${fmtYmd(now.iso)} ${hhmm}</span>${extra}</p>`;

  function related(rel, exclude) {
    const items = listed.filter((r) => r.id !== exclude);
    return `<div class="related">${items.map((r) => `<a href="${rel}kuji/${r.id}.html"><span>${esc(r.def.name)}</span><span class="num">${pct(r.rate)}</span></a>`).join('')}</div>`;
  }

  function faqHtml(items) {
    return `<dl class="faq">${items.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl>`;
  }

  /** くじ別ページの解説（data/guides.json の about）。話題ごとのカードにして、ラベル・要点・マーカーで拾い読みしやすくする */
  const svgIc = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const GUIDE_TYPES = {
    rules: { label: '遊び方', icon: svgIc('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>') },
    rate: { label: '還元率', icon: svgIc('<circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="17" r="2.6"/><path d="M19 5 5 19"/>') },
    odds: { label: '当たりやすさ', icon: svgIc('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>') },
    buy: { label: '買える場所', icon: svgIc('<path d="M3 4h2.2l2.4 11.2h10.9L21 8H6.4"/><circle cx="10" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>') },
  };
  // **…** の部分を、黄色いマーカーの太字にする（ほかの記号は文字のまま）
  const richText = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong class="marker">$1</strong>');
  function guideCards(about) {
    return `<div class="guide">
${about.map((a) => {
    const ty = GUIDE_TYPES[a.type] || {};
    const label = a.label || ty.label;
    const head = label ? `<div class="gd-head">${ty.icon ? `<span class="gd-ic" aria-hidden="true">${ty.icon}</span>` : ''}<h3>${esc(label)}</h3>${a.key ? `<span class="gd-key">${esc(a.key)}</span>` : ''}</div>` : '';
    return `<section class="gd-card${GUIDE_TYPES[a.type] ? ` gd-${a.type}` : ''}">${head}<p>${richText(a.text)}</p></section>`;
  }).join('\n')}
</div>`;
  }

  function faqLd(items) {
    return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
  }

  /** 画面の下に出る購入ボタン（スマホ） */
  function sticky(r) {
    const ls = shopLinks(r.id);
    if (!ls.length) return '';
    const dl = deadlineOf(r);
    return `<div class="sticky-cta" role="region" aria-label="購入ボタン" data-place="sticky" data-kuji="${r.id}"><div class="sc-info"><b>${esc(r.def.name)}</b><span>還元率 ${pct(r.rate)}${dl ? `・締切 ${esc(dl.label)}` : ''}</span></div>${(() => { const b = aBtn(ls[0], 'btn-main', 'ネットで買う'); return `${hasAd(b) ? '<span class="pr-mark">PR</span>' : ''}${b}`; })()}</div>`;
  }

  /** 買い方のカード（トップ・購入場所・ポイント還元のページで共通） */
  function routeCard(x, { rel = '', compact = false } = {}) {
    const rt = x.rt;
    const s = shops[rt.shop];
    const keys = rt.signups || [];
    const games = gamesLabel(shopGames[rt.shop] || []);
    const btns = [aBtn({ url: s.url, affiliate: !!s.affiliate }, 'btn-sub', `${s.name}へ`), ...keys.filter((k) => signups[k] && signups[k].kind !== 'site').map((k) => signupBtn(k, 'btn-sub'))];
    // 会員登録のボタン（「楽天totoをはじめる」など）。店のリンクが広告リンクのときは、登録もそのリンクの先でできる（ASP の成果の対象）ので出さない
    if (keys[0] && signups[keys[0]]?.kind === 'site' && !s.affiliate && !compact) btns.splice(1, 0, signupBtn(keys[0], 'btn-ghost'));
    return `<article class="rt-card">
<div class="rt-top">${x.rate > 0 ? `<span class="rt-lbl">ポイント最大</span><span class="num">${cuPct(x.rate)}<small>%</small></span>${x.plus ? '<span class="rt-plus">＋α</span>' : ''}` : '<span class="rt-lbl">ポイント</span><span class="rt-none">支払いに使うカードのポイントが付く</span>'}</div>
<p class="rt-name">${esc(s.name)}${x.how ? `<span>× ${esc(x.how)}</span>` : ''}</p>
<p class="rt-games">${esc(games)}</p>
<p class="rt-desc">${esc(rt.feature || '')}</p>
${compact ? '' : `<ul class="parts">${(rt.parts || []).map((p) => { const v = partRate(p, Math.min(...(shopGames[rt.shop] || []).map((g) => ctx.defs[g].price))); return `<li><b>${v == null ? '＋α' : fmtPt(v)}</b><span>${esc(p.name)}${p.pay && payCount(rt) > 1 ? `<span class="pay">（${esc(p.pay)}場合）</span>` : ''}<span class="sub">${esc(p.detail || '')}</span></span></li>`; }).join('')}</ul>${payCount(rt) > 1 ? '<p class="pay-note">支払いのポイントは、使った支払い方法の1つ分です</p>' : ''}`}
${prNote(`<div class="btns">${btns.join('')}</div>`)}
</article>`;
  }

  /* ---------------- サイドバー・ヘッダー・フッター ---------------- */

  function sidebar(rel, ads = true) {
    const top5 = listed.slice(0, 5).map((r) => `<li><a href="${rel}kuji/${r.id}.html">${rankMark(rankOf[r.id])}<span>${esc(r.def.name)}</span><span class="val">${pct(r.rate)}</span></a></li>`).join('');
    const cos = coList.map((r) => `<li><a href="${rel}kuji/${r.id}.html"><span>${esc(r.def.name)}</span><span class="val small">${yen(r.carryover)}</span></a></li>`).join('');
    const pts = topRoutes.slice(0, 3).map((x) => `<li><a href="${rel}point.html">${rankMark(routeRank(x))}<span>${esc(shops[x.rt.shop].name)}<span class="sub">${esc(x.how || '')}</span></span><span class="val">${fmtPt(x.rate)}</span></a></li>`).join('');
    const all = rows.filter((r) => r.computable && !isPastJumbo(r.def, now.iso)).sort((a, b) => ctx.order[a.id] - ctx.order[b.id])
      .map((r) => `<li><a href="${rel}kuji/${r.id}.html"><span>${esc(r.def.name)}</span><span class="val">${pct(r.rate)}</span></a></li>`).join('');
    return `<aside class="side" aria-label="サイドバー">
<section class="widget"><h2 class="widget-title red">今日の還元率TOP5</h2><ol>${top5}</ol></section>
${cos ? `<section class="widget plain"><h2 class="widget-title">キャリーオーバー発生中</h2><ul>${cos}</ul></section>` : ''}
${pts ? `<section class="widget"><h2 class="widget-title gold">ポイント還元TOP3</h2><ol>${pts}</ol><p class="w-more"><a href="${rel}point.html">ポイント還元ランキングを見る ›</a></p></section>` : ''}
${ads ? ad('sidebar') : ''}
<section class="widget plain"><h2 class="widget-title">くじ別の還元率</h2><ul>${all}</ul></section>
${guideList.length ? `<section class="widget plain"><h2 class="widget-title">${HUB_NAME}</h2><ul>${guideList.map((g) => `<li><a href="${rel}${guidePath(g)}"><span>${esc(g.meta.short || guideName(g))}</span></a></li>`).join('')}</ul><p class="w-more"><a href="${rel}${HUB_PATH}">${HUB_NAME}の一覧 ›</a></p></section>` : ''}
<section class="widget"><h2 class="widget-title">このサイトについて</h2><div class="w-body"><p>宝くじとスポーツくじの還元率を、キャリーオーバーや売上をもとに毎日計算し直しています。</p><p><a href="${rel}keisan.html">計算方法を見る</a>・<a href="${rel}about.html">運営者情報</a></p></div></section>
</aside>`;
  }

  /** CSS をページに埋め込むとき（共有プレビュー）は、フォントの場所をページの階層に合わせる */
  const cssFor = (rel) => String(ctx.css || '').replace(/url\("fonts\//g, `url("${rel}fonts/`);

  /**
   * linkBase を渡すと、サイト内のリンクと CSS をその文字列から書く（404 ページ用）。渡さなければページの階層からの相対パス。
   * ads を false にすると、AdSense のコードを入れない（エラーのページのような中身のない画面には広告を置けない。Google のポリシー）
   */
  function layout({ path, title, description, body, current = null, jsonld = [], noindex = false, scripts = '', stickyHtml = '', linkBase = null, kuji = null, ads = true, image = null }) {
    const rel = linkBase ?? relOf(path);
    const url = pageUrl(path);
    const a = site.adsense || {};
    // フォントは、使う文字だけに絞ってこのサイトから配信する（static/fonts）。先に読み込みを始めて、表示の途中で字形が変わらないようにする
    const fonts = FONT_FILES.map((f) => `<link rel="preload" href="${rel}fonts/${f}" as="font" type="font/woff2" crossorigin>`).join('');
    // シェアと検索（Google Discover）の画像：くじ別ページなどは static/og の横長（16:9）の画像、ほかはサイト共通の og.png
    const img = image || { src: 'og.png', ...OG_DEFAULT };
    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(description)}">`,
      // 検索結果や Discover で、大きな画像を出してよいことを伝える（Google の案内。検索結果に出さないページには付けない）
      noindex ? '<meta name="robots" content="noindex">' : `<meta name="robots" content="max-image-preview:large">\n<link rel="canonical" href="${esc(url)}">`,
      `<meta property="og:type" content="${path === 'index.html' ? 'website' : 'article'}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:image" content="${esc(base)}/${esc(img.src)}">`,
      `<meta property="og:image:width" content="${img.width}">`,
      `<meta property="og:image:height" content="${img.height}">`,
      img.alt ? `<meta property="og:image:alt" content="${esc(img.alt)}">` : '',
      `<meta property="og:site_name" content="${esc(site.siteName)}">`,
      '<meta property="og:locale" content="ja_JP">',
      '<meta name="twitter:card" content="summary_large_image">',
      site.xAccount ? `<meta name="twitter:site" content="@${esc(site.xAccount)}">` : '',
      '<meta name="theme-color" content="#d7000f">',
      `<link rel="icon" href="${rel}favicon.svg" type="image/svg+xml">`,
      `<link rel="apple-touch-icon" href="${rel}apple-touch-icon.png">`,
      fonts,
      ctx.inlineCss ? `<style>${cssFor(rel)}</style>` : `<link rel="stylesheet" href="${rel}style.css?v=${ctx.cssVersion}">`,
      !preview ? `<script type="speculationrules">${JSON.stringify(SPECULATION_RULES)}</script>` : '',
      !preview && ctx.verification ? `<meta name="google-site-verification" content="${esc(ctx.verification)}">` : '',
      !preview && a.client ? `<meta name="google-adsense-account" content="${esc(a.client)}">` : '',
      !preview && a.client && ads ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(a.client)}" crossorigin="anonymous"></script>` : '',
      !preview && site.ga4 ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(site.ga4)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(site.ga4)}');</script>` : '',
      ...jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`),
    ].filter(Boolean).join('\n');

    const nav = [
      ['', '今日の還元率', home(rel)],
      ['point', 'ポイント還元', `${rel}point.html`],
      ['ichiran', '宝くじ一覧', `${rel}ichiran.html`],
      ['kaikata', '購入場所', `${rel}kaikata.html`],
      ['suii', '還元率の推移', `${rel}suii.html`],
      ['keisan', '計算方法', `${rel}keisan.html`],
    ].map(([k, label, href]) => `<a href="${href}"${current === k ? ' aria-current="page"' : ''}>${label}</a>`).join('');

    const ticker = coList.length
      ? `<div class="ticker"><div class="wrap"><span class="ticker-label">キャリーオーバー速報</span><div class="tk-view"><ul class="tk-list">${coList.map((r) => `<li><a href="${rel}kuji/${r.id}.html">${esc(r.def.name)}<span class="amt">${yen(r.carryover)}</span></a></li>`).join('')}</ul></div></div></div>${TICKER_JS}`
      : '';

    const inner = `<a class="skip" href="#main">本文へ移動</a>
<header>
<div class="topbar" id="top"><div class="wrap"><span><b class="live">毎日更新</b>　最終更新 ${fmtYmd(now.iso)} ${hhmm}</span><span>当サイトはプロモーション（広告）を含みます</span></div></div>
<div class="site-header"><div class="wrap">
<a class="logo" href="${home(rel)}">${CROWN}<span class="l1">宝くじ</span><span class="l2">還元率</span><span class="l3">ランキング</span></a>
<p class="tagline">${esc(site.tagline)}</p>
</div></div>
<nav class="gnav" aria-label="メニュー"><div class="wrap">${nav}</div></nav>
${ticker}
</header>
<div class="wrap layout">
<main id="main"${kuji ? ` data-kuji="${esc(kuji)}"` : ''}>
${body}
</main>
${sidebar(rel, ads)}
</div>
<footer class="foot"><div class="wrap">
<nav aria-label="サイト情報"><a href="${rel}about.html">このサイトについて${hasContact ? '・お問い合わせ' : ''}</a><a href="${rel}privacy.html">プライバシーポリシー・免責事項</a><a href="${rel}keisan.html">還元率の計算方法</a><a href="${rel}point.html">ポイント還元ランキング</a><a href="${rel}kaikata.html">購入場所</a><a href="${rel}ichiran.html">宝くじ一覧</a>${guideList.length ? `<a href="${rel}${HUB_PATH}">${HUB_NAME}</a>` : ''}</nav>
<p>還元率は公式発表のデータから自動で計算していますが、誤りを含むことがあります。当せん番号・当せん金は、宝くじは発売元、スポーツくじは日本スポーツ振興センターの発表を確認してください。ポイントの条件は各社の公式ページで確認してください。</p>
<p>スポーツくじは19歳未満の方は購入できません。のめり込みが心配なときは、お住まいの地域の精神保健福祉センターなどに相談できます（<a href="https://www.ncasa-japan.jp/you-do/treatment/treatment-map/" target="_blank" rel="noopener">全国の相談窓口を探す：依存症対策全国センター</a>）。</p>
<p class="copy">© ${esc(String(now.y))} ${esc(site.siteName)}</p>
</div></footer>
${stickyHtml}
${scripts}
${UI_JS}${!preview && site.ga4 ? `\n${CLICK_JS}` : ''}`;

    if (preview && path === 'index.html') {
      return `<title>${esc(site.siteName)}</title>\n${fonts}\n<style>${cssFor(rel)}</style>\n${inner}\n`;
    }
    return `<!doctype html>\n<html lang="ja">\n<head>\n${head}\n</head>\n<body>\n${inner}\n</body>\n</html>\n`;
  }

  /* ---------------- 表 ---------------- */

  function rankTable(rel) {
    const body = listed.map((r) => {
      const d = r.def;
      const fp = firstPrize(r);
      const br = bestRoute(r.id);
      return `<tr${rankOf[r.id] === 1 ? ' class="first"' : ''} data-kuji="${r.id}">
<td class="c k-rk">${rankMark(rankOf[r.id])}</td>
<td class="k-nm"><a class="gname" href="${rel}kuji/${r.id}.html">${esc(d.name)}</a><span class="sub">${GROUP_LABEL[d.group] || ''}・1口${yen(d.price)}</span></td>
<td class="k-rt"><span class="rate${r.rate >= 0.5 ? ' hi' : ''}">${pct(r.rate)}</span>${bar(r.rate)}${br ? `<span class="sub pt">ポイント込み${pct(effRate(r))}</span>` : ''}</td>
<td class="k-co" data-label="キャリーオーバー">${r.hasCO ? `<span class="co">${yen(r.carryover)}</span>` : '<span class="sub">なし</span>'}${statusBadges(r, { co: false }) ? `<span class="sub">${statusBadges(r, { co: false })}</span>` : ''}</td>
<td class="r k-tp" data-label="1等の金額">${fp ? `<b>${yen(fp.amount)}</b>${fp.note ? `<span class="sub">${esc(fp.note)}</span>` : ''}` : '—'}</td>
<td class="r k-pb" data-label="1等の当せん確率">${fp ? `${odds(fp.p)}<span class="sub">${probPct(fp.p)}</span>` : '—'}</td>
<td class="k-nx" data-label="次の回">${esc(r.status.short || r.status.text)}${r.status.shortSub ? `<span class="sub">${esc(r.status.shortSub)}</span>` : ''}</td>
<td class="k-by">${miniButtons(r.id)}</td>
</tr>`;
    }).join('\n');
    return `${hasAd(body) ? prLine('表のボタンには広告を含みます') : ''}<div class="rank-wrap"><p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t rank">
<colgroup><col style="width:46px"><col style="width:96px"><col style="width:96px"><col style="width:112px"><col style="width:104px"><col style="width:92px"><col style="width:88px"><col style="width:172px"></colgroup>
<thead><tr><th>順位</th><th>くじ</th><th>還元率</th><th>キャリー<br>オーバー</th><th>1等の金額</th><th>1等の<br>当せん確率</th><th>次の回</th><th>購入場所</th></tr></thead>
<tbody>
${body}
</tbody></table></div>
<div class="note"><p>※還元率は、1口買ったときに戻ってくる金額の平均を、1口の値段で割ったものです。バーの縦線は50%の位置です。「ポイント込み」は、いちばんポイントが付く買い方で買った場合です（<a href="${rel}point.html">ポイント還元ランキング</a>）。</p>
<p>※1等の金額は、同じ回に1等が複数出た場合の山分けを織り込んだ平均額です。「暫定」は、前の回の結果が出る前の繰越額で計算していることを表します。購入場所のボタンは、ポイントが多い順に並べています。</p></div></div>`;
  }

  function top3Cards(rel) {
    return `<div class="top3">${listed.slice(0, 3).map((r) => {
      const fp = firstPrize(r);
      const rank = rankOf[r.id];
      const br = bestRoute(r.id);
      const cd = cdHtml(r, { short: true });
      return `<article class="rank-card c${rank}" data-kuji="${r.id}">
<div class="rc-head">${rankMark(rank)}<a class="rc-name" href="${rel}kuji/${r.id}.html">${esc(r.def.name)}</a>${statusBadges(r)}</div>
<div class="rc-body">
<div class="rc-rate"><span class="lbl">還元率</span><span class="num">${cuPct(r.rate)}<small>%</small></span>${bar(r.rate)}${delta(r)}${br ? `<p class="rc-pt"><a href="${rel}point.html">ポイント込み <b>${pct(effRate(r))}</b></a></p>` : ''}</div>
<dl class="facts">
<dt>キャリーオーバー</dt><dd>${r.hasCO ? `<span class="co">${r.carryover > 0 ? cuYen(r.carryover) : '0円'}</span>` : 'なし'}</dd>
<dt>1等の金額</dt><dd>${fp ? `<b>${yen(fp.amount)}</b>${fp.note ? `（${esc(fp.note)}）` : ''}` : '—'}</dd>
<dt>1等の当せん確率</dt><dd>${fp ? `${odds(fp.p)}（${probPct(fp.p)}）` : '—'}</dd>
<dt>次の回</dt><dd>${esc(r.status.short || r.status.text)}${cd ? `<span class="cd-line">${cd}</span>` : r.status.shortSub ? `・${esc(r.status.shortSub)}` : ''}</dd>
<dt>1口</dt><dd>${yen(r.def.price)}</dd>
</dl>
</div>
<div class="rc-cta">${bigButtons(r.id, { max: 2, rel })}</div>
</article>`;
    }).join('\n')}</div>`;
  }

  /** 等級ごとの行（くじ別ページと一覧の大表で共通） */
  /**
   * ジャンボ以外のくじの「当選確率はどれくらいですか？」（1等と、どれかの等級が当たる確率。1口で当たるのは1つの等級だけなので、足せばよい）。
   * ナンバーズは申込タイプで確率が違うので出さない
   */
  function oddsFaq(d, lines) {
    if (d.model === 'numbers' || lines.length < 2) return null;
    const first = lines[0];
    const low = lines[lines.length - 1];
    const any = lines.reduce((s, l) => s + (l.p > 0 ? l.p : 0), 0);
    if (!(first.p > 0) || !(any > 0) || any >= 1) return null;
    return [`${d.name}の当選確率はどれくらいですか？`, `1等の当選確率は${oddsJa(1 / first.p)}です。${low.name}までのどれかの等級が当たる確率は${chanceText(any)}で、平均すると${num(Math.round(1 / any))}口に1口の割合です。等級ごとの確率は「等級ごとの当せん金と確率」の表にあります。`];
  }

  function tierLines(r) {
    const d = r.def;
    const ev = r.ev;
    if (!ev.computable) return [];
    if (d.model === 'numbers') {
      return d.types.flatMap((t) => t.hits.map((h) => {
        const p = h.count / d.combos;
        return { name: t.hits.length > 1 ? `${t.name}（${h.label}）` : t.name, cond: t.cond, p, prize: yen(h.prize), sub: '理論値', contrib: (p * h.prize) / d.price };
      }));
    }
    if (d.model === 'fixed') {
      return ev.rows.map((x) => ({ name: x.name, cond: `全${num(x.count)}本`, p: x.p, prize: yen(x.expected), sub: '固定', contrib: x.contrib / d.price }));
    }
    if (d.model === 'theoretical') {
      return ev.rows.map((x) => ({ name: x.name, cond: x.cond, p: x.p, prize: yen(x.theo), sub: x.fixed ? '固定' : '理論値', contrib: x.contrib / d.price }));
    }
    return ev.rows.map((x) => {
      let prize = yen(x.expected);
      let sub;
      if (x.fixed) sub = '固定';
      else if (x.top) {
        const capped = Number.isFinite(x.cap) && x.expected >= x.cap * 0.995;
        if (capped) prize = yen(x.cap);
        sub = capped ? `上限${yen(x.cap)}` : `理論値${yen(x.theo)}・上限${yen(x.cap)}`;
      } else sub = `理論値${yen(x.theo)}`;
      return { name: x.name, cond: x.cond, p: x.p, prize, sub, contrib: x.contrib / d.price };
    });
  }

  function bigTierTable(rel) {
    const groups = rows.filter((r) => r.listed).sort((a, b) => ctx.order[a.id] - ctx.order[b.id]);
    const body = groups.map((r) => {
      const lines = tierLines(r);
      const n = lines.length;
      const d = r.def;
      const head = `<td class="gcell" rowspan="${n}"><a class="gname" href="${rel}kuji/${r.id}.html">${esc(d.name)}</a><span class="sub">1口${yen(d.price)}・${esc(r.status.short || '')}</span><span class="sub">${esc(r.status.shortSub || '')}</span>${miniButtons(r.id)}</td>`;
      const tail = `<td class="c" rowspan="${n}"><span class="rate${r.rate >= 0.5 ? ' hi' : ''}">${pct(r.rate)}</span><span class="sub">キャリーオーバー</span><span class="sub"><b class="${r.carryover > 0 ? 'red' : ''}">${r.hasCO ? yen(r.carryover) : 'なし'}</b>${r.provisional ? '（暫定）' : ''}</span>${r.capCO ? `<span class="sub">1等の上限 ${yen(r.capCO)}</span>` : ''}</td>`;
      const trs = lines.map((l, i) => `<tr>${i === 0 ? head : ''}<th scope="row">${esc(l.name)}</th><td class="r">${odds(l.p)}<span class="sub">${probPct(l.p)}</span></td><td class="r"><b>${l.prize}</b><span class="sub">${esc(l.sub)}</span></td><td class="r">${pct2(l.contrib)}</td>${i === 0 ? tail : ''}</tr>`).join('\n');
      return `<tbody class="g" data-kuji="${r.id}">\n${trs}\n</tbody>`;
    }).join('\n');
    return `${hasAd(body) ? prLine('表のボタンには広告を含みます') : ''}<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t tiers">
<thead><tr><th>くじ・購入場所</th><th>等級</th><th>当せん確率</th><th>1口の当せん金</th><th>還元率への寄与</th><th>還元率</th></tr></thead>
${body}
</table></div>
<div class="note"><p>※ロト・BIG系・DUNKのように当せん金を当せん者で分けるくじは、キャリーオーバー、1口の上限、同じ等級の当せん者との山分けを織り込んだ「当たったときに受け取れる平均額」です。理論値は、売上が今回の見込みどおりで当せん者が平均どおりに出た場合の額です。</p>
<p>※ナンバーズは申込タイプごとの値です。どのタイプを選んでも還元率はほぼ同じです。</p></div>`;
  }

  function resultsTable(rel, entries, { showGame = true } = {}) {
    if (!entries.length) return '<p>まだ記録がありません。</p>';
    const trs = entries.map((e) => {
      const d = ctx.defs[e.game];
      const t1 = e.firstWinners == null ? '—' : e.firstWinners > 0 ? `${num(e.firstWinners)}口<span class="sub">1口${yen(e.firstPrize)}</span>` : '該当なし';
      return `<tr><td>${fmtShort(e.date)}</td>${showGame ? `<td><a class="gname" href="${rel}kuji/${e.game}.html">${esc(d?.name || e.game)}</a></td>` : ''}<td class="nw">第${e.round}回</td><td class="r">${t1}</td><td class="r ${e.carryover > 0 ? 'co' : ''}">${e.carryover > 0 ? yen(e.carryover) : '0円'}</td></tr>`;
    }).join('\n');
    return `<div class="tbl-wrap"><table class="t results"><thead><tr><th>発表日</th>${showGame ? '<th>くじ</th>' : ''}<th>回</th><th>1等</th><th>次回へのキャリーオーバー</th></tr></thead><tbody>
${trs}
</tbody></table></div>`;
  }

  /* ---------------- グラフ（期間を固定して表示） ---------------- */

  /** 横軸の目盛り：1か月なら日付3つ、1年なら月の初め */
  function xTicks(from, to) {
    const span = dayNum(to) - dayNum(from);
    if (span <= 45) {
      const mid = addDays(from, Math.round(span / 2));
      return [{ iso: from, label: md(from), anchor: 'start' }, { iso: mid, label: md(mid), anchor: 'middle' }, { iso: to, label: md(to), anchor: 'end' }];
    }
    const out = [];
    let y = +from.slice(0, 4), m = +from.slice(5, 7) + 1;
    for (;;) {
      if (m > 12) { m = 1; y += 1; }
      const iso = `${y}-${String(m).padStart(2, '0')}-01`;
      if (iso > to) break;
      out.push({ iso, label: m === 1 ? `${y}年1月` : `${m}月`, anchor: 'middle' });
      m += 1;
    }
    return out.length > 7 ? out.filter((_, i) => (out.length - 1 - i) % 2 === 0) : out;
  }

  function chartSvg(pts, label, from, to) {
    const W = 520, H = 190, L = 40, R = 58, T = 14, B = 30;
    if (!pts.length) return '<p class="note">この期間の記録はまだありません。</p>';
    const vals = pts.map((p) => p.v);
    let lo = Math.floor((Math.min(...vals) - 0.03) * 20) / 20;
    let hi = Math.ceil((Math.max(...vals) + 0.03) * 20) / 20;
    if (hi - lo < 0.1) { lo -= 0.05; hi += 0.05; }
    lo = Math.max(0, lo);
    const f0 = dayNum(from);
    const span = Math.max(1, dayNum(to) - f0);
    const xOf = (iso) => L + ((dayNum(iso) - f0) * (W - L - R)) / span;
    const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
    const n = pts.length;
    const grid = [lo, (lo + hi) / 2, hi].map((v) => `<line class="gd" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v * 100)}%</text>`).join('');
    const ticks = xTicks(from, to).map((t) => {
      const x = xOf(t.iso).toFixed(1);
      return `<line class="gx" x1="${x}" x2="${x}" y1="${H - B}" y2="${H - B + 4}"/><text x="${x}" y="${H - 9}" text-anchor="${t.anchor}">${t.label}</text>`;
    }).join('');
    const ref = lo < 0.5 && hi > 0.5 ? `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(0.5).toFixed(1)}" y2="${y(0.5).toFixed(1)}"/>` : '';
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = n > 1 ? `<path class="ar" d="${line} L${xOf(pts[n - 1].d).toFixed(1)},${(H - B).toFixed(1)} L${xOf(pts[0].d).toFixed(1)},${(H - B).toFixed(1)} Z"/>` : '';
    const last = pts[n - 1];
    const ex = xOf(last.d), ey = y(last.v);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${esc(label)}の還元率の推移（${from}〜${to}、最新${pct(last.v)}）" data-l="${L}" data-r="${R}" data-t="${T}" data-b="${B}" data-w="${W}" data-h="${H}" data-lo="${lo}" data-hi="${hi}" data-span="${span}">
${grid}<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>${ticks}${ref}${area}${n > 1 ? `<path class="ln" pathLength="1" d="${line}"/>` : ''}<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}"/>
<circle class="pt" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4.5"/><text class="end" x="${(ex + 8).toFixed(1)}" y="${(ey + 4).toFixed(1)}">${pct(last.v)}</text></svg>`;
  }

  /** days 日分（今日まで）のグラフ */
  function chartCard(rel, r, series, { days = 30, big = false } = {}) {
    const to = now.iso;
    const from = addDays(to, -(days - 1));
    const pts = series.filter((p) => p.d >= from && p.d <= to);
    const f0 = dayNum(from);
    const data = JSON.stringify(pts.map((p) => [p.d, Math.round(p.v * 10000) / 10000, dayNum(p.d) - f0]));
    const lastV = pts.length ? pct(pts[pts.length - 1].v) : '—';
    const range = days >= 300 ? '過去1年' : `過去${days}日`;
    const sparse = big && pts.length && pts[0].d > addDays(from, 30);
    return `<div class="chart${big ? ' big' : ''}" data-series='${esc(data)}'>
<div class="chart-head">${big ? `<span>${esc(r.def.name)}の還元率<span class="range">${range}</span></span>` : `<span><a href="${rel}kuji/${r.id}.html">${esc(r.def.name)}</a><span class="range">${range}</span></span>`}<span class="num">${lastV}</span></div>
${chartSvg(pts, r.def.name, from, to)}
<div class="tip" role="status"></div>
${pts.length > 0 && pts.length < 2 ? '<p class="note">記録が2日分以上たまると線になります。</p>' : ''}
${sparse ? `<p class="note">記録があるのは${fmtShort(pts[0].d)}以降です。1年分そろうまで、毎日の更新で公式データをさかのぼって集めます。</p>` : ''}
</div>`;
  }

  const CHART_JS = `<script>
(function(){
  document.querySelectorAll('.chart[data-series]').forEach(function(el){
    var svg = el.querySelector('svg.spark'); var tip = el.querySelector('.tip');
    if (!svg || !tip) return;
    var data; try { data = JSON.parse(el.getAttribute('data-series')); } catch (e) { return; }
    var n = data.length; if (n < 1) return;
    var W = +svg.dataset.w, H = +svg.dataset.h, L = +svg.dataset.l, R = +svg.dataset.r, T = +svg.dataset.t, B = +svg.dataset.b, lo = +svg.dataset.lo, hi = +svg.dataset.hi;
    var xh = svg.querySelector('.xh'); var cur = n - 1; var span = +svg.dataset.span || 1;
    function px(i){ return L + data[i][2] * (W - L - R) / span; }
    function py(v){ return T + (hi - v) * (H - T - B) / (hi - lo); }
    function show(i){
      cur = Math.max(0, Math.min(n - 1, i));
      var x = px(cur); xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.style.opacity = 1;
      tip.textContent = '';
      var b = document.createElement('b'); b.textContent = (data[cur][1] * 100).toFixed(1) + '%';
      var s = document.createElement('span'); var d = data[cur][0].split('-'); s.textContent = (+d[1]) + '/' + (+d[2]);
      tip.appendChild(b); tip.appendChild(s); tip.style.display = 'block';
      var r = svg.getBoundingClientRect(), er = el.getBoundingClientRect();
      var left = (r.left - er.left) + x * r.width / W; var top = (r.top - er.top) + py(data[cur][1]) * r.height / H;
      var tw = tip.offsetWidth; left = Math.max(4, Math.min(er.width - tw - 4, left - tw / 2));
      tip.style.left = left + 'px'; tip.style.top = Math.max(0, top - 40) + 'px';
    }
    function hide(){ xh.style.opacity = 0; tip.style.display = 'none'; }
    svg.addEventListener('pointermove', function(e){
      var r = svg.getBoundingClientRect(); var x = (e.clientX - r.left) * W / r.width; var best = 0, bd = 1e9;
      for (var i = 0; i < n; i++) { var dd = Math.abs(px(i) - x); if (dd < bd) { bd = dd; best = i; } }
      show(best);
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', function(){ show(n - 1); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function(e){ if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault(); } if (e.key === 'ArrowRight') { show(cur + 1); e.preventDefault(); } });
  });
})();
</script>`;

  /* ---------------- トップページ（今日の還元率） ---------------- */

  function pointFaqAnswer() {
    const tops = topRoutes.filter((x) => Math.abs(x.rate - (topRoutes[0]?.rate || 0)) < 1e-9);
    if (!tops.length) return 'ポイント還元ランキングのページで、購入場所ごとのポイントを比べています。';
    return `${fmtYmd(checkedOn).replace(/（.）/, '')}に確認した時点では、${tops.map((x) => `${shops[x.rt.shop].name}（${x.how || '通常の支払い'}）`).join('、')}が購入額の${fmtPt(tops[0].rate)}でいちばん高くなっています。購入場所ごとの比較はポイント還元ランキングのページにまとめています。`;
  }

  function faqItems() {
    const best = listed[0];
    return [
      ['いま一番還元率が高い宝くじはどれですか？', best ? `${nowText}の時点では、${best.def.name}（${pct(best.rate)}）がいちばん高くなっています。キャリーオーバーの額やその回の売上で毎日変わるので、このページで確認してください。` : 'データを取得できていません。'],
      ['還元率とは何ですか？', '買った金額に対して、平均して戻ってくる当せん金の割合です。還元率50%なら、たくさん買った場合に平均して買った金額の半分が戻る計算です。'],
      ['キャリーオーバーとは何ですか？', '1等の当せん者がいなかった回などに、払い出されなかった当せん金が次の回の1等に上乗せされることです。ロト6・ロト7・BIG系・DUNK10などで発生します。'],
      ['キャリーオーバーが多いほど還元率は上がりますか？', '上がります。ただし1口の当せん金には上限（ロト6は6億円、BIGは6億円など）があるため、ある額を超えるとほとんど上がらなくなります。くじ別のページの「キャリーオーバーの額ごとの還元率」で確認できます。'],
      ['ポイントが付く買い方はありますか？', pointFaqAnswer()],
      ['宝くじはネットで買えますか？', '宝くじ公式サイトのほか、みずほ銀行・楽天銀行・PayPay銀行・三菱UFJ銀行・三井住友銀行で買えます。BIGやDUNKは、スポーツくじオフィシャルサイトや楽天toto・ドコモスポーツくじなどで買えます。'],
      ['当せん金に税金はかかりますか？', '宝くじとスポーツくじの当せん金そのものには、所得税・住民税がかかりません。受け取ったお金を人に渡すと、贈与税がかかることがあります。'],
    ];
  }

  /** トップページの「ジャンボ宝くじ（発売中・発売予定）」：発売中と、45日以内に発売されるジャンボ */
  function jumboBox(rel) {
    const js = rows.filter((r) => isJumbo(r.def) && r.ev?.computable && (r.status.kind === 'onsale' || (r.status.kind === 'upcoming' && r.def.salesStart <= addDays(now.iso, 45))))
      .sort((a, b) => String(a.def.salesStart).localeCompare(String(b.def.salesStart)) || ctx.order[a.id] - ctx.order[b.id]);
    if (!js.length) return '';
    return `<div class="jumbo-box">${js.map((r) => {
      const d = r.def;
      const first = d.tiers[0];
      const z = d.tiers.find((t) => /前後賞/.test(t.name));
      const early = r.status.kind === 'upcoming' ? earlyNetOf(d) : null;
      const state = r.status.kind === 'onsale' ? `${fmtMd(d.salesEnd)}まで発売中` : early ? `${fmtMd(d.salesStart)}発売・${esc(early.name)}で申し込み受付中` : `${fmtMd(d.salesStart)}から発売`;
      return `<a class="jb-card${r.status.kind === 'onsale' ? ' on' : ''}" href="${rel}kuji/${r.id}.html"><span class="jb-state">${state}</span><b class="jb-name">${esc(yearName(d))}</b><span class="jb-prize">${z ? `1等・前後賞合わせて<b>${yen(first.prize + z.prize * 2)}</b>` : `1等<b>${yen(first.prize)}</b>`}</span><span class="jb-meta">還元率 <b>${pct(r.rate)}</b>・1等 ${oddsJa(d.totalTickets / first.count)}</span><span class="jb-more">何枚買うと当たる？ ›</span></a>`;
    }).join('')}</div>`;
  }

  function index() {
    const rel = '';
    const best = listed[0];
    const jbox = jumboBox(rel);
    const runners = listed.slice(1, 3);
    const title = `宝くじ還元率ランキング｜今日の狙い目が一目で分かる（${fmtMdPlain(now.iso)}更新）`;
    const desc = best
      ? `${fmtMd(now.iso)}時点のロト6・ロト7・BIG・MEGA BIG・DUNKなどの還元率をキャリーオーバー込みで計算したランキングです。1位は${best.def.name}（${pct(best.rate)}）。等級ごとの当せん金と確率、ポイントが付く購入場所も載せています。`
      : '宝くじとスポーツくじの還元率を、キャリーオーバー込みで毎日計算しています。';
    const bbr = best ? bestRoute(best.id) : null;
    const conclusion = best ? `<section class="conclusion" id="today" data-sticky-anchor data-place="conclusion" data-kuji="${best.id}">
<p class="c-label">結論</p>
<p class="c-kicker">今日いちばん還元率が高いくじ</p>
<div class="c-main">
<p class="c-name">${rankMark(1)}<a href="${rel}kuji/${best.id}.html">${esc(best.def.name)}</a></p>
<p class="c-rate"><span class="lbl">還元率</span><span class="num">${cuPct(best.rate)}<small>%</small></span>${delta(best)}</p>
</div>
${bar(best.rate)}
<ul class="chips">
${best.special?.on ? `<li class="chip chip-pt">${esc(best.special.name)}<b>1等最高${esc(best.special.capText)}</b></li>` : ''}
${best.hasCO && best.carryover > 0 ? `<li class="chip chip-co">キャリーオーバー<b>${cuYen(best.carryover)}</b></li>` : ''}
${cdHtml(best) ? `<li class="chip chip-cd">${cdHtml(best)}</li>` : `<li class="chip">${esc(best.status.short || best.status.text)}</li>`}
${bbr ? `<li class="chip chip-pt"><a href="${rel}point.html">ポイント込み<b>${pct(effRate(best))}</b></a></li>` : ''}
</ul>
${bigButtons(best.id, { max: 2, rel })}
${MICRO}
<ul class="c-list">${runners.map((r) => `<li><a href="${rel}kuji/${r.id}.html">${rankOf[r.id]}位　${esc(r.def.name)}</a>　<b>${pct(r.rate)}</b></li>`).join('')}${coList[0] ? `<li>キャリーオーバー最大　<a href="${rel}kuji/${coList[0].id}.html">${esc(coList[0].def.name)}</a>　<b>${yen(coList[0].carryover)}</b></li>` : ''}</ul>
</section>` : '';
    const recent = log.slice(0, 15);
    const otoku = topRoutes.slice(0, 3);
    const bank = routesRanked.find((x) => x.rt.id === 'rakutenbank_toto');
    const cards = [...otoku, ...(bank && !otoku.includes(bank) ? [bank] : [])];
    const faqs = faqItems();

    const body = `
<h1 class="page-title">今日の宝くじ還元率ランキング</h1>
${updatedLine()}
<p class="lead">ネットで買える宝くじとスポーツくじの還元率を、キャリーオーバーと売上から毎日計算しています。今日いちばん得なくじと、各くじの当せん金・当せん確率、ポイントが付く買い方が分かります。</p>
${conclusion}
${share('index.html', best ? `今日の宝くじ還元率1位は${best.def.name}（${pct(best.rate)}）` : site.siteName)}
${toc([['top3', '還元率ランキングTOP3'], ...(jbox ? [['jumbo', 'ジャンボ宝くじ（発売中・発売予定）']] : []), ['ranking', '全くじの還元率ランキング'], ['otoku', 'ポイントでもっとお得に買う'], ['tiers', '等級ごとの当せん金と確率'], ['results', '最近の結果とキャリーオーバーの動き'], ['faq', 'よくある質問']])}
${ad('top')}
<h2 id="top3">還元率ランキングTOP3</h2>
${top3Cards(rel)}${jbox ? `\n<h2 id="jumbo">ジャンボ宝くじ（発売中・発売予定）</h2>\n${jbox}` : ''}
<h2 id="ranking">全くじの還元率ランキング</h2>
${rankTable(rel)}
${ad('middle')}
<h2 id="otoku">ポイントでもっとお得に買う</h2>
<p>同じくじでも、どこで・何で払うかで付くポイントが変わります。登録や口座開設だけで始められる、ポイントが付く買い方です（${fmtYmd(checkedOn).replace(/（.）/, '')}に各社の公式ページで確認）。</p>
<div class="rt-grid two">${cards.map((x) => routeCard(x, { rel, compact: true })).join('\n')}</div>
<p class="more-link"><a href="${rel}point.html">ポイント還元ランキングをくわしく見る ›</a></p>
<h2 id="tiers">等級ごとの当せん金と確率</h2>
${bigTierTable(rel)}
${ad('middle2')}
<h2 id="results">最近の結果とキャリーオーバーの動き</h2>
${resultsTable(rel, recent)}
<h2 id="faq">よくある質問</h2>
${faqHtml(faqs)}
${ad('bottom')}
<h3>くじ別の還元率を見る</h3>
${related(rel, null)}
${guideList.length ? `<h3>${HUB_NAME}</h3>\n${guideLinks(rel)}` : ''}
`;
    return {
      path: 'index.html',
      html: layout({
        path: 'index.html', title, description: desc, body, current: '',
        jsonld: [
          { '@context': 'https://schema.org', '@type': 'WebSite', name: site.siteName, url: `${base}/`, inLanguage: 'ja' },
          faqLd(faqs),
        ],
        stickyHtml: best ? sticky(best) : '',
      }),
    };
  }

  /* ---------------- くじ別ページ ---------------- */

  function recentTable(r) {
    const st = ctx.state.games?.[r.id] || {};
    if (st.draws?.length) {
      const trs = st.draws.slice(0, 10).map((d) => {
        const t1 = d.tiers?.find((t) => t.tier === 1);
        return `<tr><td class="nw">第${d.round}回</td><td class="nw">${fmtShort(d.date)}</td><td class="r">${d.sales ? yen(d.sales) : '—'}</td><td class="r">${t1 ? (t1.winners ? `${num(t1.winners)}口<span class="sub">1口${yen(t1.prize)}</span>` : '該当なし') : '—'}</td><td class="r ${d.carryover > 0 ? 'co' : ''}">${d.carryover != null ? yen(d.carryover) : '—'}</td></tr>`;
      }).join('\n');
      return `<div class="tbl-wrap"><table class="t"><thead><tr><th>回</th><th>抽せん日</th><th>販売実績額</th><th>1等</th><th>キャリーオーバー</th></tr></thead><tbody>${trs}</tbody></table></div>`;
    }
    if (st.results?.length) {
      const trs = st.results.slice(0, 10).map((d) => {
        const t1 = d.tiers?.find((t) => t.tier === 1);
        return `<tr><td class="nw">第${d.round}回</td><td class="nw">${d.resultDate ? fmtShort(d.resultDate) : '—'}</td><td class="r">${d.sales ? yen(d.sales) : '—'}</td><td class="r">${t1 ? (t1.winners ? `${num(t1.winners)}口<span class="sub">1口${yen(t1.prize)}</span>` : '該当なし') : '—'}</td><td class="r ${d.carryoverOut > 0 ? 'co' : ''}">${yen(d.carryoverOut || 0)}</td></tr>`;
      }).join('\n');
      return `<div class="tbl-wrap"><table class="t"><thead><tr><th>回</th><th>結果発表</th><th>売上金額</th><th>1等</th><th>次回へのキャリーオーバー</th></tr></thead><tbody>${trs}</tbody></table></div>`;
    }
    return '';
  }

  function coTableHtml(r) {
    const t = carryoverTable(r.calcDef || r.def, r.salesEst, r.carryover);
    if (!t) return '';
    const capNote = r.special?.on
      ? `※第${r.special.round}回は${esc(r.special.name)}の回なので、1等の上限はキャリーオーバーの有無にかかわらず${esc(r.special.capText)}です（通常は${yen(r.def.tiers.find((x) => x.top).capNormal)}、キャリーオーバー発生時${yen(r.def.tiers.find((x) => x.top).capCO)}）。上限を超えた分は次の回に繰り越されます。`
      : `※1等の上限は、通常${yen(t.capNormal)}、キャリーオーバー発生時${yen(t.capCO)}です。上限を超えた分は次の回に繰り越されます。${r.def.special ? `毎月7日を含む週の回（${esc(r.def.special.name)}）は${esc(r.def.special.capText)}に上がります。` : ''}`;
    const trs = t.rows.map((x) => `<tr class="${x.atCap ? 'cap' : x.current ? 'now' : ''}"><td class="r">${x.carryover ? yen(x.carryover) : '0円'}${x.current ? '<span class="sub">いまの額</span>' : ''}${x.atCap ? '<span class="sub">1等が上限に届く額</span>' : ''}</td><td class="r">${yen(x.lonePrize)}${x.atCap ? '<span class="sub">上限</span>' : ''}</td><td class="r"><b>${pct(x.rate)}</b></td></tr>`).join('\n');
    const nowNote = t.currentAbove
      ? `いまのキャリーオーバー（${yen(r.carryover)}）は、1等が上限に届く額をすでに超えています。いまの還元率は${pct(r.rate)}です。`
      : '';
    return `<h2 id="co">キャリーオーバーの額ごとの還元率</h2>
<p>販売額を今回の見込み（${yen(r.salesEst)}）に固定して、キャリーオーバーの額だけを変えた場合です。キャリーオーバーが${yen(t.threshold)}に届くと、1等を1人で当てたときの当せん金が上限の${yen(t.capCO)}になるため、表はそこまでにしています。</p>
<div class="tbl-wrap"><table class="t compact"><thead><tr><th>キャリーオーバー</th><th>1等の金額（1人で当たった場合）</th><th>還元率</th></tr></thead><tbody>
${trs}
</tbody></table></div>
<div class="note"><p>${capNote}</p>${nowNote ? `<p>※${nowNote}</p>` : ''}</div>`;
  }

  /** BIG777 のような特別開催回のお知らせ（くじ別ページの上） */
  function specialNotice(r) {
    if (!r.special?.on) return '';
    const sp = r.def.special;
    const normalCO = r.def.tiers.find((t) => t.top).capCO;
    return `<p class="notice">第${r.special.round}回は「${esc(sp.name)}」の回です。1等の上限が、キャリーオーバーの有無にかかわらず${esc(sp.capText)}に上がります（通常は最高${yen(normalCO)}）。このページの還元率も、この上限で計算しています。</p>`;
  }

  /**
   * くじ別ページの頭の「答えの1文」：今日の還元率・1等の当選確率・次の回。
   * 「ロト6 還元率」「BIG 確率」のように探した人への答えを、表やタイルだけでなく文でも書く（検索の抜粋や AI の回答に使われやすくするため）
   */
  function answerLine(r, fp) {
    const d = r.def;
    const s = r.status || {};
    if (!r.ev?.computable || !(fp?.p > 0)) return '';
    const first = d.model === 'numbers' ? 'ストレート' : '1等';
    if (isJumbo(d)) {
      const odds1 = oddsJa(d.totalTickets / d.tiers[0].count);
      const when = s.kind === 'upcoming' ? `発売は${fmtMd(d.salesStart)}から${fmtMd(d.salesEnd)}まで、抽せんは${fmtMd(d.drawDate)}です。`
        : s.kind === 'onsale' ? `発売は${fmtMd(d.salesEnd)}まで、抽せんは${fmtMd(d.drawDate)}です。`
          : d.drawDate && d.drawDate < now.iso ? `抽せんは${fmtMd(d.drawDate)}に終わりました。` : `発売は終わり、抽せんは${fmtMd(d.drawDate)}です。`;
      return `<p class="lead answer">${esc(yearName(d))}の1等（${yen(d.tiers[0].prize)}）の当選確率は${odds1}、還元率は<b>${pct(r.rate)}</b>です。${when}</p>`;
    }
    const co = r.hasCO && r.carryover > 0 ? `（キャリーオーバー${r.carryover % 10000 ? '約' : ''}${man(r.carryover)}を含めた${r.provisional ? '暫定の' : ''}計算）` : '';
    const o = s.o;
    const lb = s.label ? `の${esc(s.label)}` : '';
    const next = s.kind === 'closed' ? '今日の回の販売は終わり、抽せんの結果を待っています。'
      : s.next && s.kind === 'onsale' ? (s.next === now.iso ? `今日${fmtMd(s.next)}が抽せん日${lb ? `（${esc(s.label)}）` : ''}です。` : `次の抽せんは${fmtMd(s.next)}${lb}です。`)
        : o && s.kind === 'onsale' ? `${esc(s.label)}のネットの販売締切は${fmtMd(o.salesEnd)}${o.salesEndTime ? ` ${o.salesEndTime}` : ''}${o.resultDate ? `、結果発表は${fmtMd(o.resultDate)}` : ''}です。`
          : o && s.kind === 'before' ? `${esc(s.label)}は${fmtMd(o.salesStart)}${o.salesStartTime ? ` ${o.salesStartTime}` : ''}から販売します。` : '';
    return `<p class="lead answer">${esc(d.name)}の還元率は、${fmtMdPlain(now.iso)}時点で<b>${pct(r.rate)}</b>${co}です。${first}の当選確率は${oddsKanji(fp.p)}です。${next}</p>`;
  }

  function game(r) {
    const d = r.def;
    const path = `kuji/${r.id}.html`;
    const rel = '../';
    const ev = r.ev;
    const ls = shopLinks(r.id);
    const lines = tierLines(r);
    const st = ctx.state.games?.[r.id] || {};
    const fp = ev.computable ? firstPrize(r) : null;
    const fetched = st.fetchedAt ? `${fmtShort(st.fetchedAt.slice(0, 10))} ${st.fetchedAt.slice(11, 16)}` : '';
    const series = seriesOf(r);
    const recent = recentTable(r);
    const coHtml = coTableHtml(r);
    const br = ev.computable ? bestRoute(r.id) : null;
    const showTrend = r.status.kind !== 'upcoming' && ev.computable;
    // ジャンボ：何枚買うと当たる？（買う枚数ごとの確率）と、同じ日に発売・抽せんのジャンボ（ミニなど）との比較
    const jb = isJumbo(d) && ev.computable ? buyChances(d, r.rate) : null;
    const sib = isJumbo(d) ? jumboSibling(d, ctx.defs) : null;
    const sibRow = sib ? byId[sib.id] : null;
    const need = jb ? firstPrizeNeed(d) : null;
    const countHtml = jb ? `<h2 id="count">何枚買うと当たる？（買う枚数ごとの確率）</h2>
<p>${esc(d.name)}を何枚買うと、どのくらいの確率で当たるかの目安です。${jb.lowest ? `連番やバラで10枚買うと、下1けたの${esc(jb.lowest.name)}（${yen(jb.lowest.prize)}）が1枚当たります。` : ''}${need ? `1等（${yen(d.tiers[0].prize)}）は${oddsJa(d.totalTickets / d.tiers[0].count)}なので、1等が当たる確率を1%にするだけでも、約${yen(need.n).replace(/円$/, '')}枚（約${yen(need.cost)}）を買う必要があります。` : ''}</p>
<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t buy-chance">
<thead><tr><th>買う枚数</th>${jb.levels.map((l) => `<th>${esc(l.label)}が<br>当たる確率</th>`).join('')}${jb.rows[0].back != null ? '<th>平均で戻る金額</th>' : ''}</tr></thead>
<tbody>
${jb.rows.map((x) => `<tr><th scope="row">${num(x.n)}枚<span class="sub">${yen(x.cost)}</span></th>${x.chances.map((c) => `<td class="r">${chanceText(c)}</td>`).join('')}${x.back != null ? `<td class="r">約${yen(Math.round(x.back / 10) * 10)}</td>` : ''}</tr>`).join('\n')}
</tbody>
</table></div>
<p class="note">※「当たる確率」は、その金額以上の賞が1枚以上当たる確率で、1枚ずつ別々に当たると考えた目安です。${esc(jb.levels[0].label)}の賞は、平均すると${num(Math.round(1 / jb.levels[0].p))}枚に1枚の割合で当たります。平均で戻る金額は還元率（${pct(r.rate)}）から計算した値で、実際に当たる額は運しだいです。</p>` : '';
    const cmpHtml = sib && sibRow?.ev?.computable && ev.computable ? (() => {
      const row = (label, a, b) => `<tr><th scope="row">${label}</th><td class="r">${a}</td><td class="r">${b}</td></tr>`;
      const both = (fn) => [fn(d, r), fn(sib, sibRow)];
      const zengo = (x) => { const z = x.tiers.find((t) => /前後賞/.test(t.name)); return z ? yen(x.tiers[0].prize + z.prize * 2) : '—'; };
      const m1 = (x) => chanceAtLeast(x, 10000);
      return `<h2 id="compare">${esc(sib.name)}との比較</h2>
<p>${esc(d.name)}と同じ日に発売・抽せんされる${esc(sib.name)}と比べました。${esc(compareSentence(d, sib))}</p>
<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t compare">
<thead><tr><th><span class="vh">項目</span></th><th>${esc(d.name)}<span class="sub">このページ</span></th><th><a href="${rel}kuji/${sib.id}.html">${esc(sib.name)}</a></th></tr></thead>
<tbody>
${row('1枚の値段', ...both((x) => yen(x.price)))}
${row('1等の金額', ...both((x) => `${yen(x.tiers[0].prize)}<span class="sub">全${num(x.tiers[0].count)}本</span>`))}
${row('1等・前後賞合わせて', ...both(zengo))}
${row('1等の当せん確率', ...both((x) => oddsJa(x.totalTickets / x.tiers[0].count)))}
${row('1万円以上が当たる確率（1枚）', ...both((x) => chanceText(m1(x))))}
${row('10枚で1万円以上が当たる確率', ...both((x) => chanceText(chanceOfN(m1(x), 10))))}
${row('還元率', ...both((x, xr) => `<b>${pct(xr.rate)}</b>`))}
${row('発売総数', ...both((x) => `${yen(x.totalTickets).replace(/円$/, '')}枚`))}
</tbody>
</table></div>` ;
    })() : '';
    // くじごとの解説とよくある質問（data/guides.json。書いてあるくじだけ出す。書いていないジャンボは賞金表から作る）
    let gd = guides[r.id];
    if (!gd && isJumbo(d)) {
      gd = autoGuide(d, { rate: ev.computable ? r.rate : null, point: bestPointText(r.id), sibling: sib });
    }
    gd ||= {};
    // 公式発表から自動で登録・更新したジャンボは、手で書いた解説でも、公式発表の日を出す
    // （解説の note は「公式発表の前の情報」の注記なので使わない。note を消して checkedOn を公式発表より後にしたら、確認日を出す）
    const gdNote = gd.auto ? gd.note
      : d.autoFrom && (gd.note || !(gd.checkedOn > (d.autoFrom.on || ''))) ? autoSourceNote(d)
        : gd.note || (gd.checkedOn ? `※しくみと数値は、${fmtYmd(gd.checkedOn)}に公式の発表で確認したものです。` : '');
    const about = (gd.about || []).map((a) => (typeof a === 'string' ? { text: a } : a)).filter((a) => typeof a?.text === 'string' && a.text.trim())
      .map((a) => ({ ...a, text: gdFill(a.text, r.id) }));
    const faq = (gd.faq || []).filter((x) => x?.q && x?.a).map((x) => [x.q, gdFill(x.a, r.id)]);
    // 手で書いた解説のジャンボにも、賞金表から計算する質問（何枚買えば当たるか・ミニとどちらが当たりやすいか）を足す
    if (isJumbo(d) && !gd.auto && faq.length) for (const f of dynamicFaq(d, { sibling: sib })) if (!faq.some(([q]) => q === f.q)) faq.push([f.q, f.a]);
    // ジャンボ以外で解説のあるくじは、「当選確率はどれくらい？」を先頭に足す（「ロト6 確率」のように探す人が多いため。数字は等級の表から）
    const oq = !isJumbo(d) && faq.length ? oddsFaq(d, lines) : null;
    if (oq && !faq.some(([q]) => q === oq[0])) faq.unshift(oq);
    const sources = [...(d.sources || []), ...(gd.sources || [])].filter((s, i, a) => s?.url && a.findIndex((x) => x.url === s.url) === i);
    const sections = [];
    if (about.length) sections.push(['about', `${d.name}の特徴と還元率`]);
    sections.push(['buy', `${d.name}の購入場所`], ['tiers', '等級ごとの当せん金と確率']);
    if (jb) sections.push(['count', '何枚買うと当たる？（買う枚数ごとの確率）']);
    if (cmpHtml) sections.push(['compare', `${sib.name}との比較`]);
    if (coHtml) sections.push(['co', 'キャリーオーバーの額ごとの還元率']);
    if (recent) sections.push(['recent', '最近の結果']);
    if (showTrend) sections.push(['trend', '還元率の推移（過去1年）']);
    if (faq.length) sections.push(['faq', `${d.name}のよくある質問`]);
    sections.push(['data', 'くわしいデータ'], ['rules', 'ルールと注意']);

    const tiles = [];
    if (r.hasCO) tiles.push(['キャリーオーバー', `<span class="co">${r.carryover > 0 ? cuYen(r.carryover) : '0円'}</span>${r.provisional ? '<small>暫定（前の回の結果待ち）</small>' : ''}`]);
    else tiles.push(['1口の値段', yen(d.price)]);
    if (fp) tiles.push(['1等の金額', `${yen(fp.amount)}${fp.note ? `<small>${esc(fp.note)}</small>` : ''}`]);
    if (fp) tiles.push(['1等の当せん確率', `${odds(fp.p)}<small>${probPct(fp.p)}</small>`]);
    tiles.push(['次の回', `${esc(r.status.short || r.status.text)}${cdHtml(r) ? `<small>${cdHtml(r)}</small>` : r.status.shortSub ? `<small>${esc(r.status.shortSub)}</small>` : ''}`]);
    if (br) tiles.push(['ポイント込みの還元率', `<span class="ptv">${pct(effRate(r))}</span><small>${esc(shops[br.route.shop].name)}${br.how ? `で買って${esc(br.how)}と` : 'で買うと'}＋${fmtPt(br.rate)}</small>`]);

    const kv = [];
    if (r.salesEst && d.model === 'parimutuel') kv.push(['想定する販売額', `${yen(r.salesEst)}<span class="sub">${esc(r.salesNote)}</span>`]);
    if (r.hasCO) kv.push(['キャリーオーバーの根拠', esc(r.carryNote)]);
    if (r.capText || r.capNormal) kv.push(['1等の上限', esc(capTextOf(r))]);
    if (d.model === 'parimutuel' && Number.isFinite(ev.naiveRate)) kv.push(['参考', `1等を1人で当てた場合の還元率 ${pct(ev.naiveRate)}`]);
    if (Number.isFinite(r.maxRate)) kv.push(['還元率の最大値', `${pct(r.maxRate)}<span class="sub">当せん者が複数出ても1人ずつ上限まで受け取れるため、キャリーオーバーがどれだけ増えてもこの値は超えません（販売額が今回の見込みどおりの場合）</span>`]);
    kv.push(['しくみ', esc(d.how || '')]);
    if (d.payoutNote) kv.push(['配分', esc(d.payoutNote)]);
    if (d.age) kv.push(['購入できる年齢', `${d.age}歳以上`]);

    const shopList = ls.length ? `<ul class="shops">${ls.map((l) => {
      const ptx = l.pt ? ptText(l.pt) : '';
      const extra = extraSignups(l.key).map((k) => signupBtn(k, 'btn-ghost')).join('');
      return `<li><div class="s-main"><span class="s-name">${esc(l.name)}${ptx ? `<span class="ptb${l.pt.rate > 0 ? '' : ' gray'}">${l.pt.rate > 0 ? 'ポイント' : ''}${esc(ptx)}</span>` : ''}</span><span class="sub">${esc(l.note)}</span></div><div class="s-btns">${aBtn(l, 'btn-sub', '公式サイトへ')}${extra}</div></li>`;
    }).join('')}</ul>
<p class="note">※ポイントが多い順に並べています。ポイントの内訳は<a href="${rel}point.html">ポイント還元ランキング</a>にまとめています。</p>` : '<p>ネットでの販売はありません。</p>';

    const body = `
${crumbs(rel, [{ name: d.name }])}
<h1 class="page-title">${esc(isJumbo(d) ? `${yearName(d)}の当たる確率と還元率` : `${d.name}の還元率`)}</h1>
${updatedLine()}
${d.verify ? `<p class="notice">${esc(d.verify)}</p>` : ''}
${endedNotice(r, rel)}${specialNotice(r)}
${answerLine(r, fp)}
${ev.computable ? `<div class="score">
<div class="score-top"><span class="lbl">還元率</span><span class="num">${cuPct(r.rate)}<small>%</small></span>${delta(r)}<span class="sub">1口${yen(d.price)}で、平均約${Math.round(ev.ev)}円が戻る計算${rankOf[r.id] ? `・全${listed.length}くじ中${rankOf[r.id]}位` : ''}</span></div>
<dl class="score-grid">${tiles.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
</div>` : ''}
${ctaBox(r.id, r)}
${share(path, `${d.name}の還元率は${ev.computable ? pct(r.rate) : '—'}（${fmtMdPlain(now.iso)}時点）`)}
${toc(sections)}
${ad('top')}
${about.length ? `<h2 id="about">${esc(d.name)}の特徴と還元率</h2>
${guideCards(about)}
${gdNote ? `<p class="note">${esc(gdNote)}</p>` : ''}${typeof gd.more === 'string' ? guideMore(gd.more, rel) : ''}` : ''}
<h2 id="buy">${esc(d.name)}の購入場所</h2>
${prNote(shopList, '購入場所のボタンには広告を含みます')}
${r.status.kind !== 'ended' && cpFor(r.id).length ? `<div class="cp-box"><p class="cp-head">開催中のキャンペーン</p>
${cpList(cpFor(r.id))}
${cpNote()}</div>` : ''}
${ev.computable ? `<h2 id="tiers">等級ごとの当せん金と確率</h2>
<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t detail">
<thead><tr><th>等級</th><th>当せん条件</th><th>当せん確率</th><th>1口の当せん金</th><th>還元率への寄与</th></tr></thead>
<tbody>
${lines.map((l) => `<tr><th scope="row">${esc(l.name)}</th><td>${esc(l.cond || '')}</td><td class="r">${odds(l.p)}<span class="sub">${probPct(l.p)}</span></td><td class="r"><b>${l.prize}</b><span class="sub">${esc(l.sub)}</span></td><td class="r">${pct2(l.contrib)}</td></tr>`).join('\n')}
</tbody>
<tfoot><tr><th scope="row" colspan="4" style="text-align:right">合計（還元率）</th><td class="r">${pct(r.rate)}</td></tr></tfoot>
</table></div>
${d.model === 'numbers' ? '<p class="note">※ナンバーズは申込タイプごとの値です。どのタイプを選んでも還元率はほぼ同じです。</p>' : ''}` : ''}${countHtml ? `\n${countHtml}` : ''}${cmpHtml ? `\n${cmpHtml}` : ''}
${ad('middle')}
${coHtml}
${recent ? `<h2 id="recent">最近の結果</h2>${recent}` : ''}
${showTrend ? `<h2 id="trend">還元率の推移（過去1年）</h2>${chartCard(rel, r, series, { days: 365, big: true })}${series.some((p) => p.calc) ? '<p class="note">※サイトで記録を始める前の期間は、公式の販売実績額と繰越額から計算し直した値です。</p>' : ''}` : ''}
${faq.length ? `<h2 id="faq">${esc(d.name)}のよくある質問</h2>
${faqHtml(faq)}` : ''}
<h2 id="data">くわしいデータ</h2>
<dl class="kv">
${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('\n')}
</dl>
<h2 id="rules">ルールと注意</h2>
<p>${esc(d.rules || '')}</p>
${st.error || st.infoError ? `<p class="note">直近の自動取得でエラーがありました（${esc(st.error || st.infoError)}）。表示しているのは前回までに取得できた値です。</p>` : ''}
<h3>出典</h3>
<ul class="note">
${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('\n')}
${st.source ? `<li>${esc(st.source)}（${fetched}取得）</li>` : ''}
</ul>
${ctaBox(r.id)}
${ad('bottom')}
<h2 id="others">ほかのくじの還元率</h2>
${related(rel, r.id)}
`;
    // ジャンボは「確率」「何枚買えば当たる」、ほかのくじは「確率」「キャリーオーバー」で探されることが多いので、題名に入れる
    const title = isJumbo(d)
      ? `${yearName(d)}の当たる確率と還元率｜何枚買えば当たる？（${fmtMdPlain(now.iso)}更新）｜${site.siteName}`
      : `${d.name}の${r.hasCO ? '還元率・当選確率・キャリーオーバー' : '還元率と当選確率'}（${fmtMdPlain(now.iso)}更新）｜${site.siteName}`;
    const desc = !ev.computable ? `${d.name}のしくみと購入場所。`
      : isJumbo(d)
        ? `${yearName(d)}（${fmtMdPlain(d.salesStart)}〜${fmtMdPlain(d.salesEnd)}発売・${fmtMdPlain(d.drawDate)}抽せん）の1等${yen(d.tiers[0].prize)}の当せん確率は${oddsJa(d.totalTickets / d.tiers[0].count)}、還元率は${pct(r.rate)}。10枚・30枚・100枚買ったときに当たる確率${cmpHtml ? `、${sib.name}との比較` : ''}、ポイントが付く購入場所をまとめています。`
        : `${d.name}の還元率は${pct(r.rate)}（${fmtMd(now.iso)}時点）。${r.hasCO ? (r.carryover > 0 ? `キャリーオーバー${yen(r.carryover)}を含めて計算。` : 'いまはキャリーオーバーなし。') : ''}${fp?.p > 0 ? `${d.model === 'numbers' ? 'ストレート' : '1等'}の当選確率は${oddsJa(1 / fp.p)}。` : ''}等級ごとの当せん金と当せん確率、ポイントが付く購入場所をまとめています。`;
    return {
      path,
      html: layout({ path, title, description: desc, body, jsonld: [breadcrumbLd(path, d.name), ...(faq.length ? [faqLd(faq)] : [])], scripts: showTrend ? CHART_JS : '', stickyHtml: ev.computable && r.listed ? sticky(r) : '', kuji: r.id, image: ogImage(ogKeyOf(r.id), `${d.name}のイラスト`) }),
    };
  }

  /* ---------------- 宝くじ一覧 ---------------- */

  function tierListHtml(d) {
    if (d.model === 'numbers') {
      return `<ul>${d.types.map((t) => `<li><b>${esc(t.name)}</b>：${esc(t.cond)}（${t.hits.map((h) => `${t.hits.length > 1 ? `${h.label} ` : ''}理論値${yen(h.prize)}`).join('・')}）</li>`).join('')}</ul>`;
    }
    if (d.model === 'fixed') {
      return `<ul>${d.tiers.map((t) => `<li><b>${esc(t.name)}</b>：${yen(t.prize)}（${num(t.count)}本）</li>`).join('')}</ul>`;
    }
    if (d.model === 'theoretical') {
      return `<ul>${(d.tiers || []).map((t) => `<li><b>${esc(t.name)}</b>：${esc(t.cond)}（${t.fixed != null ? `${yen(t.fixed)}・固定` : `理論値${yen(t.theo)}`}）</li>`).join('')}</ul>`;
    }
    return `<ul>${(d.tiers || []).map((t) => {
      let v;
      if (t.fixed != null) v = `${yen(t.fixed)}・固定`;
      else if (t.share != null) v = `当せん金の総額の${Math.round(t.share * 100)}%を分配`;
      else v = `理論値${yen(t.theo)}`;
      return `<li><b>${esc(t.name)}</b>：${esc(t.cond)}（${v}）</li>`;
    }).join('')}</ul>`;
  }

  function ichiran() {
    const path = 'ichiran.html';
    const rel = '';
    const allIds = mergeOrder(catalog.order || [], Object.keys(ctx.defs));
    // 抽せんが終わったジャンボは、くわしい説明ではなく、いちばん下の「終わったジャンボ宝くじ」にまとめる
    const ids = allIds.filter((id) => !isPastJumbo(ctx.defs[id], now.iso));
    const pastIds = allIds.filter((id) => isPastJumbo(ctx.defs[id], now.iso))
      .sort((a, b) => String(ctx.defs[b].drawDate).localeCompare(String(ctx.defs[a].drawDate)) || (ctx.order[a] ?? 0) - (ctx.order[b] ?? 0));
    const pastHtml = pastIds.length ? `<h2 id="past">終わったジャンボ宝くじ</h2>
<p>抽せんが終わったジャンボ宝くじです。くじ別のページで、賞金と本数、還元率を見られます。</p>
<ul class="past-list">${pastIds.map((id) => {
    const d = ctx.defs[id];
    const r = byId[id];
    return `<li><a href="${rel}kuji/${id}.html">${esc(d.name)}（${esc(d.round || '')}）</a><span class="sub">${fmtYmd(d.salesStart)}〜${fmtYmd(d.salesEnd)}発売・${fmtYmd(d.drawDate)}抽せん${r?.computable ? `・還元率${pct(r.rate)}` : ''}</span></li>`;
  }).join('')}</ul>` : '';
    const sections = ids.map((id, i) => {
      const d = ctx.defs[id];
      // data/catalog.json に説明がないジャンボ（自動で登録したもの）は、賞金表から説明を作る
      const c = catalog.items?.[id] || (isJumbo(d) ? { lead: autoLead(d), points: [['券の選び方', '連番（番号が続いた10枚）やバラ（番号がばらばらの10枚）などで買います。']] } : {});
      const r = byId[id];
      const rowsHtml = [];
      rowsHtml.push(['種類', esc(d.category || GROUP_LABEL[d.group] || '')]);
      rowsHtml.push(['1口の値段', yen(d.price)]);
      rowsHtml.push(['しくみ', esc(d.how || '')]);
      for (const [k, v] of c.points || []) rowsHtml.push([esc(k), esc(v)]);
      const hasDraw = (c.points || []).some(([k]) => k === '抽せん');
      if (d.model === 'fixed') {
        rowsHtml.push(['発売期間', `${fmtYmd(d.salesStart)}〜${fmtYmd(d.salesEnd)}`]);
        rowsHtml.push(['抽せん日', fmtYmd(d.drawDate)]);
        rowsHtml.push(['発売総数', `${yen(d.totalTickets).replace(/円$/, '')}枚`]);
      } else if (d.drawLabel && !hasDraw) rowsHtml.push(['抽せん', esc(d.drawLabel)]);
      rowsHtml.push(['当せん金', tierListHtml(d)]);
      if (d.payoutNote && d.model !== 'fixed') rowsHtml.push(['当せん金の総額', esc(d.payoutNote)]);
      rowsHtml.push(['キャリーオーバー', d.carryover ? 'あり（1等の当せん者がいない場合などに、次の回の1等へ繰り越し）' : 'なし']);
      if (capRuleText(d)) rowsHtml.push(['1等の最高額', esc(capRuleText(d))]);
      if (d.rules) rowsHtml.push(['ルール', esc(d.rules)]);
      if (d.age) rowsHtml.push(['購入できる年齢', `${d.age}歳以上`]);
      return `<section class="kuji-sec" id="k-${id}">
<h3><a href="${rel}kuji/${id}.html">${esc(d.name)}</a></h3>
${c.lead ? `<p>${esc(c.lead)}</p>` : ''}
<div class="tbl-wrap"><table class="t kuji-tbl"><tbody>${rowsHtml.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>
</section>${i === 5 ? ad('middle') : ''}`;
    }).join('\n');
    const body = `
${crumbs(rel, [{ name: '宝くじ一覧' }])}
<h1 class="page-title">宝くじ一覧</h1>
${updatedLine()}
<p class="lead">当サイトで扱っている宝くじとスポーツくじのしくみを、くじごとにまとめました。名前を押すと、くじ別のページに移動します。</p>
${toc([...ids.map((id) => [`k-${id}`, ctx.defs[id].name]), ...(pastIds.length ? [['past', '終わったジャンボ宝くじ']] : []), ...(guideList.length ? [['guide', HUB_NAME]] : [])])}
${ad('top')}
<h2 id="list">くじごとのしくみ</h2>
${sections}
${pastHtml}${guideList.length ? `<h2 id="guide">${HUB_NAME}</h2>
<p>還元率（期待値）の意味、当たる確率の比べ方、当せん金の税金と受け取り方、ネットでの買い方を、くじをまたいでまとめています。</p>
${guideListCards(rel)}` : ''}
${ad('bottom')}
`;
    return {
      path,
      html: layout({ path, title: `宝くじ一覧｜${site.siteName}`, description: 'ロト6・ロト7・ナンバーズ・ジャンボ宝くじ・BIG・DUNKなど、宝くじとスポーツくじのしくみ、1口の値段、抽せん日、当せん金をくじごとに説明しています。', body, current: 'ichiran', jsonld: [breadcrumbLd(path, '宝くじ一覧')] }),
    };
  }

  /* ---------------- 計算方法 ---------------- */

  /** 計算方法のページ：BIG777 の説明（上限が上がった分、1等の分の還元率がどれだけ上がるか） */
  function bigSpecialText() {
    const d = ctx.defs.big;
    const sp = d?.special;
    const top = d?.tiers?.find((t) => t.top);
    if (!sp || !top?.capCO) return '';
    const share = (cap) => pct(cap / d.combos / d.price);
    return `<p>BIGには、毎月7日を含む週の回だけ1等の上限が${esc(sp.capText)}に上がる「${esc(sp.name)}」があります。その回は1等の分の還元率が最大で約${share(sp.cap)}（通常は約${share(top.capCO)}）になるので、上限を上げて計算しています。公式の発表は「毎月7日を含む週」までで、どの回が対象かは細かく書かれていないため、このサイトでは「${esc(sp.rule)}」を${esc(sp.name)}の回としています。この決め方は、これまでの1等の当せん金（${esc(sp.capText)}と${yen(top.capCO)}ちょうど）と合っています。</p>`;
  }

  function keisan() {
    const path = 'keisan.html';
    const rel = '';
    const l6 = byId.loto6;
    const ex = l6?.computable ? (() => {
      const top = l6.ev.rows.find((x) => x.top);
      return `<p>例として、${fmtMd(now.iso)}時点のロト6で計算します。販売額の見込みは${yen(l6.salesEst)}（1口200円なので約${num(l6.salesEst / 200 / 1e4)}万口）、キャリーオーバーは${yen(l6.carryover)}です。1等の原資は「販売額×1等の配分（約16.4%）＋キャリーオーバー」で約${yen(top.pool)}。1等の確率は1/6,096,454なので、自分以外の1等当せん口数の平均は約${top.lambda.toFixed(2)}口です。山分けを織り込むと、1等に当たったときの平均受取額は約${yen(top.expected)}になります。これに確率を掛けると、1等の分の還元率は${pct2(top.contrib / 200)}。2等以下を足した還元率は${pct(l6.rate)}です。</p>`;
    })() : '';
    const body = `
${crumbs(rel, [{ name: '還元率の計算方法' }])}
<h1 class="page-title">還元率の計算方法</h1>
${updatedLine()}
<p class="lead">このサイトの還元率は、1口買ったときに戻ってくる金額の平均（平均払戻額）を、1口の値段で割ったものです。100%を超えれば、平均では買った金額より多く戻る状態です。</p>
${toc([['fixed', '賞金が決まっているくじ'], ['pari', '売上を当せん者で分けるくじ'], ['cap', 'キャリーオーバーと1等の上限'], ['sales', '販売額の見込み'], ['point', 'ポイント込みの還元率'], ['data', 'データの取得元と更新'], ['caution', '注意']])}
${ad('top')}
<h2 id="fixed">賞金が決まっているくじ</h2>
<p>ジャンボ宝くじは、等級ごとの賞金と本数が発売前に決まっています。「賞金×本数」を全等級で足し、発売総額で割ると還元率になります。ナンバーズ・ミニロト・ビンゴ5は、発売元が公表している理論上の当せん金（理論値）と確率で計算しています。実際の当せん金は回ごとの売上と当せん口数で上下しますが、平均すると理論値に近づきます。</p>
<h2 id="pari">売上を当せん者で分けるくじ</h2>
<p>ロト6・ロト7・BIG系・DUNKは、売上の一定割合を等級ごとの原資にして、その等級の当せん者で分けます（パリミュチュエル方式）。当たったときの受取額は、次の3つで決まります。</p>
<ol>
<li><b>原資</b>：販売額×その等級の配分割合。1等の原資にはキャリーオーバーが加わります。</li>
<li><b>山分け</b>：同じ等級に自分以外の当せん者が何口出るか。販売口数×当せん確率を平均とするポアソン分布で見積もります。</li>
<li><b>上限</b>：1口あたりの当せん金には上限があります（ロト6は2億円、キャリーオーバー発生時は6億円、BIGは3億円、同6億円など）。上限を超えた分は次の回に繰り越されます。</li>
</ol>
<p>これらから「当たったときの平均受取額」を求め、当せん確率を掛けて全等級で足し、1口の値段で割ったものが還元率です。</p>
${ex}
<p>1等を1人で当てた場合の還元率も、くじ別のページに参考として載せています。キャリーオーバーが小さいときほど、山分けの影響で実際の還元率はこの値より低くなります。</p>
<h2 id="cap">キャリーオーバーと1等の上限</h2>
<p>キャリーオーバーが増えても、1口あたりの上限があるので、1等から受け取れる額は上限で止まります。たとえばBIGは1等の確率が1/4,782,969、上限が6億円なので、1等の分の還元率は最大でも約41.8%です。BIG・MEGA BIG・100円BIGは、繰越額が上限の何倍にもなっていることが多く、その間は還元率がほぼ一定です。</p>
${bigSpecialText()}
${ad('middle')}
<h2 id="sales">販売額の見込み</h2>
<p>まだ締め切っていない回の販売額は分からないので、ロト6は同じ曜日の直近4回、ロト7は直近4回の販売実績額の中央値を使います。BIG系・DUNKは直近3回の売上金額の中央値です。キャリーオーバーが大きい回は売上が増えやすく、そのぶん山分けが増えるため、実際の還元率は表示より少し下がることがあります。</p>
<h2 id="point">ポイント込みの還元率</h2>
<p>「ポイント込み」は、還元率に、そのくじをいちばんポイントが付く買い方で買ったときのポイント還元率を足したものです。ポイントは1ポイント＝1円として計算しています。ポイントの率は各社の公式ページに書かれている値で、カード会社の規定によって変わる分は入れていません。ポイントには使い道や有効期限の条件があるため、現金と同じ価値とは限りません。</p>
<h2 id="data">データの取得元と更新</h2>
<ul>
<li>ロト6・ロト7：みずほ銀行が公開している当せん番号データ（販売実績額・キャリーオーバー）</li>
<li>BIG系・DUNK：スポーツくじオフィシャルサイトの「くじ情報」「くじ結果」（販売期間・売上金額・次回への繰越金）</li>
<li>賞金体系・当せん確率・1等の上限：発売元・取扱銀行の公式ページ（くじ別ページの出典欄）</li>
<li>ポイント：各購入場所の公式ページ（<a href="${rel}point.html">ポイント還元ランキング</a>の出典欄）</li>
</ul>
<p>1日に数回、自動で取得して計算し直しています。取得できなかったときは前回の値のまま表示し、くじ別ページに注意書きを出します。</p>
<h2 id="caution">注意</h2>
<p>還元率は「たくさん買ったときの平均」で、1回ごとの結果を約束するものではありません。また、当せん金の受け取りにかかる手間や税金（宝くじ・スポーツくじの当せん金は非課税）は計算に入れていません。購入は、自分で決めた範囲の金額にとどめてください。</p>
${guideMore('kangenritsu', rel)}${guideMore('zeikin', rel)}
${ad('bottom')}
`;
    return {
      path,
      html: layout({ path, title: `還元率の計算方法｜${site.siteName}`, description: 'キャリーオーバー、1口あたりの上限、当せん者どうしの山分けを考慮した、宝くじ・スポーツくじの還元率の計算方法を説明します。', body, current: 'keisan', jsonld: [breadcrumbLd(path, '還元率の計算方法')] }),
    };
  }

  /* ---------------- 購入場所 ---------------- */

  function shopPointCell(sid) {
    const x = shopPoint(sid);
    if (x && x.rate > 0) return `<b class="ptv">${fmtPt(x.rate)}${x.plus ? '＋α' : ''}</b>${x.how ? `<span class="sub">${esc(x.how)}場合</span>` : ''}`;
    if (x && x.plus) return '<span class="sub">カードのポイント</span>';
    return '<span class="sub">—</span>';
  }

  /** 購入場所の比較表（購入場所のページと、解説ページの {{table:shops}}）。宝くじが先、スポーツくじが後で、それぞれポイントの多い順 */
  const shopIdsAll = () => Object.keys(shops).filter((sid) => shopGames[sid]?.length);
  const isSportsShop = (sid) => shopGames[sid].every((g) => ctx.defs[g].group === 'sports');
  const sortByPoint = (list) => [...list].sort((a, b) => (shopPoint(b)?.rate || 0) - (shopPoint(a)?.rate || 0));
  function shopCompareTable() {
    const linkCell = (sid) => {
      const s = shops[sid];
      return `${aBtn({ url: s.url, affiliate: !!s.affiliate }, 'btn-mini first', '公式サイトへ')}${extraSignups(sid).map((k) => signupBtn(k, 'btn-mini', signups[k].kind === 'bank' ? '口座を開く' : `${signups[k].name}を見る`)).join('')}`;
    };
    const row = (sid) => `<tr><th scope="row">${esc(shops[sid].name)}</th><td>${esc(gamesLabel(shopGames[sid]))}</td><td class="c">${shopPointCell(sid)}</td><td>${esc(shops[sid].note || '')}</td><td class="c lk">${linkCell(sid)}</td></tr>`;
    const ids = shopIdsAll();
    const trs = [...sortByPoint(ids.filter((s) => !isSportsShop(s))), ...sortByPoint(ids.filter(isSportsShop))].map(row).join('\n');
    return `${hasAd(trs) ? prLine('表のボタンには広告を含みます') : ''}<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t shoptbl">
<thead><tr><th>購入場所</th><th>買えるくじ</th><th>ポイント</th><th>特徴</th><th>リンク</th></tr></thead>
<tbody>
${trs}
</tbody></table></div>`;
  }

  function kaikata() {
    const path = 'kaikata.html';
    const rel = '';
    const shopIds = shopIdsAll();
    const isSports = isSportsShop;
    const sorted = sortByPoint;
    const cards = (list) => `<ul class="shops">${sorted(list).map((sid) => {
      const s = shops[sid];
      const x = shopPoint(sid);
      const ptx = x ? ptText(x) : '';
      const extra = extraSignups(sid).map((k) => signupBtn(k, 'btn-ghost')).join('');
      return `<li><div class="s-main"><span class="s-name">${esc(s.name)}${ptx ? `<span class="ptb${x.rate > 0 ? '' : ' gray'}">${x.rate > 0 ? 'ポイント' : ''}${esc(ptx)}</span>` : ''}</span><span class="sub">${esc(s.note || '')}</span><span class="sub">買えるくじ：${esc(gamesLabel(shopGames[sid]))}</span></div><div class="s-btns">${aBtn({ url: s.url, affiliate: !!s.affiliate }, 'btn-sub', '公式サイトへ')}${extra}</div></li>`;
    }).join('')}</ul>`;
    const picks = PICKS.map((p) => {
      const x = routesRanked.find((y) => y.rt.id === p.route);
      if (!x) return '';
      const s = shops[x.rt.shop];
      const keys = (x.rt.signups || []).filter((k) => signups[k] && signups[k].kind !== 'site');
      const y = p.pay ? routeMax(x.rt, p.pay) : x; // 支払い方法を決めたおすすめ（dポイントを貯めている人は dカード など）
      const rateLine = y.rate > 0 ? (y.how ? `${y.how}と、ポイントは合計${fmtPt(y.rate)}。` : `ポイントは購入額の${fmtPt(y.rate)}。`) : '';
      return `<article class="pick"><p class="pick-q">${esc(p.title)}</p><p class="pick-a">${esc(s.name)}${x.rate > 0 ? `<span class="ptb">ポイント最大${fmtPt(x.rate)}</span>` : ''}</p><p>${esc(x.rt.feature || '')}。${esc(rateLine)}</p>${prNote(`<div class="btns">${aBtn({ url: s.url, affiliate: !!s.affiliate }, 'btn-sub', `${s.name}へ`)}${keys.map((k) => signupBtn(k, 'btn-sub')).join('')}</div>`)}</article>`;
    }).join('');
    const nShops = shopIds.length;
    const body = `
${crumbs(rel, [{ name: '購入場所' }])}
<h1 class="page-title">宝くじ・スポーツくじの購入場所</h1>
${updatedLine(`<span>確認日：${fmtYmd(checkedOn)}</span>`)}
<p class="lead">当サイトで還元率を出しているくじを、ネットで買える公式の販売先${nShops}か所の比較です。宝くじは宝くじ公式サイトと5つの銀行、スポーツくじはスポーツくじオフィシャルサイトと提携サイトで買えます。ポイントが付くかどうかで、同じくじでも実質の還元率が変わります。</p>
${toc([['list', '購入場所の一覧（比較表）'], ['pick', '目的別のおすすめ'], ['kuji', '宝くじ（ロト・ナンバーズ・ジャンボ）の購入場所'], ['sports', 'スポーツくじ（BIG・DUNK）の購入場所'], ['steps', 'ネットで買う3ステップ'], ['offline', 'ネット以外の購入場所'], ['before', 'ネットで買う前に']])}
${ad('top')}
<h2 id="list">購入場所の一覧（比較表）</h2>
${shopCompareTable()}
<p class="note">※ポイントは、くじの購入で付くポイントの最大の率です（${fmtYmd(checkedOn)}に各社の公式ページで確認）。「—」は、公式ページにくじの購入で貯まる独自のポイントの記載がないものです。支払いに使うカードのポイントは別に付く場合があります。</p>
<h2 id="pick">目的別のおすすめ</h2>
<p>ポイントの率と買えるくじの数から選んでいます。広告の有無で順番は変えていません。</p>
<div class="picks">${picks}</div>
<h2 id="kuji">宝くじ（ロト・ナンバーズ・ジャンボ）の購入場所</h2>
${prNote(cards(shopIds.filter((s) => !isSports(s))), '購入場所のボタンには広告を含みます')}
${ad('middle')}
<h2 id="sports">スポーツくじ（BIG・DUNK）の購入場所</h2>
${prNote(cards(shopIds.filter(isSports)), '購入場所のボタンには広告を含みます')}
<p class="note">※スポーツくじの提携サイトは、スポーツくじオフィシャルサイトの「提携サイトで購入」に載っている販売先です。各サイトで買えるくじは、各社の公式ページに書かれているものだけを載せています。</p>
<h2 id="steps">ネットで買う3ステップ</h2>
<ol class="steps">
<li><b>会員登録・口座開設</b><span>購入場所のサイトで会員登録をします。銀行で買う場合は、その銀行の口座が必要です（ネットで申し込めます）。</span></li>
<li><b>支払い方法を登録</b><span>クレジットカード・PayPay・銀行口座などを登録します。ポイントが付く支払い方法を選ぶと、そのぶん得になります。</span></li>
<li><b>くじを選んで買う</b><span>数字を選ぶか、コンピュータに選ばせて申し込みます。当せんしたかどうかは購入履歴で確認でき、当せん金は登録した口座などで受け取ります。</span></li>
</ol>
${guideMore('net', rel)}
<h2 id="offline">ネット以外の購入場所</h2>
<ul class="offline">
<li><b>宝くじ売り場</b>：ジャンボ・ロト・ナンバーズなど。宝くじポイントカードを見せると、売り場でも宝くじポイントが貯まります。<a href="https://www.takarakuji-official.jp/map/" target="_blank" rel="noopener">宝くじ売り場を探す（宝くじ公式サイト）</a></li>
<li><b>銀行のATM</b>：みずほ銀行や地方銀行など28行のATMで、ロト・ナンバーズを買えます。<a href="https://www.takarakuji-official.jp/kuji/atm-service-list.html" target="_blank" rel="noopener">ATM宝くじサービス一覧（宝くじ公式サイト）</a></li>
<li><b>コンビニ（スポーツくじ）</b>：ローソン・ミニストップのLoppi、ファミリーマート・セブン‐イレブンのマルチコピー機でBIGなどを買えます。<a href="https://www.toto-dream.com/big/buy/cvs/index.html" target="_blank" rel="noopener">コンビニエンスストアで購入（スポーツくじオフィシャルサイト）</a></li>
</ul>
<h2 id="before">ネットで買う前に</h2>
<ul>
<li>ロト・ナンバーズ・ビンゴ5のネット購入は、抽せん日の夕方（18時20分ごろ）が締切です。それ以降は次の回の予約になります。銀行によって時刻が違います。</li>
<li>BIG・DUNKは開催回ごとに販売期間が決まっています。くじ別のページに締切を載せています。</li>
<li>宝くじ公式サイトのクレジットカード払いは、本人名義の1回払いだけです。家族カードと法人カードは使えません。</li>
<li>スポーツくじは19歳以上が対象です。</li>
<li>ネットで買った当せん金は、おおむね登録した口座に自動で入金されます。高額当せんは手続きが必要なことがあります。</li>
</ul>
<h3>出典</h3>
<ul class="note">
<li><a href="https://www.takarakuji-official.jp/kuji/mail-order-site.html" target="_blank" rel="noopener">インターネット販売金融機関の販売サイト（宝くじ公式サイト）</a></li>
<li><a href="https://www.toto-dream.com/big/buy/teikei/" target="_blank" rel="noopener">提携サイトで購入（スポーツくじオフィシャルサイト）</a></li>
<li><a href="https://www.takarakuji-official.jp/special/payment_guide/" target="_blank" rel="noopener">お支払い方法の登録ガイド（宝くじ公式サイト）</a></li>
</ul>
${ad('bottom')}
`;
    return {
      path,
      html: layout({ path, title: `宝くじ・スポーツくじの購入場所｜${site.siteName}`, description: 'ロト・ナンバーズ・ジャンボ宝くじ・BIG・DUNKを買える公式サイト・銀行・提携サイトを、付くポイントと買えるくじで比べた一覧です。', body, current: 'kaikata', jsonld: [breadcrumbLd(path, '購入場所')] }),
    };
  }

  /* ---------------- ポイント還元ランキング ---------------- */

  function point() {
    const path = 'point.html';
    const rel = '';
    const top = topRoutes[0];
    const tops = topRoutes.filter((x) => top && Math.abs(x.rate - top.rate) < 1e-9);
    const ranking = routesRanked.map((x) => {
      const s = shops[x.rt.shop];
      const priceMin = Math.min(...(shopGames[x.rt.shop] || []).map((g) => ctx.defs[g].price));
      const parts = (x.rt.parts || []).map((p) => { const v = partRate(p, priceMin); return `<li><b>${v == null ? '＋α' : fmtPt(v)}</b>${esc(p.name)}${p.pay && payCount(x.rt) > 1 ? `<span class="pay">（${esc(p.pay)}場合）</span>` : ''}</li>`; }).join('');
      const btns = [aBtn({ url: s.url, affiliate: !!s.affiliate }, 'btn-mini first', `${s.short || s.name}へ`), ...(x.rt.signups || []).filter((k) => signups[k] && signups[k].kind !== 'site').map((k) => signupBtn(k, 'btn-mini', signups[k].kind === 'bank' ? '口座を開く' : `${signups[k].name}を見る`))].join('');
      return `<tr${routeRank(x) === 1 && x.rate > 0 ? ' class="first"' : ''}><td class="c">${x.rate > 0 ? rankMark(routeRank(x)) : '<span class="sub">—</span>'}</td><td><b class="gname">${esc(s.name)}</b>${x.how ? `<span class="sub">${esc(x.how)}場合</span>` : ''}</td><td class="c"><span class="rate${x.rate >= 0.015 ? ' hi' : ''}">${x.rate > 0 ? fmtPt(x.rate) : '—'}</span>${x.plus ? '<span class="sub">＋カードのポイント</span>' : ''}</td><td><ul class="parts-mini">${parts}</ul>${x.rt.base ? `<span class="sub">${esc(x.rt.base)}</span>` : ''}</td><td>${esc(gamesLabel(shopGames[x.rt.shop] || []))}</td><td class="lk">${btns}</td></tr>`;
    }).join('\n');
    const noPts = [...noPoint].filter((sid) => shops[sid] && shopGames[sid]?.length);
    const eff = [...listed].map((r) => ({ r, br: bestRoute(r.id) })).sort((a, b) => effRate(b.r) - effRate(a.r) || ctx.order[a.r.id] - ctx.order[b.r.id]);
    const effRows = eff.map(({ r, br }, i) => {
      const l = br ? shopLinks(r.id).find((x) => x.key === br.route.shop) : null;
      return `<tr${i === 0 ? ' class="first"' : ''} data-kuji="${r.id}"><td class="c">${rankMark(1 + eff.filter((y) => Math.round(effRate(y.r) * 1000) > Math.round(effRate(r) * 1000)).length)}</td><td><a class="gname" href="${rel}kuji/${r.id}.html">${esc(r.def.name)}</a></td><td class="r">${pct(r.rate)}</td><td class="r">${br ? `＋${fmtPt(br.rate)}` : '—'}</td><td class="r"><span class="rate${effRate(r) >= 0.5 ? ' hi' : ''}">${pct(effRate(r))}</span></td><td>${br ? `${esc(shops[br.route.shop].name)}${br.how ? `<span class="sub">${esc(br.how)}</span>` : ''}` : '—'}</td><td class="lk">${l ? aBtn(l, 'btn-mini first', `${l.short}で買う`) : ''}</td></tr>`;
    }).join('\n');
    const allSources = [];
    for (const x of routesRanked) for (const s of x.rt.sources || []) if (!allSources.some((y) => y.url === s.url)) allSources.push(s);
    for (const s of [
      { title: '利用できるクレジットカード発行会社の上限金額（宝くじ公式サイト よくあるご質問）', url: 'https://www.takarakuji-official.jp/contact/faq/kfaq/kfaq04/detail-0013.html' },
      { title: '宝くじポイントの獲得（宝くじ公式サイト よくあるご質問）', url: 'https://www.takarakuji-official.jp/contact/faq/pfaq/detail-2019073002.html' },
      { title: '提携サイトで購入（スポーツくじオフィシャルサイト）', url: 'https://www.toto-dream.com/big/buy/teikei/' },
    ]) if (!allSources.some((y) => y.url === s.url)) allSources.push(s);
    const faqs = [
      ['ポイントがいちばん付く買い方は？', pointFaqAnswer()],
      ['ポイントサイトを経由すると、くじの購入でもポイントがもらえますか？', `当サイトが${fmtYmd(checkedOn).replace(/（.）/, '')}に調べた範囲では、宝くじやスポーツくじの購入そのものでポイントがもらえるポイントサイトの案件は見つかりませんでした。購入場所のポイントと、支払い方法のポイントの2つを組み合わせるのが基本です。`],
      ['楽天銀行totoポイントと楽天ポイントは同じですか？', '別のポイントです。楽天銀行totoポイントは、楽天銀行でBIG・toto・DUNK・WINNERを買うときにだけ、100ポイント単位で使えます。最後にスポーツくじを買った日から1年で失効します。'],
      ['宝くじポイントは何に使えますか？', '1ポイント＝1円として、宝くじ公式サイト（1ポイント単位）と宝くじ売り場（100ポイント単位）での宝くじの購入に使えます。購入で貯まったポイントの有効期限は、翌々年度の末日（3月31日）です。'],
      ['銀行で買うとポイントは付きますか？', '楽天銀行は、ロト・ナンバーズが1口ごとに楽天ポイント1ポイント、スポーツくじは購入額の1%の楽天銀行totoポイントが付きます。そのほかの銀行は、公式ページにくじの購入で貯まるポイントの記載がありません。'],
      ['宝くじ公式サイトではどんな支払い方法が使えますか？', 'クレジットカード（Visa・Mastercard・JCB）、PayPay（PayPay残高・PayPayクレジット）、d払い（電話料金合算払いのみ）、au PAY（auかんたん決済）、ソフトバンク・ワイモバイルまとめて支払いが使えます。宝くじポイント（1%）に、支払い方法側のポイントが加わる場合があります。'],
      ['リクルートカードで払うと、ポイントは何%になりますか？', '宝くじ公式サイト・楽天toto・ドコモスポーツくじでは、購入場所のポイント（1%）にリクルートポイント（1.2%）が加わり、合わせて2.2%です。スポーツくじオフィシャルサイトはサイト独自のポイントがないので1.2%です。リクルートポイントの対象にならない利用の一覧に宝くじとスポーツくじは載っていませんが、対象だとはっきり書かれているわけでもありません。心配なときは、使う前にカード会社に確かめてください。'],
    ];
    const body = `
${crumbs(rel, [{ name: 'ポイント還元ランキング' }])}
<h1 class="page-title">ポイント還元ランキング</h1>
${updatedLine(`<span>ポイントの確認日：${fmtYmd(checkedOn)}</span>`)}
<p class="lead">宝くじ・スポーツくじをネットで買うときに付くポイントを、購入場所ごとに比べました。くじの還元率にポイントを足した「ポイント込みの還元率」も、毎日計算し直しています。</p>
${top ? `<section class="conclusion">
<p class="c-label">結論</p>
<p class="c-kicker">いちばんポイントが付く買い方</p>
<div class="c-main"><p class="c-name">${rankMark(1)}<span>${tops.map((x) => esc(shops[x.rt.shop].name)).join('・')}</span></p><p class="c-rate"><span class="lbl">最大</span><span class="num">${cuPct(top.rate)}<small>%</small></span></p></div>
<ul class="c-list">${tops.map((x) => `<li>${esc(shops[x.rt.shop].name)}：${esc(x.how || '')}と <b>${fmtPt(x.rate)}</b>（${esc(gamesLabel(shopGames[x.rt.shop] || []))}）</li>`).join('')}</ul>
</section>` : ''}
${share(path, top ? `宝くじ・totoのポイント還元ランキング：1位は${tops.map((x) => shops[x.rt.shop].name).join('・')}（${fmtPt(top.rate)}）` : site.siteName)}
${toc([['ranking', '購入場所のポイント還元ランキング'], ['today', 'くじ別：ポイント込みの還元率（今日）'], ['detail', '買い方ごとのくわしい条件'], ['combine', 'ポイントの組み合わせ方'], ...(cpItems.length ? [['campaign', '開催中のキャンペーン']] : []), ['card', '宝くじ公式サイトで使えるクレジットカード'], ['faq', 'よくある質問']])}
${ad('top')}
<h2 id="ranking">購入場所のポイント還元ランキング</h2>
${hasAd(ranking) ? prLine('表のボタンには広告を含みます') : ''}<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t ptrank">
<thead><tr><th>順位</th><th>購入場所</th><th>ポイント<br>（最大）</th><th>内訳</th><th>買えるくじ</th><th>リンク</th></tr></thead>
<tbody>
${ranking}
</tbody></table></div>
${noPts.length ? `<p class="note">※くじの購入で貯まる独自のポイントが公式ページに書かれていない購入場所：${noPts.map((sid) => esc(shops[sid].name)).join('、')}。支払いに使うカードのポイントは、カード会社の規定によって付く場合があります。</p>` : ''}
${campaigns.length ? `<div class="notice">${campaigns.map((c) => `<p><b>期間限定</b>：${esc(c.title || '')}${c.until ? `（${fmtMd(c.until)}まで）` : ''}${c.url ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener">くわしく</a>` : ''}</p>`).join('')}</div>` : ''}
<h2 id="today">くじ別：ポイント込みの還元率（今日）</h2>
<p>今日の還元率に、そのくじをいちばんポイントが付く買い方で買った分を足しました。ポイントは1ポイント＝1円として計算しています。</p>
${hasAd(effRows) ? prLine('表のボタンには広告を含みます') : ''}<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t efftbl">
<thead><tr><th>順位</th><th>くじ</th><th>還元率</th><th>ポイント</th><th>ポイント込み</th><th>いちばん貯まる買い方</th><th>購入</th></tr></thead>
<tbody>
${effRows}
</tbody></table></div>
${ad('middle')}
<h2 id="detail">買い方ごとのくわしい条件</h2>
<div class="rt-grid wide">${routesRanked.map((x) => routeCard(x, { rel })).join('\n')}</div>
${routesRanked.filter((x) => x.rt.caution).map((x) => `<p class="note">※${esc(shops[x.rt.shop].name)}：${esc(x.rt.caution)}</p>`).join('\n')}
<h2 id="combine">ポイントの組み合わせ方</h2>
<p>くじのポイントは、次の2つを足し合わせられます。</p>
<ol class="steps">
<li><b>購入場所のポイント</b><span>宝くじ公式サイトの宝くじポイント（1%）、楽天totoの楽天ポイント（1%）、ドコモスポーツくじのdポイント（1%）、楽天銀行の楽天銀行totoポイント（1%）など、買う場所で付くポイントです。</span></li>
<li><b>支払い方法のポイント</b><span>楽天totoは楽天カード、ドコモスポーツくじはdカードで払うと、さらに1%付きます。宝くじ公式サイトはPayPayクレジットで払うとPayPayポイントが基本1.0%付きます（前の月にPayPayで200円以上の支払いを30回以上・合計10万円以上すると、その翌月は＋0.5%）。リクルートカード（JCB）は、宝くじ公式サイト・楽天toto・ドコモスポーツくじ・スポーツくじオフィシャルサイトのどれでも払えて、カードのポイントが1.2%付きます。支払い方法のポイントは、払うときに使った1つ分です。</span></li>
</ol>
<p>銀行の口座から買う場合（楽天銀行を除く）と、くじの購入そのものをポイントサイト経由にする方法は、ポイントが付く仕組みが見当たりませんでした。</p>
<p>リクルートカードの1.2%は、カード会社が案内している通常の還元率です。リクルートポイントの対象にならない利用の一覧（例として載っているもの）に、宝くじとスポーツくじはありません（${fmtYmd(checkedOn).replace(/（.）/, '')}に確認）。ただ、くじの購入が対象だとはっきり書かれているわけでもないので、心配なときは使う前にカード会社に確かめてください。対象にならなかった場合も、購入場所のポイント（1%）は付きます。PayPayの＋0.5%の条件を満たした月は、宝くじ公式サイトではPayPayクレジットのほうが多くなります（合計2.5%）。</p>
${cpItems.length ? `<h2 id="campaign">開催中のキャンペーン</h2>
<p>宝くじとスポーツくじを買う人が対象の、期間限定のキャンペーンです（抽せんや特典。終わったものは自動で消えます）。</p>
${cpList(cpItems, { target: true })}
${cpNote()}` : ''}
<h2 id="card">宝くじ公式サイトで使えるクレジットカード</h2>
<p>Visa・Mastercard・JCBのカードが使えます。本人名義の1回払いのみで、家族カードと法人カードは使えません。本人認証サービス（3Dセキュア）の設定が必要です。1か月に買える上限は、カードの発行会社ごとに決まっています。</p>
<div class="tbl-wrap"><table class="t compact"><thead><tr><th>カードの発行会社</th><th>1か月の上限</th></tr></thead><tbody>
<tr><td>ライフカード</td><td class="r">30万円</td></tr>
<tr><td>クレディセゾン</td><td class="r">30万円</td></tr>
<tr><td>オリエントコーポレーション</td><td class="r">30万円</td></tr>
<tr><td>イオンクレジットサービス</td><td class="r">10万円</td></tr>
<tr><td>三菱UFJニコス</td><td class="r">10万円</td></tr>
<tr><td>エポスカード</td><td class="r">10万円</td></tr>
<tr><td>トヨタファイナンス</td><td class="r">10万円</td></tr>
<tr><td>上記以外（Visa・Mastercard・JCB）</td><td class="r">10万円</td></tr>
</tbody></table></div>
<h2 id="faq">よくある質問</h2>
${faqHtml(faqs)}
<h3>出典</h3>
<ul class="note">
${allSources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('\n')}
</ul>
${ad('bottom')}
`;
    return {
      path,
      html: layout({
        path, title: `ポイント還元ランキング（${fmtMdPlain(now.iso)}更新）｜${site.siteName}`,
        description: '宝くじ・スポーツくじをネットで買うときに付くポイントを、購入場所ごとに比べたランキングです。還元率にポイントを足した「ポイント込みの還元率」も毎日計算しています。',
        body, current: 'point', jsonld: [breadcrumbLd(path, 'ポイント還元ランキング'), faqLd(faqs)],
        stickyHtml: listed[0] ? sticky(listed[0]) : '',
      }),
    };
  }

  /* ---------------- 還元率の推移 ---------------- */

  function suii() {
    const path = 'suii.html';
    const rel = '';
    const DAYS = 30;
    const from = addDays(now.iso, -(DAYS - 1));
    const variable = rows.filter((r) => r.computable && r.def.model === 'parimutuel').sort((a, b) => ctx.order[a.id] - ctx.order[b.id]);
    const fixed = rows.filter((r) => r.computable && r.def.model !== 'parimutuel' && r.status.kind !== 'upcoming' && r.status.kind !== 'ended').sort((a, b) => ctx.order[a.id] - ctx.order[b.id]);
    const seriesMap = Object.fromEntries(variable.map((r) => [r.id, seriesOf(r).filter((p) => p.d >= from && p.d <= now.iso)]));
    const anyCalc = Object.values(seriesMap).some((s) => s.some((p) => p.calc));
    const dates = [...new Set(Object.values(seriesMap).flatMap((s) => s.map((p) => p.d)))].sort().reverse();
    const val = (id, d) => seriesMap[id].find((p) => p.d === d)?.v;
    const table = dates.length
      ? `<p class="scroll-hint">表は横にスクロールできます →</p><div class="tbl-wrap"><table class="t"><thead><tr><th>日付</th>${variable.map((r) => `<th><a href="${rel}kuji/${r.id}.html" style="color:inherit">${esc(r.def.name)}</a></th>`).join('')}</tr></thead><tbody>
${dates.map((d) => `<tr><th scope="row" class="nw">${fmtShort(d)}</th>${variable.map((r) => { const v = val(r.id, d); return `<td class="r">${Number.isFinite(v) ? pct(v) : '—'}</td>`; }).join('')}</tr>`).join('\n')}
</tbody></table></div>`
      : '<p>まだ記録がありません。</p>';
    const body = `
${crumbs(rel, [{ name: '還元率の推移' }])}
<h1 class="page-title">還元率の推移</h1>
${updatedLine()}
<p class="lead">キャリーオーバーと売上で還元率が変わるくじの、直近1か月（${md(from)}〜${md(now.iso)}）の還元率です。グラフにカーソルを合わせると、その日の値が出ます。くじの名前を押すと、くじ別のページ（過去1年のグラフ）に移動します。</p>
${ad('top')}
<h2 id="charts">くじごとの還元率推移</h2>
<div class="charts">
${variable.map((r) => chartCard(rel, r, seriesOf(r), { days: DAYS })).join('\n')}
</div>
<p class="note">※グラフの横軸は直近${DAYS}日で固定しています。灰色の横線は50%の位置です。${anyCalc ? 'サイトで記録を始める前の期間は、公式の販売実績額と繰越額から計算し直した値です。' : ''}</p>
${ad('middle')}
<h2 id="table">日ごとの還元率（表）</h2>
${table}
<h2 id="fixed">還元率が変わらないくじ</h2>
<p>賞金が決まっているくじや、理論値で計算しているくじは、毎日同じ還元率です。</p>
<div class="tbl-wrap"><table class="t compact"><thead><tr><th>くじ</th><th>還元率</th></tr></thead><tbody>
${fixed.map((r) => `<tr><td><a class="gname" href="${rel}kuji/${r.id}.html">${esc(r.def.name)}</a></td><td class="r"><b>${pct(r.rate)}</b></td></tr>`).join('\n')}
</tbody></table></div>
${ad('bottom')}
`;
    return { path, html: layout({ path, title: `宝くじ還元率の推移｜${site.siteName}`, description: 'ロト6・ロト7・BIG・MEGA BIG・DUNKなどの還元率を、直近1か月分のグラフと表で載せています。', body, current: 'suii', jsonld: [breadcrumbLd(path, '還元率の推移')], scripts: CHART_JS }) };
  }

  /* ---------------- このサイトについて ---------------- */

  function about() {
    const path = 'about.html';
    const rel = '';
    const contact = site.contactFormUrl
      ? `<a href="${esc(site.contactFormUrl)}" target="_blank" rel="noopener">お問い合わせフォーム</a>からご連絡ください。`
      : site.contactEmail ? `メール（<span class="nw">${esc(site.contactEmail.replace('@', ' [at] '))}</span>）でご連絡ください。[at] を @ に置き換えてください。` : '';
    const body = `
${crumbs(rel, [{ name: 'このサイトについて' }])}
<h1 class="page-title">このサイトについて</h1>
<p>宝くじやスポーツくじの還元率は、キャリーオーバーの額や売上で毎回変わります。そこで、ネットで買えるくじの還元率を毎日計算し直して、どのくじが狙い目か一目で分かるようにしたのがこのサイトです。</p>
<p>数値は公式発表のデータから自動で計算しています。計算の手順は<a href="${rel}keisan.html">還元率の計算方法</a>に、データの取得元は各くじのページの出典欄に載せています。</p>
<h2>運営者</h2>
<dl class="kv">
<dt>サイト名</dt><dd>${esc(site.siteName)}</dd>
<dt>運営者</dt><dd>${esc(site.operatorName)}</dd>
<dt>開設</dt><dd>${esc(fmtYmd(site.startedOn || now.iso))}</dd>
</dl>
${contact ? `<h2>お問い合わせ</h2><p>数値の誤りのご指摘や、掲載についてのお問い合わせは、${contact}</p>` : ''}
<h2>ランキングの決め方</h2>
<p>還元率ランキングは、計算した還元率の高い順です。ポイント還元ランキングは、各社の公式ページに書かれているポイントの率の高い順です。購入場所のボタンも、ポイントの多い順に並べています。広告の有無や報酬の額で、順位や並び順を変えることはありません。</p>
<h2>情報の確認</h2>
<p>還元率のもとになる販売額やキャリーオーバーは、公式発表から1日に数回自動で取得しています。購入場所とポイントの情報は、各社の公式ページで確認し、確認日をページに載せています（最終確認：${esc(fmtYmd(checkedOn))}）。ポイント・購入場所・くじのルール（1口の値段・賞金・確率・1等の上限）が書かれた公式ページは毎日自動で変化をチェックし、変わったときは内容を確かめて直しています。新しいジャンボ宝くじの賞金表は、宝くじ公式サイトの発表から自動で読み取り、本数と金額の検算に通ったものだけを載せています。運営者が公式発表と見比べて確認するまでは、くじ別ページにその旨を表示します。</p>
<h2>広告について</h2>
<p>当サイトは、運営費をまかなうために広告（Google AdSense などの広告配信と、アフィリエイト広告）を掲載しています。アフィリエイト広告のボタンを含む所には、その近くに「PR（広告を含みます）」と表示しています。</p>
<h2>楽しみの範囲で買うために</h2>
<p>宝くじとスポーツくじは、当せん金の総額が売上の半分ほどまでと法律で決められていて、還元率はキャリーオーバーがあるときを除いて45〜50%ほどです。たくさん買うほど、平均すると損が大きくなります。このサイトの還元率は「同じお金で、どのくじが少しでも割がよいか」を比べるためのもので、当たりやすさやもうけを約束するものではありません。</p>
<p>生活に必要なお金は使わず、あらかじめ決めた金額の範囲で楽しんでください。スポーツくじ（BIG・DUNK など）は、19歳未満の方は購入できません。のめり込みが心配なときは、お住まいの地域の精神保健福祉センターなどに相談できます。</p>
`;
    return { path, html: layout({ path, title: `このサイトについて｜${site.siteName}`, description: `${site.siteName}の目的と運営者情報、ランキングの決め方、情報の確認のしかたです。`, body }) };
  }

  /* ---------------- プライバシーポリシー ---------------- */

  function privacy() {
    const path = 'privacy.html';
    const body = `
${crumbs('', [{ name: 'プライバシーポリシー・免責事項' }])}
<h1 class="page-title">プライバシーポリシー・免責事項</h1>
<h2>広告の配信について</h2>
<p>当サイトは、第三者配信の広告サービス「Google AdSense」を利用しています（利用を始める前は表示されません）。広告配信事業者は、ユーザーの興味に応じた広告を表示するために Cookie を使用することがあります。Cookie を使うことで、当サイトや他のサイトへの過去のアクセス情報に基づいて広告が配信されます。</p>
<p>Google が広告 Cookie を使用することにより、Google やそのパートナーは当サイトや他のサイトへのアクセス情報に基づいて広告を配信できます。パーソナライズ広告は、<a href="https://adssettings.google.com/" target="_blank" rel="noopener">広告設定</a>で無効にできます。詳しくは<a href="https://policies.google.com/technologies/ads?hl=ja" target="_blank" rel="noopener">Google のポリシーと規約（広告）</a>をご覧ください。</p>
<h2>アフィリエイトについて</h2>
<p>当サイトは、アフィリエイトプログラム（成果報酬型の広告）に参加しています。リンク先で申し込みや購入があると、当サイトに報酬が支払われることがあります。該当するボタンを含む所には、その近くに「PR（広告を含みます）」と表示しています。</p>
<h2>アクセス解析について</h2>
<p>当サイトは、アクセス状況を把握するために Google アナリティクスを利用することがあります。Google アナリティクスは Cookie を使って匿名のトラフィックデータを収集します。個人を特定する情報は含みません。ページの改善のため、購入場所などの外部のサイトへのボタンが押されたこと（どのページのどのボタンか）も記録しています。収集を止めたい場合は、<a href="https://tools.google.com/dlpage/gaoptout?hl=ja" target="_blank" rel="noopener">Google アナリティクス オプトアウト アドオン</a>を利用できます。</p>
<h2>外部に送信される情報</h2>
<div class="tbl-wrap"><table class="t">
<thead><tr><th>送信先</th><th>送信される情報</th><th>目的</th></tr></thead>
<tbody>
<tr><td>Google LLC（Google AdSense）</td><td>閲覧したページのURL、Cookie ID、IPアドレス、ブラウザの情報など</td><td>広告の配信と効果測定</td></tr>
<tr><td>Google LLC（Google アナリティクス）</td><td>閲覧したページのURL、Cookie ID、ブラウザの情報など</td><td>アクセス解析</td></tr>
</tbody></table></div>
${hasContact ? '<h2>個人情報の取り扱い</h2><p>お問い合わせでいただいたメールアドレスなどの個人情報は、返信のためだけに使い、法令に基づく場合を除いて第三者に提供しません。</p>' : ''}
<h2>免責事項</h2>
<p>当サイトの数値は、公式発表のデータをもとに自動で計算していますが、正確さや最新であることを保証するものではありません。当せん番号、当せん金、販売期間、ポイントの条件などは、必ず発売元・販売元・各社の公式発表で確認してください。当サイトの情報を使って生じた損害について、当サイトは責任を負いません。</p>
<p>当サイトからリンクしている外部サイトの内容について、当サイトは責任を負いません。</p>
<h2>著作権</h2>
<p>当サイトの文章と表の著作権は運営者に帰属します。引用する場合は出典として当サイトへのリンクを記載してください。くじの名称やサービス名は各社の商標です。</p>
<h2>改定</h2>
<p>この方針は、必要に応じて予告なく改定します。</p>
<p class="note">制定：${esc(fmtYmd(site.startedOn || now.iso))}</p>
`;
    return { path, html: layout({ path, title: `プライバシーポリシー・免責事項｜${site.siteName}`, description: `${site.siteName}のプライバシーポリシー、広告とCookie、免責事項です。`, body }) };
  }

  /* ---------------- 解説ページ（宝くじの基礎知識。content/guide/*.md） ---------------- */

  /** 解説ページの自動の数字（{{rate:loto6}} など）。くじが見つからないときは「—」にして、止めずに知らせる */
  const gRow = (id) => (byId[id]?.computable && byId[id].ev?.computable ? byId[id] : null);
  const warnedGames = new Set();
  function noGame(id) {
    if (warnedGames.has(id)) return;
    warnedGames.add(id);
    console.log(`::warning::解説ページ（content/guide）で使っているくじ「${id}」が、data/games.json にないか計算できません。「—」と表示しています`);
  }
  const GUIDE_TOKENS = ['date', 'rate', 'ev', 'price', 'p1', 'max', 'name', 'co', 'pt'];
  function guideToken(name, arg) {
    if (!GUIDE_TOKENS.includes(name)) return null;
    if (name === 'date') return fmtYmd(now.iso);
    const r = gRow(arg);
    if (!r) { noGame(arg); return '—'; }
    if (name === 'rate') return pct(r.rate);
    if (name === 'ev') return `約${num(r.ev.ev)}円`;
    if (name === 'price') return yen(r.def.price);
    if (name === 'p1') return odds(chanceTop(r).p);
    if (name === 'max') return pct(Number.isFinite(r.maxRate) ? r.maxRate : r.rate);
    if (name === 'co') return r.hasCO && r.carryover > 0 ? yen(r.carryover) : 'なし'; // いまのキャリーオーバー
    if (name === 'pt') return bestPointText(r.id) || 'ポイント還元ランキングで比べている買い方'; // ポイントがいちばん付く買い方
    return r.def.name;
  }

  /** 解説ページの表に出すくじ：計算できて、発売が終わっていないもの（宝くじ一覧の順） */
  const guideRows = () => rows.filter((r) => r.computable && r.ev?.computable && r.def.model !== 'none' && r.status.kind !== 'ended' && !isPastJumbo(r.def, now.iso))
    .sort((a, b) => ctx.order[a.id] - ctx.order[b.id]);
  const kujiLink = (rel, r) => `<a href="${rel}kuji/${r.id}.html">${esc(r.def.name)}</a>`;

  /** 当せんの分け方：申込タイプごとの [{ p, prize }]（ナンバーズ以外はタイプが1つ。先頭が1等＝ナンバーズはストレート） */
  function hitTypes(r) {
    const d = r.def;
    if (d.model === 'numbers') return d.types.map((t) => ({ name: t.name, hits: t.hits.map((h) => ({ p: h.count / d.combos, prize: h.prize })) }));
    return [{ name: '', hits: (r.ev.rows || []).map((x) => ({ p: x.p, prize: Number.isFinite(x.theo) ? x.theo : x.expected })) }];
  }
  /** 1口で min 円以上が当たる確率（当せん金が変わるくじは理論値で分ける。ナンバーズは、いちばん高くなる申込タイプ） */
  function chanceMin(r, min) {
    let best = { p: 0, type: '' };
    for (const t of hitTypes(r)) {
      const p = t.hits.filter((h) => h.prize >= min).reduce((s, h) => s + h.p, 0);
      if (p > best.p * (1 + 1e-9)) best = { p, type: t.name };
    }
    return best;
  }
  const chanceTop = (r) => { const t = hitTypes(r)[0]; return { p: t.hits[0]?.p || 0, type: t.name }; };
  const chanceCell = (c) => (c.p > 0 ? `${odds(c.p)}<span class="sub">${probPct(c.p)}${c.type ? `・${esc(c.type)}` : ''}</span>` : '<span class="sub">—</span>');
  /** 確率がいちばん高いくじ（同じ確率のくじは全部） */
  function topBy(list, fn) {
    const best = Math.max(...list.map(fn));
    return best > 0 ? list.filter((r) => fn(r) >= best * (1 - 1e-9)) : [];
  }
  /** 年数を読みやすく（上から3けた）：58,620 → 5万8,600年 */
  const yearsJa = (y) => {
    const k = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(y, 1))) - 2);
    return yenJa(Math.round(y / k) * k).replace(/円$/, '年');
  };

  function evTable(rel) {
    const list = [...guideRows()].sort((a, b) => b.rate - a.rate || ctx.order[a.id] - ctx.order[b.id]);
    if (!list.length) return '<p>データを取得できていません。</p>';
    const trs = list.map((r) => `<tr><th scope="row"><a class="gname" href="${rel}kuji/${r.id}.html">${esc(r.def.name)}</a>${r.status.kind === 'upcoming' ? '<span class="sub">発売前</span>' : ''}</th><td class="r">${yen(r.def.price)}</td><td class="r"><b>約${num(r.ev.ev)}円</b></td><td class="r"><span class="rate${r.rate >= 0.5 ? ' hi' : ''}">${pct(r.rate)}</span></td><td class="r">約${num(Math.round(r.rate * 1000) * 10)}円</td></tr>`).join('\n');
    const hi = list[0];
    const lo = list[list.length - 1];
    return `<p>${fmtYmd(now.iso)}の時点で、還元率がいちばん高いのは${kujiLink(rel, hi)}（${pct(hi.rate)}）、いちばん低いのは${kujiLink(rel, lo)}（${pct(lo.rate)}）です。</p>
<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t evtbl">
<thead><tr><th>くじ</th><th>1口の値段</th><th>期待値<br>（1口で平均して戻る額）</th><th>還元率</th><th>1万円分買うと<br>平均で戻る額</th></tr></thead>
<tbody>
${trs}
</tbody></table></div>
<div class="note"><p>※還元率の高い順です。発売中と発売前のくじを、毎日計算し直しています。ロト・BIG系・DUNKは、キャリーオーバーと今回の販売額の見込みから計算した値です。ポイントを足した「ポイント込みの還元率」は<a href="${rel}point.html">ポイント還元ランキング</a>に載せています。</p></div>`;
  }

  function chanceTable(rel) {
    const list = guideRows();
    if (!list.length) return '<p>データを取得できていません。</p>';
    const trs = list.map((r) => {
      const fp = firstPrize(r);
      return `<tr><th scope="row"><a class="gname" href="${rel}kuji/${r.id}.html">${esc(r.def.name)}</a><span class="sub">1口${yen(r.def.price)}${fp ? `・1等${yen(fp.amount)}` : ''}</span></th><td class="r">${chanceCell(chanceTop(r))}</td><td class="r">${chanceCell(chanceMin(r, 1e6))}</td><td class="r">${chanceCell(chanceMin(r, 1e4))}</td><td class="r">${chanceCell(chanceMin(r, 0))}</td><td class="r"><b>${pct(r.rate)}</b></td></tr>`;
    }).join('\n');
    return `<p class="scroll-hint">表は横にスクロールできます →</p>
<div class="tbl-wrap"><table class="t chtbl">
<thead><tr><th>くじ</th><th>1等</th><th>100万円以上</th><th>1万円以上</th><th>何か当たる<br>（いちばん下の賞まで）</th><th>還元率</th></tr></thead>
<tbody>
${trs}
</tbody></table></div>
<div class="note"><p>※1口（ジャンボは1枚）を買ったときに当たる確率です（${fmtYmd(now.iso)}時点で発売中・発売前のくじ）。当せん金が回ごとに変わるくじは、平均どおりに当たった場合の額（理論値）で「100万円以上」「1万円以上」に分けています。くじの名前の下の1等の金額は、キャリーオーバーと山分けを織り込んだ今の見込みです。</p><p>※ナンバーズは、その欄の確率がいちばん高くなる申込タイプ（ストレート・ボックスなど）で計算しています。1等の欄はストレートです。</p></div>`;
  }

  function chanceSummary(rel) {
    const list = guideRows();
    if (!list.length) return '';
    const names = (rs) => rs.map((r) => kujiLink(rel, r)).join('・');
    const top1 = topBy(list, (r) => chanceTop(r).p);
    const low1 = topBy(list, (r) => 1 / (chanceTop(r).p || 1));
    const m100 = topBy(list, (r) => chanceMin(r, 1e6).p);
    const m1 = topBy(list, (r) => chanceMin(r, 1e4).p);
    const prize = (r) => { const fp = firstPrize(r); return fp ? yen(fp.amount) : '—'; };
    const items = [];
    if (top1.length) items.push(`1等（ナンバーズはストレート）がいちばん当たりやすいのは${names(top1)}で、${odds(chanceTop(top1[0]).p)}です。そのかわり、1等の金額は${prize(top1[0])}です。`);
    if (low1.length) items.push(`1等がいちばん当たりにくいのは${names(low1)}で、${odds(chanceTop(low1[0]).p)}です。1等の金額は${prize(low1[0])}です。`);
    if (m100.length) items.push(`100万円以上がいちばん当たりやすいのは${names(m100)}で、${odds(chanceMin(m100[0], 1e6).p)}です。`);
    if (m1.length) { const c = chanceMin(m1[0], 1e4); items.push(`1万円以上がいちばん当たりやすいのは${names(m1)}${c.type ? `の${esc(c.type)}` : ''}で、${odds(c.p)}です。`); }
    return `<ul class="points">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  }

  function yearsText(rel) {
    const items = [];
    for (const id of ['loto6', 'loto7']) {
      const r = gRow(id);
      if (!r?.def.drawDays?.length) continue;
      const p = chanceTop(r).p;
      const perYear = r.def.drawDays.length * 52;
      const y = 1 / (p * perYear);
      items.push(`${kujiLink(rel, r)}の1等（${odds(p)}）：抽せんのたびに1口ずつ買い続けると、当たるのは平均で約${yearsJa(y)}に1回です。毎回10口ずつでも約${yearsJa(y / 10)}に1回です（1年に${perYear}回の抽せんとして計算）。`);
    }
    const js = guideRows().filter((r) => isJumbo(r.def)).sort((a, b) => b.def.tiers[0].prize - a.def.tiers[0].prize);
    if (js[0]) {
      const p = chanceTop(js[0]).p;
      items.push(`${kujiLink(rel, js[0])}の1等（${odds(p)}）：毎年100枚（3万円分）ずつ買い続けると、当たるのは平均で約${yearsJa(1 / (p * 100))}に1回です。`);
    }
    return items.length ? `<ul class="points">${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
  }

  function giftTableHtml() {
    const trs = GIFT_AMOUNTS.map((a) => `<tr><th scope="row">${yen(a)}</th><td class="r">${yen(giftTax(a))}</td><td class="r">${yen(giftTax(a, { special: true }))}</td></tr>`).join('\n');
    return `<div class="tbl-wrap"><table class="t compact gifttbl">
<thead><tr><th>1年間に渡す額</th><th>贈与税<br>（一般の税率）</th><th>贈与税<br>（特例の税率）</th></tr></thead>
<tbody>
${trs}
</tbody></table></div>
<div class="note"><p>※もらった1人が、1年間（1月〜12月）にもらった額の合計にかかる贈与税（暦年課税）です。基礎控除の110万円を引いてから、国税庁の速算表で計算しました。「特例の税率」は、その年の1月1日に18歳以上の人が父母や祖父母からもらった場合、「一般の税率」は夫婦・兄弟・友人などからもらった場合です。相続時精算課税などを選んだ場合は、計算が変わります。</p></div>`;
  }

  function jumboLinks(rel) {
    const js = rows.filter((r) => isJumbo(r.def) && r.ev?.computable && ['onsale', 'upcoming'].includes(r.status.kind))
      .sort((a, b) => String(a.def.salesStart).localeCompare(String(b.def.salesStart)) || ctx.order[a.id] - ctx.order[b.id]);
    if (!js.length) return '<p>いま発売中・発売予定のジャンボ宝くじはありません。発表されしだい、このサイトに載せます。</p>';
    return `<ul>${js.map((r) => `<li><a href="${rel}kuji/${r.id}.html">${esc(yearName(r.def))}</a>（${r.status.kind === 'onsale' ? `${fmtMd(r.def.salesEnd)}まで発売中` : `${fmtMd(r.def.salesStart)}から発売`}・1等は${oddsJa(r.def.totalTickets / r.def.tiers[0].count)}）</li>`).join('')}</ul>`;
  }

  function coNow(rel) {
    const list = listed.filter((r) => r.hasCO && r.carryover > 0).sort((a, b) => b.rate - a.rate || ctx.order[a.id] - ctx.order[b.id]);
    if (!list.length) return `<p>${fmtYmd(now.iso)}の時点では、キャリーオーバーが出ているくじはありません。</p>`;
    return `<p>${fmtYmd(now.iso)}の時点でキャリーオーバーが出ているくじと、いまの還元率です。</p>
<ul>${list.map((r) => {
      const atMax = Number.isFinite(r.maxRate) && r.maxRate <= r.rate + 0.0005;
      const more = Number.isFinite(r.maxRate) && !atMax ? `。キャリーオーバーがさらに増えると、最大で${pct(r.maxRate)}まで上がります` : atMax ? '。1等が上限の額に届いているため、キャリーオーバーが増えてもこれ以上は上がりません' : '';
      return `<li>${kujiLink(rel, r)}：キャリーオーバー${yen(r.carryover)}、還元率<b>${pct(r.rate)}</b>${more}。</li>`;
    }).join('')}</ul>`;
  }

  /** のめり込みへの注意（解説ページの最後に必ず出す） */
  const careBox = () => '<div class="notice care"><p><b>楽しみの範囲で買うために</b></p><p>宝くじとスポーツくじは、平均すると買った金額の半分ほどしか戻らないしくみです。生活に必要なお金は使わず、あらかじめ決めた金額の範囲で楽しんでください。スポーツくじは19歳未満の方は購入できません。のめり込みが心配なときは、<a href="https://www.ncasa-japan.jp/you-do/treatment/treatment-map/" target="_blank" rel="noopener">全国の相談窓口（依存症対策全国センター）</a>に相談できます。</p></div>';

  function guideBlock(name, arg, rel) {
    switch (`${name}:${arg}`) {
      case 'table:ev': return evTable(rel);
      case 'table:chance': return chanceTable(rel);
      case 'chance:summary': return chanceSummary(rel);
      case 'chance:years': return yearsText(rel);
      case 'table:gift': return giftTableHtml();
      case 'table:shops': return shopCompareTable();
      case 'list:jumbo': return jumboLinks(rel);
      case 'list:co': return coNow(rel);
      default: return null;
    }
  }

  function guidePage(g) {
    const path = guidePath(g);
    const rel = relOf(path);
    const m = g.meta;
    const name = guideName(g);
    const r = renderGuideBody(g.body, { rel, top: home(rel), token: guideToken, block: (n, a) => guideBlock(n, a, rel) });
    // 広告は、目次の下・3つ目の大見出しの前・本文の最後（ほかのページと同じ数）
    let main = r.html;
    const third = [...main.matchAll(/<h2 id="/g)][2];
    if (third) main = `${main.slice(0, third.index)}${ad('middle')}\n${main.slice(third.index)}`;
    // 毎日の計算の数字を使うページだけ「毎日更新」と最終更新を出す（税金の早見表や購入場所の表は毎日は変わらない）
    const dynamic = /\{\{(?:table:(?:ev|chance)|chance:|list:(?:co|jumbo)|(?:rate|ev|p1|max|co):|date\}\})/.test(g.body);
    const checked = m.checkedOn ? `<span>内容の確認日：${fmtYmd(m.checkedOn)}</span>` : '';
    const others = guideList.filter((x) => x.slug !== g.slug);
    // シェアと検索の画像（設定の image に static/og の画像の名前。なければサイト共通の og.png）
    const image = m.image ? ogImage(m.image, m.imageAlt || `${m.short || name}のイラスト`) : null;
    const body = `
${crumbs(rel, [{ name: HUB_NAME, href: `${rel}${HUB_PATH}` }, { name }])}
<h1 class="page-title">${esc(name)}</h1>
${dynamic ? updatedLine(checked) : `<p class="updated">${checked}</p>`}
${r.lead}
${share(path, name)}
${r.toc.length ? toc(r.toc) : ''}
${ad('top')}
${main}
${careBox()}
${(m.sources || []).length ? `<h3>出典</h3>
<ul class="note">
${m.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('\n')}
</ul>
${m.checkedOn ? `<p class="note">※法令・制度・各社の案内は、${fmtYmd(m.checkedOn)}に上の公式の情報で確かめた内容です。変わることがあるので、手続きの前に公式の情報も確認してください。</p>` : ''}` : ''}
${ad('bottom')}
${others.length ? `<h2 id="more">${HUB_NAME}のほかのページ</h2>\n${guideLinks(rel, g.slug)}` : ''}
<h3>くじ別の還元率を見る</h3>
${related(rel, null)}
`;
    const ld = [
      breadcrumbLd(path, name, { name: HUB_NAME, path: HUB_PATH }),
      { '@context': 'https://schema.org', '@type': 'Article', headline: name, description: m.description || '', inLanguage: 'ja', ...(m.checkedOn ? { dateModified: m.checkedOn } : {}), ...(image ? { image: [`${base}/${image.src}`] } : {}), author: { '@type': 'Organization', name: site.siteName, url: `${base}/` }, publisher: { '@type': 'Organization', name: site.siteName }, mainEntityOfPage: pageUrl(path) },
      ...(r.faq.length ? [faqLd(r.faq.map(([q, , a]) => [q, a]))] : []),
    ];
    return { path, html: layout({ path, title: `${m.title || name}｜${site.siteName}`, description: m.description || '', body, current: 'guide', jsonld: ld, image }) };
  }

  function guideHub() {
    const path = HUB_PATH;
    const rel = '';
    const body = `
${crumbs(rel, [{ name: HUB_NAME }])}
<h1 class="page-title">${HUB_NAME}</h1>
<p class="lead">宝くじとスポーツくじを買う前に知っておきたいことを、テーマごとにまとめました。還元率（期待値）と当たる確率の表は、このサイトが毎日計算している値から自動で作っています。法律や税金、受け取り方は、法令と発売元・銀行の公式の案内で確かめた内容です。</p>
${ad('top')}
${guideListCards(rel)}
<h2 id="tools">あわせて見たいページ</h2>
<div class="related guides"><a href="${home(rel)}"><span>今日の還元率ランキング</span></a><a href="${rel}point.html"><span>ポイント還元ランキング</span></a><a href="${rel}kaikata.html"><span>購入場所の比較</span></a><a href="${rel}ichiran.html"><span>宝くじ一覧（くじごとのしくみ）</span></a><a href="${rel}keisan.html"><span>還元率の計算方法</span></a><a href="${rel}suii.html"><span>還元率の推移</span></a></div>
${careBox()}
${ad('bottom')}
`;
    return { path, html: layout({ path, title: `${HUB_NAME}（還元率・確率・税金・受け取り方）｜${site.siteName}`, description: '宝くじ・スポーツくじの還元率（期待値）と当たる確率の比較、当せん金の税金と受け取り方、ネットでの買い方を、公式の情報と毎日の計算をもとにまとめています。', body, current: 'guide', jsonld: [breadcrumbLd(path, HUB_NAME)] }) };
  }

  /** 解説ページ（一覧のページと、各ページ） */
  const guides_ = () => (guideList.length ? [guideHub(), ...guideList.map(guidePage)] : []);

  function notFound() {
    const path = '404.html';
    // GitHub Pages は、存在しない URL（/kuji/abc/def.html のような深い階層も）でこのページをそのまま返す。
    // 相対パスだと、そのURLの階層からたどってしまい CSS もリンクもずれるため、baseUrl から始まるURLで書く。
    // 独自ドメインに移ったあとも baseUrl に合わせて変わる（共有プレビューはファイルを直接開くので相対パスのまま）
    const linkBase = preview ? '' : `${base}/`;
    const body = `<h1 class="page-title">ページが見つかりません</h1><p>URLが変わったか、ページが削除された可能性があります。<a href="${home(linkBase)}">トップページ</a>から探してください。</p>`;
    return { path, html: layout({ path, title: `ページが見つかりません｜${site.siteName}`, description: 'ページが見つかりません。', body, noindex: true, linkBase, ads: false }) };
  }

  return { index, game, ichiran, keisan, kaikata, point, suii, about, privacy, notFound, guides: guides_ };
}

/* ---------------- 購入ボタンのクリックの計測（GA4 を設定したときだけ。全ページ共通） ---------------- */

// 購入場所・申し込みのボタン（data-shop が付いたリンク）が押されたら、GA4 にイベント shop_click を送る。
//   shop … 購入場所（config/links.json の shops のキー。申し込みは signups のキー）
//   kind … buy（購入場所）か signup（口座開設・カード・会員登録）
//   place … ページ内の場所（囲む要素の data-place。なければ直前の大見出し h2 の id）
//   kuji … くじの ID（囲む要素か <main> の data-kuji。分からなければ送らない）
// ページの URL は GA4 が自動で記録する。外部のサイトは新しいタブで開くので、送る前にページが閉じることはない。
export const CLICK_JS = `<script>
(function(){
  document.addEventListener('click', function(e){
    var link = e.target && e.target.closest ? e.target.closest('a') : null;
    var a = link ? link.closest('[data-shop]') : null;
    if (!a || typeof window.gtag !== 'function') return;
    var holder = a.closest('[data-place]');
    var place = holder ? holder.getAttribute('data-place') : '';
    if (!place) {
      var main = document.getElementById('main'), el = a;
      while (el.parentElement && el.parentElement !== main) el = el.parentElement;
      for (var s = el; s && !place; s = s.previousElementSibling) if (s.tagName === 'H2' && s.id) place = s.id;
      if (!place) place = 'top';
    }
    var k = a.closest('[data-kuji]');
    var p = { shop: a.getAttribute('data-shop'), kind: a.getAttribute('data-kind') || 'buy', place: place };
    if (k) p.kuji = k.getAttribute('data-kuji');
    window.gtag('event', 'shop_click', p);
  }, true);
})();
</script>`;

/* ---------------- ページ移動を速くする（Speculation Rules。全ページ共通） ---------------- */

// サイト内のリンクにポインタを重ねた（スマホは指で触れた・画面に出た）ときに、移り先のページを先に読み込んで描いておく。
// Chrome・Edge だけが使い、ほかのブラウザは読み飛ばす。eagerness の moderate は、パソコンはリンクに0.2秒重ねたとき、
// スマホは画面の止まった位置の近くのリンク（Chrome の文書。先読みは同時に2ページまで）。
// 広告やアフィリエイトのリンク（rel に sponsored・nofollow）、新しいタブで開くリンク、同じページの中へのリンクは対象にしない。
// GA4 と AdSense は、先読みしたページが実際に表示されるまで、計測と広告の読み込みを待つ（Chrome の文書）
export const SPECULATION_RULES = {
  prerender: [{
    where: { and: [{ href_matches: '/*' }, { not: { selector_matches: '[rel~="sponsored"], [rel~="nofollow"], [target="_blank"], [download], [href^="#"]' } }] },
    eagerness: 'moderate',
  }],
};

/* ---------------- 動き・カウントダウン・追従ボタン（全ページ共通） ---------------- */

const UI_JS = `<script>
(function(){
  var d = document, w = window;
  function all(s){ return Array.prototype.slice.call(d.querySelectorAll(s)); }
  // 先読み（Speculation Rules）で裏で描いたページは、実際に表示されたときに動かす（数字のカウントアップなどを見えるときに始めるため）
  function whenShown(fn){ if (d.prerendering) d.addEventListener('prerenderingchange', fn, { once: true }); else fn(); }

  // サイト内のリンクで移ったときは、ページの一番上から表示する（埋め込み表示で外側の位置が残る対策）
  d.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank') return;
    var h = a.getAttribute('href') || '';
    if (h.charAt(0) === '#' || /^[a-z]+:/i.test(h)) return;
    try { sessionStorage.setItem('kt-top', '1'); } catch (x) {}
  }, true);
  whenShown(function(){ try {
    var nav = w.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    var type = nav ? nav.type : 'navigate';
    var flag = false;
    try { flag = sessionStorage.getItem('kt-top') === '1'; sessionStorage.removeItem('kt-top'); } catch (x) {}
    var sameRef = false;
    try { var ru = new URL(d.referrer); sameRef = ru.origin === location.origin && ru.pathname !== location.pathname; } catch (x) {}
    if (!location.hash && type === 'navigate' && (flag || sameRef)) {
      w.scrollTo(0, 0);
      var tp = d.getElementById('top');
      if (tp && tp.scrollIntoView && w.self !== w.top) tp.scrollIntoView({ block: 'start' });
    }
  } catch (x) {} });

  // 締切までのカウントダウン
  var cds = all('.cd[data-deadline]');
  function tick(){
    var t0 = Date.now();
    cds.forEach(function(el){
      var t = Date.parse(el.getAttribute('data-deadline')); var r = el.querySelector('.cd-r');
      if (!r || isNaN(t)) return;
      var s = Math.floor((t - t0) / 1000);
      if (s <= 0) { r.textContent = '締切を過ぎました'; el.classList.add('over'); return; }
      var dd = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
      r.textContent = 'あと' + (dd ? dd + '日' + hh + '時間' : hh ? hh + '時間' + mm + '分' : mm + '分' + (ss < 10 ? '0' : '') + ss + '秒');
      el.classList.toggle('soon', s < 6 * 3600);
    });
  }
  if (cds.length) { tick(); setInterval(tick, 1000); }

  var IO = 'IntersectionObserver' in w;
  function onView(els, fn, opt){
    if (!els.length) return;
    if (!IO) { els.forEach(fn); return; }
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting) { io.unobserve(e.target); fn(e.target); } }); }, opt || { rootMargin: '0px 0px -6% 0px' });
    els.forEach(function(el){ io.observe(el); });
  }

  // 横にスクロールする表は、キーボードでも操作できるよう、フォーカスできるようにする
  all('.tbl-wrap').forEach(function(el){ if (el.scrollWidth > el.clientWidth + 1 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0'); });

  // スマホで画面の下に出る購入ボタン
  var st = d.querySelector('.sticky-cta'), anchor = d.querySelector('[data-sticky-anchor]'), foot = d.querySelector('.foot');
  if (st && anchor) {
    var queued = false;
    var upd = function(){
      queued = false;
      var past = anchor.getBoundingClientRect().bottom < 0;
      var nearFoot = foot ? foot.getBoundingClientRect().top < (w.innerHeight || 800) : false;
      st.classList.toggle('on', past && !nearFoot);
    };
    w.addEventListener('scroll', function(){ if (!queued) { queued = true; w.requestAnimationFrame(upd); } }, { passive: true });
    w.addEventListener('resize', upd);
    upd();
  }

  var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  whenShown(function(){
  // 下にある要素は、見えたときにふわっと表示
  var vh = w.innerHeight || 800;
  var rv = all('main h2, .rank-card, .chart, .kuji-sec, .shops > li, .rt-card, .pick, .related > a, .tbl-wrap, .steps > li, .faq > dt, .side .widget, .score-grid > div');
  var pre = rv.filter(function(el){ return el.getBoundingClientRect().top > vh * 0.98; });
  pre.forEach(function(el){
    var i = 0, p = el.previousElementSibling;
    while (p && i < 5 && p.tagName === el.tagName && p.className.split(' ')[0] === el.className.split(' ')[0]) { i++; p = p.previousElementSibling; }
    el.style.transitionDelay = (i * 70) + 'ms';
  });
  pre.forEach(function(el){ el.classList.add('rv', 'pre'); });
  onView(pre, function(el){ el.classList.remove('pre'); setTimeout(function(){ el.style.transitionDelay = ''; }, 1200); });

  // 数字のカウントアップ。数えているあいだは、最後の数字と同じ幅に固定して、まわりの文字や表がずれないようにする
  // （2行に折り返して表示している数字は、幅を固定できないので動かさない）
  function yj(n){
    n = Math.round(n); var f = function(x){ return x.toLocaleString('ja-JP'); };
    if (n < 10000) return f(n) + '円';
    var o = Math.floor(n / 1e8), m = Math.floor(n % 1e8 / 1e4), r = n % 1e4;
    return (o ? f(o) + '億' : '') + (m ? f(m) + '万' : '') + (r ? f(r) : '') + '円';
  }
  function countUp(el){
    var to = parseFloat(el.getAttribute('data-to')); if (!isFinite(to) || to <= 0) return;
    var rs = el.getClientRects(); if (rs.length !== 1) return;
    var isYen = el.classList.contains('cuy'), dec = +(el.getAttribute('data-dec') || 0), fin = el.textContent, s0 = null, dur = isYen ? 1200 : 900;
    var st = el.style; st.display = 'inline-block'; st.width = rs[0].width + 'px'; st.whiteSpace = 'nowrap';
    function f(ts){
      if (s0 === null) s0 = ts;
      var k = Math.min(1, (ts - s0) / dur), e = 1 - Math.pow(1 - k, 3), v = to * e;
      el.textContent = isYen ? yj(v) : v.toFixed(dec);
      if (k < 1) w.requestAnimationFrame(f); else { el.textContent = fin; st.display = ''; st.width = ''; st.whiteSpace = ''; }
    }
    w.requestAnimationFrame(f);
  }
  onView(all('.cu, .cuy'), countUp, { threshold: 0.5 });

  // 還元率のバーとグラフの線
  onView(all('.bar'), function(el){ el.classList.add('fill'); }, { threshold: 0.3 });
  onView(all('svg.spark'), function(el){ el.classList.add('draw'); }, { threshold: 0.25 });
  });
})();
</script>`;

/** ads.txt の中身。サイト運営者 ID が「ca-pub- と数字」の形のときだけ作り、それ以外（空・pub- だけなど）は空にする */
export const adsTxt = (client) => (/^ca-pub-\d+$/.test(String(client || '')) ? `google.com, ${String(client).slice(3)}, DIRECT, f08c47fec0942fa0\n` : '');

/* ---------------- フォント・キャリーオーバー速報の帯 ---------------- */

/** このサイトから配信するフォント（static/fonts。全ページで先に読み込む）。作り方は README の「フォント」 */
export const FONT_FILES = ['oswald-700.woff2', 'dela-gothic-one-logo.woff2'];

// キャリーオーバー速報の帯：はみ出すときだけ横に流す。帯のすぐ後ろで動かして、ページの表示の途中で帯の高さが変わらないようにする。
// 「視差効果を減らす」がオンの人には流さない（折り返して全部見せる）
const TICKER_JS = `<script>
(function(){
  var s = document.currentScript, tk = s && s.previousElementSibling;
  if (!tk || !tk.classList.contains('ticker')) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var view = tk.querySelector('.tk-view'), list = tk.querySelector('.tk-list');
  if (!view || !list) return;
  tk.classList.add('measure');
  if (list.scrollWidth > view.clientWidth + 2) {
    Array.prototype.slice.call(list.children).forEach(function(li){
      var c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true');
      Array.prototype.slice.call(c.querySelectorAll('a')).forEach(function(a){ a.tabIndex = -1; });
      list.appendChild(c);
    });
    list.style.setProperty('--tk-dur', Math.max(16, Math.round(list.scrollWidth / 2 / 50)) + 's');
    tk.classList.add('run');
  } else tk.classList.remove('measure');
})();
</script>`;
