// 「確認が必要なこと」を1回の実行の中で集めて、最後に notify.mjs が GitHub の Issue にする。
//   open … いま起きている問題（同じ key の Issue が開いていなければ新しく作る）
//   ok   … 問題がないと確認できた key（同じ key の Issue が開いていれば、自動で閉じる）
// ファイルは実行ごとの一時フォルダに置く（リポジトリには保存しない）。

import { readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const ALERT_FILE = process.env.ALERT_FILE || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'takarakuji-alerts.json');

export async function loadAlerts() {
  try {
    const a = JSON.parse(await readFile(ALERT_FILE, 'utf8'));
    return { open: a.open || [], ok: a.ok || [] };
  } catch {
    return { open: [], ok: [] };
  }
}

export const saveAlerts = (a) => writeFile(ALERT_FILE, JSON.stringify(a, null, 1), 'utf8');
export const clearAlertFile = () => rm(ALERT_FILE, { force: true });

/** 問題あり。title は Issue の題名、body は本文（Markdown） */
export function raise(a, key, title, body) {
  a.open = a.open.filter((x) => x.key !== key);
  a.open.push({ key, title, body });
  a.ok = a.ok.filter((k) => k !== key);
}

/** 問題なし（同じ key の Issue が開いていれば閉じる） */
export function clear(a, key) {
  if (a.open.some((x) => x.key === key)) return;
  if (!a.ok.includes(key)) a.ok.push(key);
}

/** Issue の本文の最後に付ける、直し方の共通の案内 */
export const HOW_TO_FIX = [
  '### 直し方が分からないとき',
  'このページの内容（題名と本文）をそのままコピーして、Claude に「これを直して」と頼んでください。修正したファイルを受け取ったら、GitHub の画面でファイルを開き、鉛筆のマークから貼り付けて保存（Commit changes）すれば反映されます。',
].join('\n');
