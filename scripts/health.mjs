#!/usr/bin/env node
// サイトと自動更新の健康診断（毎回の更新で、データの取得のあとに実行）
//   ・公開中のサイトが開けるか、「最終更新」が古くなっていないか（公開が止まっていないか）
//   ・HTTPS の証明書・ドメインの期限が近づいていないか
//   ・外部タイマー（cron-job.org）からの実行が止まっていないか、タイマーのトークンの期限が近づいていないか
// 問題があれば「確認が必要なこと」に加える（notify.mjs が Issue にする）。どこかで失敗しても終了コードは 0。

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import tls from 'node:tls';
import { fetchBytes, decodeBytes } from './lib/http.mjs';
import { jstParts } from './lib/util.mjs';
import { loadAlerts, saveAlerts, raise, clear } from './lib/alerts.mjs';
import { closedAlertKeys } from './lib/github.mjs';
import { healthChecks, parseUpdated, rdapExpiry } from './lib/health.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (f, fb) => {
  try { return JSON.parse(await readFile(path.join(ROOT, f), 'utf8')); } catch { return fb; }
};
const lines = [];
const site = await readJson('config/site.json', {});
const base = String(site.baseUrl || '').replace(/\/$/, '');
const host = base ? new URL(base).host : '';
const custom = host && !/\.github\.io$/.test(host) && !/example\.com$/.test(host);
const p = jstParts();
const today = p.iso;
const now = new Date().toISOString();

/** 証明書の期限（YYYY-MM-DD） */
function certValidTo(h) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: h, port: 443, servername: h, timeout: 15000 }, () => {
      const c = s.getPeerCertificate();
      s.end();
      if (!c?.valid_to) reject(new Error('証明書を読めません'));
      else resolve(new Date(c.valid_to).toISOString().slice(0, 10));
    });
    s.on('error', reject);
    s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
  });
}

/** 外部タイマーなどの「Run workflow」（workflow_dispatch）の実行の数と、最後の実行の日時 */
async function dispatchRuns() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const res = await fetch(`${api}/repos/${repo}/actions/workflows/update.yml/runs?event=workflow_dispatch&per_page=1`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'takarakuji-kitaichi' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const j = await res.json();
  return { count: j.total_count || 0, last: j.workflow_runs?.[0]?.created_at || null };
}

const input = { now, today, base, site: null, cert: null, domain: null, timer: null, tokenExpires: site.timerTokenExpires || '' };
if (base.startsWith('https://')) {
  try {
    const { buf, contentType } = await fetchBytes(`${base}/?health=${Date.now()}`, { tries: 2, timeoutMs: 20000 });
    const updated = parseUpdated(decodeBytes(buf, contentType));
    input.site = { ok: true, updated };
    lines.push(`公開中のサイト：開けました（最終更新 ${updated ? updated.slice(0, 16).replace('T', ' ') : '不明'}）`);
  } catch (e) {
    input.site = { ok: false, error: String(e.message || e) };
    lines.push(`⚠ 公開中のサイトを開けませんでした：${input.site.error}`);
  }
}
if (custom) {
  try {
    input.cert = { validTo: await certValidTo(host) };
    lines.push(`HTTPS の証明書：${input.cert.validTo} まで`);
  } catch (e) {
    lines.push(`証明書の期限を確認できませんでした（${e.message || e}）`);
  }
  try {
    const { buf } = await fetchBytes(`https://rdap.org/domain/${host}`, { tries: 2, timeoutMs: 20000 });
    const expires = rdapExpiry(JSON.parse(buf.toString('utf8')));
    if (expires) { input.domain = { expires }; lines.push(`ドメイン：${expires} まで`); }
  } catch (e) {
    lines.push(`ドメインの期限を確認できませんでした（${e.message || e}）`);
  }
}
try {
  input.timer = await dispatchRuns();
  if (input.timer) lines.push(`外部タイマー：最後の実行 ${input.timer.last || 'なし'}（UTC）`);
} catch (e) {
  lines.push(`外部タイマーの実行を確認できませんでした（${e.message || e}）`);
}

try {
  const items = healthChecks(input);
  // 期限のお知らせ（ドメイン・トークン）は、Issue を閉じたら同じ期限については知らせない
  let closed = null;
  if (items.some((c) => c.type === 'raise' && /^(domain-expiry|timer-token)-/.test(c.key))) closed = await closedAlertKeys().catch(() => null);
  const alerts = await loadAlerts();
  for (const c of items) {
    if (c.type === 'clear') { clear(alerts, c.key); continue; }
    if (closed?.has(c.key) && /^(domain-expiry|timer-token)-/.test(c.key)) continue;
    raise(alerts, c.key, c.title, c.body);
    lines.push(`⚠ ${c.title}`);
  }
  await saveAlerts(alerts);
} catch (e) {
  lines.push(`⚠ 健康診断に失敗しました：${e.message || e}`);
}

for (const l of lines) console.log(l);
if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `### サイトと自動更新の健康診断\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`, { flag: 'a' }).catch(() => {});
}
