#!/usr/bin/env node
// 一時的な確認：Lighthouse（スマホの設定）で表示速度を測り、GitHub Actions の注釈に出す。プルリクエストを出す前に消す。
//   node scripts/lh-probe.mjs 名前=URL …
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-'));
const rows = [];
for (const arg of process.argv.slice(2)) {
  const [name, url] = arg.split('=');
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const out = path.join(dir, `${name.replace(/\W/g, '_')}-${i}.json`);
    try {
      execFileSync('npx', ['-y', 'lighthouse@12', url, '--only-categories=performance,accessibility,best-practices,seo', '--output=json', `--output-path=${out}`, '--quiet',
        '--blocked-url-patterns=*googletagmanager.com*', '--blocked-url-patterns=*google-analytics.com*', '--chrome-flags=--headless=new --no-sandbox'], { stdio: 'pipe', timeout: 180000 });
      runs.push(JSON.parse(readFileSync(out, 'utf8')));
    } catch (e) {
      console.log(`::warning::${name} の測定に失敗しました：${String(e.message).slice(0, 200)}`);
    }
  }
  if (!runs.length) continue;
  const a = (lr, id) => lr.audits[id];
  const med = (f) => { const v = runs.map(f).filter(Number.isFinite).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  const lr = runs.sort((x, y) => x.categories.performance.score - y.categories.performance.score)[Math.floor(runs.length / 2)];
  const line = {
    name,
    perf: Math.round(med((r) => r.categories.performance.score) * 100),
    a11y: Math.round(lr.categories.accessibility.score * 100),
    bp: Math.round(lr.categories['best-practices'].score * 100),
    seo: Math.round(lr.categories.seo.score * 100),
    fcp: Math.round(med((r) => a(r, 'first-contentful-paint').numericValue)),
    lcp: Math.round(med((r) => a(r, 'largest-contentful-paint').numericValue)),
    tbt: Math.round(med((r) => a(r, 'total-blocking-time').numericValue)),
    cls: Number(med((r) => a(r, 'cumulative-layout-shift').numericValue).toFixed(3)),
    si: Math.round(med((r) => a(r, 'speed-index').numericValue)),
  };
  rows.push(line);
  const detail = [
    `${name}（${url}）3回の中央値：性能${line.perf}・FCP ${line.fcp}ms・LCP ${line.lcp}ms・TBT ${line.tbt}ms・CLS ${line.cls}・SI ${line.si}ms／アクセシビリティ${line.a11y}・ベストプラクティス${line.bp}・SEO${line.seo}`,
    `LCP の要素：${JSON.stringify(a(lr, 'largest-contentful-paint-element')?.details?.items?.[0]?.items?.[0]?.node?.snippet || a(lr, 'largest-contentful-paint-element')?.details?.items?.[0]?.node?.snippet || '').slice(0, 200)}`,
    `表示を止めるファイル：${(a(lr, 'render-blocking-resources')?.details?.items || []).map((x) => `${x.url.replace(/^https?:\/\/[^/]+/, '')}（${Math.round(x.wastedMs)}ms）`).join('、') || 'なし'}`,
    `ずれ（CLS）の要素：${(a(lr, 'layout-shifts')?.details?.items || a(lr, 'layout-shift-elements')?.details?.items || []).slice(0, 4).map((x) => `${(x.node?.selector || x.node?.snippet || '').slice(0, 80)}=${Number(x.score ?? x.score)?.toFixed?.(3)}`).join('、') || 'なし'}`,
    `問題のある監査：${Object.values(lr.audits).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'manual' && x.scoreDisplayMode !== 'notApplicable').map((x) => `${x.id}(${x.score})`).join('、').slice(0, 1500)}`,
  ].join('\n');
  console.log(detail);
  console.log(`::notice title=${escProp(`lighthouse ${name}`)}::${esc(detail)}`);
}
console.log(`::notice title=lighthouse summary::${esc(rows.map((r) => `${r.name}: 性能${r.perf} FCP${r.fcp} LCP${r.lcp} TBT${r.tbt} CLS${r.cls} SI${r.si} A11y${r.a11y}`).join('\n'))}`);
