// IndexNow（Bing などの検索エンジンに、内容が変わったページを知らせる仕組み）で使う、通信しない部分
//   ・ページごとに本文のハッシュを取り、「内容が最後に変わった日時」を data/pages.json に残す（sitemap.xml の lastmod にも使う）
//   ・1日1回（日本時間の朝6時以降の最初の更新）、前回送ったあとに内容が変わったページだけを選ぶ
import { createHash } from 'node:crypto';

export const ENDPOINT = 'https://api.indexnow.org/indexnow';
export const FROM_HOUR = 6;

/** キーは英数字とハイフンで8〜128文字（IndexNow の決まり） */
export const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9-]{8,128}$/.test(k);

/**
 * ページの内容のハッシュ。<title> と本文（<main>の中）だけを見て、サイドバーや速報帯は見ない。
 * 「最終更新 〇時〇分」や取得時刻のように、更新のたびに変わるだけの時刻は除く（内容が変わっていないページを送らないため）
 */
export function contentHash(html) {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const main = ((html.match(/<main id="main">([\s\S]*?)<\/main>/) || [])[1] ?? html)
    .replace(/<p class="updated">[\s\S]*?<\/p>/g, '')
    .replace(/\d{1,2}:\d{2}/g, '');
  return createHash('sha256').update(`${title}\n${main}`).digest('hex').slice(0, 16);
}

/** ページごとのハッシュを前回と比べ、変わったページだけ changed（日時）を今にする。なくなったページは消す */
export function trackPages(prev = {}, pages, nowIso) {
  const out = {};
  for (const { path, hash } of pages) {
    const old = prev[path];
    out[path] = old && old.hash === hash ? old : { hash, changed: nowIso };
  }
  return out;
}

/** 前回選んだとき（sinceIso）より後に内容が変わったページ。初めてのときは全部 */
export function changedSince(tracked = {}, sinceIso = null) {
  return Object.entries(tracked).filter(([, v]) => !sinceIso || String(v.changed) > sinceIso).map(([p]) => p);
}

/** 今日もう選んだか・朝6時より前か（手動の指定なら必ず選ぶ） */
export function dueToday({ today, hh, lastRun = null, force = false }) {
  if (force) return { due: true, reason: '手動の指定により、送るページを選びます' };
  if (lastRun && lastRun >= today) return { due: false, reason: `今日（${today}）の分は選び済みです（1日1回）` };
  if (hh < FROM_HOUR) return { due: false, reason: `日本時間の${FROM_HOUR}時より前なので、${FROM_HOUR}時以降の最初の更新で選びます` };
  return { due: true, reason: '' };
}

export const pageUrl = (base, path) => `${base}/${path === 'index.html' ? '' : path}`;

/** IndexNow に送る内容（複数のURLをまとめて送る形） */
export function payload({ base, key, urls }) {
  return { host: new URL(base).host, key, keyLocation: `${base}/${key}.txt`, urlList: urls };
}

/** 設定を直さないと続けて失敗する応答（形式・キー・URL の誤り）。429（送りすぎ）や通信の失敗は、次の日にまた送るだけ */
export const isConfigError = (status) => [400, 403, 422].includes(status);

/** 設定の誤りで送れなかったときの Issue */
export function indexNowIssue(status, detail, base, key) {
  return {
    title: `【要確認】検索エンジンへの通知（IndexNow）が受け付けられませんでした（HTTP ${status}）`,
    body: [
      `内容が変わったページを Bing などに知らせる IndexNow で、「${statusText(status)}」と返されました。設定を直すまで、毎日の通知は受け付けられません（サイトの表示や Google には影響しません）。`,
      '',
      `- 応答：HTTP ${status} ${detail || ''}`.trim(),
      `- キーのファイル：${base}/${key}.txt`,
      '',
      '### やること',
      `1. 上のキーのファイルを開いて、\`${key}\` と表示されるか確認します。表示されないときは、\`config/site.json\` の \`indexNowKey\` の書き方を確認します。`,
      '2. 表示されるのに続くときは、この Issue を Claude に見せて「直して」と頼んでください。止めたいときは `indexNowKey` を空（`""`）にします。',
      '3. 次に受け付けられると、この Issue は自動で閉じます。',
    ].join('\n'),
  };
}

/** 応答コードの意味（IndexNow の説明より） */
export function statusText(status) {
  return ({
    200: '送信しました',
    202: '受け付けられました（キーの確認待ち）',
    400: '送り方の形式が正しくありません',
    403: 'キーが正しくありません（キーのファイルが見つからないか、中身が違います）',
    422: 'このサイトのURLではないか、キーの形式が正しくありません',
    429: '送りすぎです（時間をおいて送ります）',
  })[status] || '送信できませんでした';
}
