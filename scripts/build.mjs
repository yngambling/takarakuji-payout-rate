#!/usr/bin/env node
// data/ と config/ から静的サイト（dist/）を生成する。
//   node scripts/build.mjs                       … dist/ に出力し、data/history.json に今日の還元率を記録
//   node scripts/build.mjs --placeholders        … 広告枠の位置を点線で表示（レイアウト確認用）
//   node scripts/build.mjs --now 2026-10-10T19:30 … 日時を指定して生成（日本時間）
//   node scripts/build.mjs --preview --out preview … 共有プレビュー用（CSSを各ページに埋め込む）

import { readFile, writeFile, mkdir, copyFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jstParts, weekdayOf, verificationCode } from './lib/util.mjs';
import { resolveGames, computeAll } from './lib/model.mjs';
import { createRenderer, adsTxt } from './lib/render.mjs';
import { validKey, contentHash, trackPages } from './lib/indexnow.mjs';
import { parseGuide } from './lib/guide.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PREVIEW = flag('--preview');
const OUT = path.resolve(ROOT, opt('--out', PREVIEW ? 'preview' : 'dist'));
const PLACEHOLDERS = flag('--placeholders');
const RECORD = !PREVIEW && !flag('--no-history');

const readJson = async (f, fb) => {
  try { return JSON.parse(await readFile(P(f), 'utf8')); } catch (e) { if (fb !== undefined) return fb; throw new Error(`${f} を読めません: ${e.message}`); }
};

function parseNow(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return { iso, y: +m[1], m: +m[2], d: +m[3], hh: +(m[4] || 12), mm: +(m[5] || 0), wd: weekdayOf(iso) };
}

const site = await readJson('config/site.json');
const links = await readJson('config/links.json');
const points = await readJson('config/points.json', { routes: [] });
const gamesRaw = await readJson('data/games.json');
const state = await readJson('data/state.json', { games: {} });
const log = await readJson('data/log.json', []);
const history = await readJson('data/history.json', { days: {} });
history.days ??= {};
const overrides = await readJson('data/overrides.json', { games: {} });
const catalog = await readJson('data/catalog.json');
// くじ別ページの解説とよくある質問（ファイルがなければ出さない。書き方の誤りは止めて知らせる）
const guides = existsSync(P('data/guides.json')) ? await readJson('data/guides.json') : { games: {} };
// 解説ページ（宝くじの基礎知識）：content/guide/*.md（書き方は README の「解説ページ」。書き方の誤りは止めて知らせる）
const guidePages = [];
if (existsSync(P('content/guide'))) {
  for (const f of (await readdir(P('content/guide'))).filter((x) => /^[a-z0-9-]+\.md$/.test(x)).sort()) {
    guidePages.push(parseGuide(await readFile(P('content/guide', f), 'utf8'), f));
  }
}
const css = await readFile(P('static/style.css'), 'utf8');
// くじ別ページの画像（static/og/*.png。作り方は README の「くじ別ページの画像」）。ファイル名（拡張子なし）の一覧を渡す
const ogImages = existsSync(P('static/og')) ? (await readdir(P('static/og'))).filter((f) => /^[a-z0-9-]+\.png$/.test(f)).map((f) => f.slice(0, -4)).sort() : [];
// Google Search Console の確認コード（config/google-site-verification.txt に貼ったタグから取り出す。なければ空）
const gsvText = existsSync(P('config/google-site-verification.txt')) ? await readFile(P('config/google-site-verification.txt'), 'utf8') : '';
const verification = verificationCode(gsvText);
const gsvPasted = gsvText.split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith('#'));

const now = parseNow(opt('--now') || process.env.BUILD_NOW) || jstParts();
const defs = resolveGames(gamesRaw);
const order = Object.fromEntries(Object.keys(defs).map((k, i) => [k, i]));
const rows = computeAll(defs, state, now, overrides);
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

// 日ごとの還元率を記録（その日の最後のビルドの値が残る）
if (RECORD) {
  const snap = {};
  for (const r of rows) if (r.listed && Number.isFinite(r.rate)) snap[r.id] = Math.round(r.rate * 10000) / 10000;
  history.days[now.iso] = snap;
  const keep = Object.keys(history.days).sort().slice(-400);
  history.days = Object.fromEntries(keep.map((k) => [k, history.days[k]]));
  await writeFile(P('data/history.json'), JSON.stringify(history, null, 1) + '\n', 'utf8');
}

const render = createRenderer({
  site, links, points, rows, byId, log, history, catalog, guides, guidePages, now, state, defs, order, overrides, verification, ogImages,
  preview: PREVIEW, placeholders: PLACEHOLDERS || PREVIEW, inlineCss: PREVIEW, css,
  cssVersion: createHash('md5').update(css).digest('hex').slice(0, 8),
});

