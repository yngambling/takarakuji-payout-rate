// Google Search Console の自動チェック（watch.mjs が1日1回使う）
//   ・サイトマップが送信されているか・エラーがないか（送信されていなければ送る。7日以上読まれていなければ送り直す）
//   ・サイトマップの各ページが Google に登録（インデックス）されているか。robots.txt・noindex・404・サーバーエラーなどの問題を見つけたら知らせる
// 使うには、サービス アカウントの JSON キーを GitHub の Secrets の GSC_CREDENTIALS に入れる（README「Search Console の自動チェック」）。
// 検索での表示回数・クリック数は、公開リポジトリに残さないため取得しない。

import { createSign } from 'node:crypto';
import { HOW_TO_FIX } from './alerts.mjs';

export const SCOPE = 'https://www.googleapis.com/auth/webmasters';
const API = 'https://www.googleapis.com/webmasters/v3';
const INSPECT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
/** サイトマップが何日読まれていなければ送り直すか */
export const RESUBMIT_DAYS = 7;

/** GSC_CREDENTIALS（サービス アカウントの JSON キー）を読む。形が違えば null */
export function readCredentials(text) {
  try {
    const c = JSON.parse(String(text || ''));
    return c?.client_email && c?.private_key ? c : null;
  } catch {
    return null;
  }
}

/** サービス アカウントの JWT を作る（RS256） */
export function signedJwt(cred, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: cred.client_email, scope: SCOPE, aud: cred.token_uri || 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(cred.private_key).toString('base64url');
  return `${unsigned}.${sig}`;
}

/** Search Console の API を呼ぶための小さな道具 */
export function gscClient(cred, { fetchImpl = fetch } = {}) {
  let token = null;
  const call = async (method, url, body) => {
    if (!token) {
      const res = await fetchImpl(cred.token_uri || 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedJwt(cred) }).toString(),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw Object.assign(new Error(`Google のログインに失敗しました（HTTP ${res.status}）`), { status: res.status, auth: res.status >= 400 && res.status < 500 });
      token = (await res.json()).access_token;
    }
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw Object.assign(new Error(`Search Console の API で失敗しました（HTTP ${res.status}）${(await res.text()).slice(0, 200)}`), { status: res.status, auth: res.status === 401 || res.status === 403 });
    return res.status === 204 ? null : res.json().catch(() => null);
  };
  const enc = encodeURIComponent;
  return {
    sitemaps: (site) => call('GET', `${API}/sites/${enc(site)}/sitemaps`).then((j) => j?.sitemap || []),
    submit: (site, feed) => call('PUT', `${API}/sites/${enc(site)}/sitemaps/${enc(feed)}`),
    inspect: (site, url) => call('POST', INSPECT, { inspectionUrl: url, siteUrl: site, languageCode: 'ja' }).then((j) => j?.inspectionResult?.indexStatusResult || {}),
  };
}

