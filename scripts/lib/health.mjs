// サイトと自動更新の健康診断（scripts/health.mjs が毎回の更新で使う、通信しない部分）
//   ・公開中のサイトが開けるか／「最終更新」が古くなっていないか（公開が止まっていないか）
//   ・HTTPS の証明書・ドメインの期限が近づいていないか
//   ・外部タイマー（cron-job.org）からの実行が止まっていないか／タイマーのトークンの期限が近づいていないか
// 戻り値は scheduleChecks と同じ形：[{ type: 'raise', key, title, body } | { type: 'clear', key }]

import { HOW_TO_FIX } from './alerts.mjs';

/** 「最終更新」が何時間より古ければ知らせるか（ふだんは1日5回更新。夜の間が最長8時間） */
export const STALE_HOURS = 20;
/** 外部タイマーからの実行が何時間なければ知らせるか（1回抜けても12時間。2回続けて抜けたら知らせる） */
export const TIMER_GAP_HOURS = 13;
/** 期限の何日前から知らせるか */
export const CERT_DAYS = 14;
export const DOMAIN_DAYS = 30;
export const TOKEN_DAYS = 30;

const pad = (n) => String(n).padStart(2, '0');
const hours = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
const days = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
const ymd = (iso) => `${+iso.slice(0, 4)}年${+iso.slice(5, 7)}月${+iso.slice(8, 10)}日`;