const pages = [render.index()];
for (const r of rows) if (r.def.model !== 'none') pages.push(render.game(r));
pages.push(render.point(), render.ichiran(), render.keisan(), render.kaikata(), render.suii(), render.about(), render.privacy(), ...render.guides(), render.notFound());

if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'kuji'), { recursive: true });
await mkdir(path.join(OUT, 'guide'), { recursive: true });
for (const p of pages) await writeFile(path.join(OUT, p.path), p.html, 'utf8');

for (const f of ['style.css', 'favicon.svg', 'og.png', 'apple-touch-icon.png']) {
  if (existsSync(P('static', f))) await copyFile(P('static', f), path.join(OUT, f));
}
if (ogImages.length) {
  await mkdir(path.join(OUT, 'og'), { recursive: true });
  for (const k of ogImages) await copyFile(P('static/og', `${k}.png`), path.join(OUT, 'og', `${k}.png`));
}
// フォント（使う文字だけに絞ったもの）と、そのライセンス（SIL Open Font License。フォントといっしょに置く決まり）
await mkdir(path.join(OUT, 'fonts'), { recursive: true });
for (const f of ['oswald-700.woff2', 'dela-gothic-one-logo.woff2', 'OFL-Oswald.txt', 'OFL-DelaGothicOne.txt']) {
  await copyFile(P('static/fonts', f), path.join(OUT, 'fonts', f));
}

const base = String(site.baseUrl || '').replace(/\/$/, '');
// ページごとに「内容が最後に変わった日時」を記録する（sitemap.xml の lastmod と、検索エンジンへの通知 IndexNow に使う）
const nowIso = `${now.iso}T${String(now.hh).padStart(2, '0')}:${String(now.mm).padStart(2, '0')}+09:00`;
const pagesState = await readJson('data/pages.json', { pages: {} });
const tracked = trackPages(pagesState.pages || {}, pages.filter((p) => p.path !== '404.html').map((p) => ({ path: p.path, hash: contentHash(p.html) })), nowIso);
if (RECORD) {
  await writeFile(P('data/pages.json'), JSON.stringify({
    _note: 'ページごとの内容のハッシュと、内容が最後に変わった日時（build.mjs が更新）。sitemap.xml の lastmod と、検索エンジンへの通知（scripts/indexnow.mjs）に使います。',
    pages: tracked,
  }, null, 1) + '\n', 'utf8');
}
const indexNowKey = String(site.indexNowKey || '').trim();
if (!PREVIEW) {
  const urls = pages.filter((p) => p.path !== '404.html').map((p) => ({ loc: `${base}/${p.path === 'index.html' ? '' : p.path}`, lastmod: String(tracked[p.path]?.changed || now.iso).slice(0, 10) }));
  await writeFile(path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`, 'utf8');
  await writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`, 'utf8');
  // IndexNow のキーのファイル（検索エンジンが、このサイトの持ち主からの通知か確かめるのに使う）
  if (validKey(indexNowKey)) await writeFile(path.join(OUT, `${indexNowKey}.txt`), indexNowKey, 'utf8');
  const ads = adsTxt(site.adsense?.client);
  if (ads) await writeFile(path.join(OUT, 'ads.txt'), ads, 'utf8');
}

const listed = rows.filter((r) => r.listed).sort((a, b) => b.rate - a.rate);
console.log(`生成: ${pages.length}ページ → ${path.relative(ROOT, OUT) || '.'}（${now.iso} ${String(now.hh).padStart(2, '0')}:${String(now.mm).padStart(2, '0')} 時点）`);
for (const r of listed) {
  console.log(`  ${(r.rate * 100).toFixed(1).padStart(5)}%  ${r.def.name}${r.hasCO ? `  繰越 ${r.carryover.toLocaleString('ja-JP')}円` : ''}${r.provisional ? '（暫定）' : ''}  ${r.status.label} ${r.status.text}${r.special?.on ? `  ★${r.special.name}（1等の上限${r.special.capText}）` : ''}`);
}
if (base.includes('example.com')) console.log('※ config/site.json の baseUrl がまだ example.com です。公開する前に自分のURLに変えてください。');
if (verification) console.log('Google Search Console の確認タグ：全ページに入れました');
if (validKey(indexNowKey)) console.log(`IndexNow のキーのファイル：${indexNowKey}.txt を置きました`);
else if (indexNowKey) console.log('::warning::config/site.json の indexNowKey の形式が正しくありません（英数字とハイフンで8〜128文字）');
else if (gsvPasted) console.log('::warning::config/google-site-verification.txt から確認コードを読み取れませんでした。Search Console の「HTML タグ」をそのまま貼り付けてください。');
