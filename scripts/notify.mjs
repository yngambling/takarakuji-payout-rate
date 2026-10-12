#!/usr/bin/env node
// 1回の実行で集めた「確認が必要なこと」を、GitHub の Issue にしてお知らせする。
//   ・同じ内容の Issue が開いていれば、新しくは作らない（毎回同じ通知が届かないように）
//   ・問題が解消した項目は、開いている Issue にコメントを付けて自動で閉じる
//   ・Issue は運営者を @メンションするので、GitHub の通知（メール）が届く
// GitHub の外（手元）で動かしたときは、内容を表示するだけ。失敗しても終了コードは 0。

import { appendFile } from 'node:fs/promises';
import { loadAlerts, clearAlertFile, raise, clear, LABEL, marker } from './lib/alerts.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const owner = process.env.GITHUB_REPOSITORY_OWNER || String(repo || '').split('/')[0];
const runUrl = process.env.GITHUB_SERVER_URL && repo && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';

const alerts = await loadAlerts();

// 自動更新そのものが途中で止まったとき（計算の確認やページの生成で失敗したなど）
if (process.env.JOB_STATUS === 'failure') {
  raise(alerts, 'run-failed', '【要確認】サイトの自動更新が途中で止まりました', [
    'サイトの自動更新が、途中でエラーになって止まりました。公開中のサイトは、前回の更新のまま表示されています。',
    '',
    runUrl ? `- 実行の記録：${runUrl}` : null,
    '',
    '### やること',
    '1. 上の「実行の記録」を開き、赤い × が付いた手順をクリックして、エラーの内容を見ます。',
    '2. 「計算の確認」で止まっている場合は、取得したデータか設定ファイルの書き方に問題がある可能性があります。直前に自分で編集したファイルがあれば、書き方（カンマや括弧）を確認してください。',
    '3. 次の更新が成功すると、この Issue は自動で閉じます。',
    '',
    '### 直し方が分からないとき',
    'エラーの内容と、この Issue の題名をそのままコピーして、Claude に「これを直して」と頼んでください。',
  ].filter((x) => x !== null).join('\n'));
} else if (process.env.JOB_STATUS === 'success') {
  clear(alerts, 'run-failed');
}

// 公開（GitHub Pages への deploy）の結果。公開のジョブの最後に DEPLOY_STATUS を付けて呼ぶ
if (process.env.DEPLOY_STATUS === 'failure') {
  raise(alerts, 'deploy-failed', '【要確認】サイトの公開（GitHub Pages）に失敗しました', [
    'データの取得とページの生成はできましたが、GitHub Pages への公開で失敗しました。公開中のサイトは、前回の公開のまま表示されています。',
    '',
    runUrl ? `- 実行の記録：${runUrl}` : null,
    '',
    '### やること',
    '1. 上の「実行の記録」を開き、「deploy」の赤い × の手順でエラーの内容を見ます。',
    '2. 「Settings → Pages」の **Source** が「GitHub Actions」のままか確認します。',
    '3. GitHub 側の一時的な不具合のことも多く、次の更新で公開できると、この Issue は自動で閉じます（[GitHub の稼働状況](https://www.githubstatus.com/) で Pages や Actions の障害も確認できます）。',
    '',
    '### 直し方が分からないとき',
    'エラーの内容と、この Issue の題名をそのままコピーして、Claude に「これを直して」と頼んでください。',
  ].filter((x) => x !== null).join('\n'));
} else if (process.env.DEPLOY_STATUS === 'success') {
  clear(alerts, 'deploy-failed');
}

const summary = [];
const log = (s) => { summary.push(s); console.log(s); };

async function gh(method, p, body) {
  const res = await fetch(`${api}${p}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'takarakuji-kitaichi',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new Error(`GitHub API ${method} ${p} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

async function openIssues() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const list = await gh('GET', `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100&page=${page}`);
    if (!list?.length) break;
    all.push(...list.filter((i) => !i.pull_request));
    if (list.length < 100) break;
  }
  return all;
}

try {
  if (!token || !repo) {
    log(alerts.open.length
      ? `確認が必要なこと（GitHub の外で動かしているので Issue は作りません）：\n${alerts.open.map((a) => `  - ${a.title}`).join('\n')}`
      : '確認が必要なことはありません。');
  } else {
    if (alerts.open.length || alerts.ok.length) {
      if (!(await gh('GET', `/repos/${repo}/labels/${encodeURIComponent(LABEL)}`))) {
        await gh('POST', `/repos/${repo}/labels`, { name: LABEL, color: 'd7000f', description: 'サイトの自動チェックで見つかった、確認が必要なこと' });
      }
    }
    const issues = alerts.open.length || alerts.ok.length ? await openIssues() : [];
    const find = (key) => issues.find((i) => String(i.body || '').includes(marker(key)));
    for (const a of alerts.open) {
      const have = find(a.key);
      if (have) { log(`通知済み（#${have.number}）：${a.title}`); continue; }
      const body = `${a.body}\n\n---\n@${owner} 自動チェックで見つかりました。${runUrl ? `（[実行の記録](${runUrl})）` : ''}\n${marker(a.key)}`;
      const created = await gh('POST', `/repos/${repo}/issues`, { title: a.title, body, labels: [LABEL] });
      log(`⚠ 新しく通知しました（#${created.number}）：${a.title}`);
    }
    for (const key of alerts.ok) {
      const have = find(key);
      if (!have) continue;
      await gh('POST', `/repos/${repo}/issues/${have.number}/comments`, { body: alerts.notes?.[key] || '自動チェックで、問題が解消したことを確認しました。この Issue を閉じます。' });
      await gh('PATCH', `/repos/${repo}/issues/${have.number}`, { state: 'closed', state_reason: 'completed' });
      log(`解消したので閉じました（#${have.number}）：${have.title}`);
    }
    if (!summary.length) log('確認が必要なことはありません。');
  }
} catch (e) {
  console.log(`::warning::通知（Issue の作成）に失敗しました：${e.message || e}`);
  summary.push(`⚠ 通知（Issue の作成）に失敗しました：${e.message || e}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### 通知\n\n${summary.map((s) => `- ${s.replace(/\n/g, ' ')}`).join('\n')}\n`).catch(() => {});
}
await clearAlertFile();