/** ページの「最終更新：2026年10月12日（月） 12:47」→ '2026-10-12T12:47:00+09:00'（見つからなければ null） */
export function parseUpdated(html) {
  const m = String(html).match(/最終更新[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9<]*?(\d{1,2}):(\d{2})/);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:00+09:00` : null;
}

/** RDAP（ドメインの登録情報）から有効期限の日付 */
export function rdapExpiry(json) {
  const ev = (json?.events || []).find((e) => /expiration/i.test(e.eventAction || ''));
  return ev?.eventDate ? new Date(ev.eventDate).toISOString().slice(0, 10) : null;
}

/**
 * 診断の結果から、知らせること・閉じることを決める
 *   now      … いまの日時（ISO）
 *   today    … 日本時間の今日（YYYY-MM-DD）
 *   site     … { ok, status, error, updated }（公開中のトップページ）
 *   cert     … { validTo } HTTPS の証明書の期限（YYYY-MM-DD）。調べられなければ null
 *   domain   … { expires } ドメインの有効期限（YYYY-MM-DD）。調べられなければ null
 *   timer    … { count, last }（外部タイマーなどの「Run workflow」の実行の数と、最後の実行の日時）。調べられなければ null
 *   tokenExpires … config/site.json の timerTokenExpires（YYYY-MM-DD）
 */
export function healthChecks({ now, today, base, site, cert = null, domain = null, timer = null, tokenExpires = '' }) {
  const out = [];
  const raise = (key, title, body) => out.push({ type: 'raise', key, title, body });
  const clear = (key) => out.push({ type: 'clear', key });

  // 公開中のサイト
  if (site && !site.ok) {
    raise('site-down', '【要確認】公開中のサイトが開けません', [
      `公開中のサイト（${base}/）を開けませんでした。読者にもサイトが表示されていない可能性があります。`,
      '',
      `- エラー：${site.error || `HTTP ${site.status}`}`,
      '',
      '### やること',
      `1. スマホやパソコンで ${base}/ を開いてみます。`,
      '2. 開けないときは、GitHub の **Settings → Pages** で「Your site is live at …」と出ているか、**Custom domain** に `takarakuji-kangen.com` が入っていて「DNS check successful」になっているかを確認します。',
      '3. ドメインの期限切れや DNS の設定の変更でも起きます（XServerアカウントの「ドメイン」と「DNSレコード設定」を確認します）。',
      '4. 開けるようになると、この Issue は自動で閉じます。',
      '',
      HOW_TO_FIX,
    ].join('\n'));
  } else if (site?.ok) {
    clear('site-down');
    const age = site.updated ? hours(site.updated, now) : null;
    if (age != null && age > STALE_HOURS) {
      raise('site-stale', `【要確認】公開中のサイトが${Math.floor(age)}時間更新されていません`, [
        `公開中のサイトの「最終更新」が ${site.updated.slice(0, 16).replace('T', ' ')} のままです。ふだんは1日5回更新されるので、自動更新か公開（GitHub Pages）が止まっている可能性があります。`,
        '',
        '### やること',
        '1. GitHub の **Actions** タブで、最近の「還元率を更新して公開」に赤い × が付いていないか見ます。付いていれば、それを開いて止まった手順を確認します。',
        '2. 実行そのものが少ないときは、外部タイマー（cron-job.org）が止まっていないかも確認します（「定時更新を時刻どおりに動かす」）。',
        '3. サイトが新しくなると、この Issue は自動で閉じます。',
        '',
        HOW_TO_FIX,
      ].join('\n'));
    } else if (age != null) clear('site-stale');
  }

  // HTTPS の証明書（GitHub Pages が自動で更新する。更新できないときに知らせる）
  if (cert?.validTo) {
    const left = days(today, cert.validTo);
    const key = `cert-expiry-${cert.validTo}`;
    if (left <= CERT_DAYS) {
      raise(key, `【要確認】サイトの HTTPS の証明書の期限が近づいています（${ymd(cert.validTo)}・あと${left}日）`, [
        `サイトの HTTPS の証明書は ${ymd(cert.validTo)} が期限です。ふだんは GitHub Pages が期限の前に自動で新しくしますが、まだ新しくなっていません。期限が切れると、ブラウザに「安全ではありません」と出てサイトが見られなくなります。`,
        '',
        '### やること',
        '1. GitHub の **Settings → Pages** で、**Custom domain** の下に「DNS check successful」と出ているか、**Enforce HTTPS** にチェックが入っているかを確認します。',
        '2. DNS の設定（XServerアカウントの「DNSレコード設定」の A・AAAA・CNAME）が README の表のとおりかを確認します。',
        '3. 新しい証明書になると、この Issue は自動で閉じます。',
        '',
        HOW_TO_FIX,
      ].join('\n'));
    } else clear(key);
  }

  // ドメインの有効期限（自動更新を設定していれば、期限の前に延びる）
  if (domain?.expires) {
    const left = days(today, domain.expires);
    const key = `domain-expiry-${domain.expires}`;
    if (left <= DOMAIN_DAYS) {
      raise(key, `【お願い】ドメインの有効期限が近づいています（${ymd(domain.expires)}・あと${left}日）`, [
        `サイトのドメイン（${new URL(base).host}）の有効期限は ${ymd(domain.expires)} です。期限が切れるとサイトが表示されなくなります。`,
        '',
        '### やること',
        '1. XServerアカウントにログインし、「ドメイン」で更新（または自動更新の設定）が済んでいるかを確認します。',
        '2. 更新すると、数日のうちに有効期限が延び、この Issue は自動で閉じます。自動更新を設定していて、期限の前に更新される予定なら、この Issue を閉じてもかまいません（同じ期限については、もう知らせません）。',
      ].join('\n'));
    } else clear(key);
  }

  // 外部タイマー（cron-job.org）からの実行
  if (timer && timer.count > 0 && timer.last) {
    const gap = hours(timer.last, now);
    if (gap > TIMER_GAP_HOURS) {
      raise('timer-stopped', `【要確認】外部タイマー（cron-job.org）からの定時更新が${Math.floor(gap)}時間ありません`, [
        `cron-job.org からの「Run workflow」の実行が、${timer.last.slice(0, 16).replace('T', ' ')}（UTC）から来ていません。GitHub の予約（予備）で更新は続いていますが、数時間遅れることがあります。`,
        '',
        '### やること',
        '1. [cron-job.org](https://console.cron-job.org/login) にログインし、左のメニューの **Cronjobs** で「宝くじ還元率の定時更新」が有効（Enabled）になっているかを確認します。',
        '2. ジョブの **History** で、最近の結果を見ます。**401** や **403** なら、トークンの期限切れか、貼り付けの誤りです（README「トークンの期限（1年）が近づいたら」の手順で作り直します）。',
        '3. 失敗が続いて止められた（disabled）ときは、原因を直してから **EDIT** でジョブを有効に戻し、**SAVE** を押します。',
        '4. cron-job.org からの実行が来ると、この Issue は自動で閉じます。',
        '',
        HOW_TO_FIX,
      ].join('\n'));
    } else clear('timer-stopped');
  }

  // 外部タイマーのトークンの期限（config/site.json の timerTokenExpires）
  if (/^\d{4}-\d{2}-\d{2}$/.test(tokenExpires || '')) {
    const left = days(today, tokenExpires);
    const key = `timer-token-${tokenExpires}`;
    if (left <= TOKEN_DAYS) {
      raise(key, `【お願い】外部タイマーのトークンの期限が近づいています（${ymd(tokenExpires)}・あと${left}日）`, [
        `cron-job.org が GitHub の自動更新を動かすためのトークン（合い鍵）は、${ymd(tokenExpires)} が期限です。期限が切れると、定時更新が GitHub の予約（数時間遅れることがある）だけになります。`,
        '',
        '### やること',
        '1. README の「定時更新を時刻どおりに動かす（外部タイマー）」の **1. GitHub でトークン（合い鍵）を作る** と同じ手順で、新しいトークンを作ります。',
        '2. cron-job.org の **Cronjobs** でジョブの **EDIT** を押し、**ADVANCED** タブの `Authorization` を `Bearer 新しいトークン` に書き換えて **SAVE** を押します。',
        `3. \`config/site.json\` の \`timerTokenExpires\` を、新しいトークンの期限（作成画面の Expiration に出る日付）に書き換えます。すると、この Issue は自動で閉じます。`,
        '4. 古いトークンは GitHub の **Settings → Developer settings → Personal access tokens → Fine-grained tokens** で削除します。',
      ].join('\n'));
    } else clear(key);
  }
  return out;
}
