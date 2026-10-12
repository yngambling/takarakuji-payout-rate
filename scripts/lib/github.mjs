// GitHub の Issue を読む（watch.mjs 用）。GitHub Actions の外（手元）では何もしない。
import { LABEL, MARKER_RE } from './alerts.mjs';

/**
 * 閉じられた「自動チェック」の Issue の key（本文の目印）の一覧。最近更新された100件まで。
 * 運営者が Issue を閉じたこと＝「確認した」「もう知らせなくてよい」の合図として使う。
 * GITHUB_TOKEN がないとき（手元で動かしたとき）は null。
 */
export async function closedAlertKeys(env = process.env) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const res = await fetch(`${api}/repos/${repo}/issues?state=closed&labels=${encodeURIComponent(LABEL)}&sort=updated&direction=desc&per_page=100`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'takarakuji-kitaichi' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const keys = new Set();
  for (const issue of await res.json()) {
    if (issue.pull_request) continue;
    for (const m of String(issue.body || '').matchAll(MARKER_RE)) keys.add(m[1]);
  }
  return keys;
}