/** sitemap.xml の中の URL */
export const sitemapUrls = (xml) => [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

const FETCH_PROBLEM = {
  SOFT_404: '中身のないページ（ソフト404）と判断されています',
  NOT_FOUND: 'ページが見つかりません（404）',
  SERVER_ERROR: 'サーバーエラー（5xx）',
  REDIRECT_ERROR: '転送（リダイレクト）のエラー',
  ACCESS_DENIED: 'アクセスが拒否されました（401）',
  ACCESS_FORBIDDEN: 'アクセスが禁止されています（403）',
  BLOCKED_4XX: 'そのほかの 4xx エラー',
  BLOCKED_ROBOTS_TXT: 'robots.txt でブロックされています',
  INVALID_URL: 'URL の形が正しくありません',
};
const INDEX_PROBLEM = {
  BLOCKED_BY_META_TAG: 'noindex のタグで登録が止められています',
  BLOCKED_BY_HTTP_HEADER: 'HTTP ヘッダーの noindex で登録が止められています',
  BLOCKED_BY_ROBOTS_TXT: 'robots.txt で登録が止められています',
};

/**
 * URL 検査の結果 → { status: 'indexed' | 'waiting' | 'problem', reason }
 *   indexed … 登録されている（verdict PASS）
 *   waiting … まだ登録されていない（見つかったが未登録など。新しいサイトでは数日〜数週間かかるので、知らせない）
 *   problem … 直す必要があるもの（robots.txt・noindex・404・サーバーエラーなど）
 */
export function judgePage(r = {}) {
  if (r.robotsTxtState === 'DISALLOWED') return { status: 'problem', reason: 'robots.txt でブロックされています' };
  if (INDEX_PROBLEM[r.indexingState]) return { status: 'problem', reason: INDEX_PROBLEM[r.indexingState] };
  if (FETCH_PROBLEM[r.pageFetchState]) return { status: 'problem', reason: FETCH_PROBLEM[r.pageFetchState] };
  if (r.verdict === 'PASS') return { status: 'indexed', reason: r.coverageState || '' };
  return { status: 'waiting', reason: r.coverageState || '' };
}

/**
 * 結果から、知らせること・閉じることを決める
 *   sitemap … Search Console に登録されたこのサイトのサイトマップ（なければ null）
 *   pages   … [{ url, status, reason }]
 *   error   … ログインや API の失敗（{ message, auth }）
 */
export function gscChecks({ base, site, sitemap = null, pages = [], error = null }) {
  const out = [];
  const raise = (key, title, body) => out.push({ type: 'raise', key, title, body });
  const clear = (key) => out.push({ type: 'clear', key });
  if (error) {
    if (error.auth) {
      raise('gsc-auth', '【要確認】Search Console の自動チェックにログインできません', [
        `Search Console の自動チェックで、Google へのログインか、プロパティ（${site}）の読み取りに失敗しました。`,
        '',
        `- エラー：${error.message}`,
        '',
        '### やること',
        '1. Search Console の **設定 → ユーザーと権限** に、サービス アカウントのメールアドレス（`…@….iam.gserviceaccount.com`）が「フル」の権限で入っているか確認します。',
        '2. Google Cloud で、そのプロジェクトの「Google Search Console API」が有効になっているか確認します。',
        '3. キーを作り直したときは、GitHub の **Settings → Secrets and variables → Actions** の `GSC_CREDENTIALS` を新しいキーの中身に書き換えます。',
        '4. ログインできるようになると、この Issue は自動で閉じます。',
        '',
        HOW_TO_FIX,
      ].join('\n'));
    }
    return out;
  }
  clear('gsc-auth');
  const errs = Number(sitemap?.errors || 0);
  if (sitemap && errs > 0) {
    raise('gsc-sitemap', `【要確認】Search Console でサイトマップのエラーが${errs}件あります`, [
      `Search Console が、サイトマップ（${sitemap.path}）にエラーがあると報告しています。`,
      '',
      `- エラー：${errs}件／警告：${Number(sitemap.warnings || 0)}件`,
      `- 最後に読み込まれた日時：${sitemap.lastDownloaded || '不明'}`,
      '',
      '### やること',
      '1. [Search Console](https://search.google.com/search-console) の左のメニューの **サイトマップ** を開き、`sitemap.xml` を押してエラーの内容を見ます。',
      '2. この Issue とエラーの内容を Claude に見せて「直して」と頼んでください。エラーがなくなると、この Issue は自動で閉じます。',
      '',
      HOW_TO_FIX,
    ].join('\n'));
  } else if (sitemap) clear('gsc-sitemap');
  const bad = pages.filter((p) => p.status === 'problem');
  if (bad.length) {
    raise('gsc-pages', `【要確認】Google に登録できないページが${bad.length}件あります`, [
      'Search Console の URL 検査で、Google に登録（インデックス）できない理由が見つかったページがあります。',
      '',
      ...bad.slice(0, 20).map((p) => `- ${p.url.replace(base, '') || '/'}：${p.reason}`),
      '',
      '### やること',
      '1. この Issue を Claude に見せて「直して」と頼んでください（robots.txt・noindex・リンク切れなどを直します）。',
      `2. 直したら、[Search Console](https://search.google.com/search-console) の上の検索欄にページの URL を入れて「インデックス登録をリクエスト」を押すと、早く見直してもらえます。`,
      '3. 問題がなくなると、この Issue は自動で閉じます。',
      '',
      HOW_TO_FIX,
    ].join('\n'));
  } else if (pages.length) clear('gsc-pages');
  return out;
}

/**
 * data/watch.json に残す記録：登録済みのページ数と、まだ登録されていないページの一覧（パスと Google の説明だけ）。
 * 一覧を見て、急ぐページから Search Console の画面で「インデックス登録をリクエスト」を押す。
 * 検索での表示回数・クリック数は、公開リポジトリに残さないため、ここにも入れない
 */
export function gscSummary(pages = [], today = '') {
  const pathOf = (u) => {
    try { return new URL(u).pathname; } catch { return String(u); }
  };
  return {
    checkedAt: today,
    indexed: pages.filter((p) => p.status === 'indexed').length,
    total: pages.length,
    notIndexed: pages.filter((p) => p.status !== 'indexed').map((p) => ({ path: pathOf(p.url), status: p.status, reason: p.reason || '' })),
  };
}

/** サイトマップを送る（送り直す）かどうか */
export function needSubmit(sitemap, today) {
  if (!sitemap) return true;
  if (sitemap.isPending) return false;
  const last = String(sitemap.lastDownloaded || '').slice(0, 10);
  if (!last) return true;
  return (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000 > RESUBMIT_DAYS;
}
