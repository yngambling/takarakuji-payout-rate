// 公式ページの見張り（watch.mjs）で使う、通信しない部分
import { createHash } from 'node:crypto';
import { htmlToText } from './parse.mjs';
import { HOW_TO_FIX } from './alerts.mjs';
import { fmtShort, yenJa } from './util.mjs';
import { weekWith7, knownRounds, specialOf, payoutVerdict, ruleVerdict, addDaysIso } from './special.mjs';

/**
 * お知らせ・キャンペーン・申し込み特典の行。ポイント・支払い方法・購入場所のページでは、比べる行から外す。
 * 入れ替わりが多く、率や購入場所とは関係しないため（2026年10月までの「内容が変わりました」の Issue は、すべてお知らせやキャンペーンの行の入れ替えか、1日だけのメンテナンス中の表示だった）。
 * 「ご利用いただけません」「メンテナンス」は、支払い方法の決まり（家族カードは使えない など）にも出てくるので外さない（1日だけの表示は、次の日も変わったままかで見分ける）
 */
export const NOTICE_RE = /キャンペーン|エントリー|もれなく|山分け|抽せんで|抽選で|プレゼント|期間限定|混み合|繋がりにくい|つながりにくい|ご迷惑|お申し?込みで|ご入会で|新規入会/;
const NOTICE_KINDS = new Set(['point', 'pay', 'shop']);
/** 前に記録した行にも、同じ決まりを当てる（決まりを変えたときに、外した行だけの違いで知らせないため） */
export const watchedLines = (page, lines = []) => (NOTICE_KINDS.has(page.kind) ? lines.filter((l) => !NOTICE_RE.test(l)) : lines);

const DATE_RE = /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*[(（][^)）]{1,3}[)）])?|\d{4}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}:\d{2}/g;

/**
 * ページの中から、見張る行だけを取り出す。
 *   keywords のどれかを含む行（digit が true なら、さらに数字を含む行）
 *   ポイント・支払い・購入場所・ルールのページは、日付や時刻を消してから比べる（「更新日」だけの変化で知らせないため）
 *   ルールのページ（kind: rule）は、長い注意書きを「※」ごとに分け、年（「2026年に発生した…」）も消す。
 *   行の頭の「キャリーオーバー有」の印も消す（数字を選ぶ宝くじのページで、キャリーオーバーのある回だけに出ると考えられるため。
 *   BIG・DUNK の「キャリーオーバーあり 1等 最高」はルールの説明なので残す）
 *   同じ行が何度出てきても残す（BIG と 100円BIG の確率のように、同じ行が別のくじにあるため）
 */
export function extractLines(html, page) {
  const text = htmlToText(html);
  const rule = page.kind === 'rule';
  const notice = NOTICE_KINDS.has(page.kind);
  const max = rule ? 250 : 80;
  const keep = [];
  for (const raw of text.split('\n')) {
    for (let line of rule ? raw.split(/(?=※)/) : [raw]) {
      line = line.replace(/\s+/g, ' ').trim();
      if (!line || line.length > 300) continue;
      if (!(page.keywords || []).some((k) => line.includes(k))) continue;
      if (page.digit && !/\d/.test(line)) continue;
      line = line.replace(/(?:あと|残り)\s*\d+\s*(?:日|時間|分)/g, '');
      if (page.kind !== 'jumbo') line = line.replace(DATE_RE, '');
      if (rule) line = line.replace(/\d{4}\s*年(?!\s*\d{1,2}\s*月)/g, '').replace(/^キャリーオーバー[有無]\s*/, '');
      line = line.replace(/\s+/g, ' ').trim();
      if (notice && NOTICE_RE.test(line)) continue; // お知らせ・キャンペーンの行は比べない
      if (line && (rule || !keep.includes(line))) keep.push(line);
      if (keep.length >= max) return keep;
    }
  }
  return keep;
}

export const hashLines = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);

/** ページの題名（<title>） */
export const pageTitle = (html) => htmlToText((String(html ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();

/**
 * 「ページが見つかりません」のページか。
 * 宝くじ公式サイトは、ないページにも「NOT FOUND【宝くじ公式サイト】」のページを正常な応答（HTTP 200）で返すため、
 * 題名と本文で見分ける（見分けないと「見張る行が見つからない」として3日後まで気付けない）。
 */
const MISSING_BODY = /お探しのページ(?:は|が)見つかりません|指定されたページ(?:は|が)(?:見つかりません|存在しません)/;
export function pageMissing(html) {
  const title = pageTitle(html);
  if (/NOT\s*FOUND|(?:^|[^\d])404(?:[^\d]|$)|ページが見つかりません|ページがみつかりません/i.test(title)) return true;
  return MISSING_BODY.test(htmlToText(html));
}

export function diffLines(before = [], after = []) {
  const b = new Set(before);
  const a = new Set(after);
  return { removed: before.filter((l) => !a.has(l)), added: after.filter((l) => !b.has(l)) };
}

/**
 * 今回の実行で見張りを行うかどうか。
 * 自動更新は外部のタイマー（cron-job.org）と GitHub の予約の両方から1日に何回も動くので、
 * 見張りは1日1回だけ、日本時間の朝6時以降の最初の更新で行う（「3日続けて開けない」を日数で数えるため）。
 *   lastRun … 前に見張りをした日（data/watch.json の lastRun）
 *   force   … 手動の実行で「公式ページの見張りも今すぐ行う」を選んだとき
 */
export const WATCH_FROM_HOUR = 6;
export function watchGate({ today, hh, lastRun = null, force = false }) {
  if (force) return { run: true, reason: '手動の指定により、公式ページの見張りを行います' };
  if (lastRun && lastRun >= today) return { run: false, reason: `今日（${today}）の公式ページの見張りは済んでいます（1日1回）` };
  if (hh < WATCH_FROM_HOUR) return { run: false, reason: `日本時間の${WATCH_FROM_HOUR}時より前なので、公式ページの見張りは${WATCH_FROM_HOUR}時以降の最初の更新で行います` };
  return { run: true, reason: '' };
}

const KIND_TEXT = { point: 'ポイントの率', pay: '支払い方法', shop: '購入場所', jumbo: 'ジャンボ宝くじの発売', rule: 'くじのルール（1口の値段・賞金・当せん確率・1等の上限）' };

export function changeIssue(page, before, after, today, { merged = 0 } = {}) {
  const { removed, added } = diffLines(before, after);
  const list = (xs) => (xs.length ? xs.slice(0, 15).map((l) => `- ${l}`).join('\n') + (xs.length > 15 ? `\n- ほか${xs.length - 15}行` : '') : '- （なし）');
  return {
    key: `watch-${page.id}-${today}`,
    title: `【確認のお願い】${page.name}の内容が変わりました`,
    body: [
      `毎日の自動チェックで、次の公式ページの「${KIND_TEXT[page.kind] || page.kind}」に関係する部分が変わりました（次の日の見張りでも、変わったままでした）。サイトの表示は、まだ何も変えていません。`,
      merged ? `同じページのまだ閉じていない Issue（${merged}件）は、この Issue にまとめて閉じました。下の行は、最初の変化の前の内容と比べたものです。` : null,
      '',
      `- ページ：[${page.name}](${page.url})`,
      `- 見直すファイル：\`${page.file}\`（${page.what}）`,
      '',
      '#### なくなった行',
      list(removed),
      '',
      '#### 増えた行',
      list(added),
      '',
      '### やること',
      '1. 上のページを開いて、何が変わったかを確認します。',
      `2. ${page.what}が変わっていたら、\`${page.file}\` を直します（GitHub でファイルを開き、鉛筆のマークから編集して保存）。言い回しやキャンペーンの入れ替えだけなら、何もせずにこの Issue を閉じてください。`,
      page.kind === 'point' || page.kind === 'pay' ? '3. ポイントを直したときは、`config/points.json` の `checkedOn` を今日の日付にします。' : null,
      page.kind === 'jumbo' ? '3. 新しいジャンボの賞金表が発表されていたら、`data/games.json` に追加します（ふつうは公式発表から自動で登録されます。README の「新しいジャンボ宝くじ」）。' : null,
      page.kind === 'rule' ? '3. ルールの変更は、還元率の計算に直接ひびきます。賞金・確率・配分・上限・値段が変わっていたら、この Issue を Claude に見せて「直して」と頼んでください（`data/games.json` の `tiers`・`price`・`capNormal`・`capCO` などを直します）。変わる日（「第〇回から」など）が書かれていれば、その日に合わせて直します。' : null,
      '',
      HOW_TO_FIX,
    ].filter((x) => x !== null).join('\n'),
  };
}

/** 公式サイトが「ページが見つかりません」のページを返したときのエラー（その日のうちに知らせる） */
export const MISSING_ERROR = 'ページが見つかりません（公式サイトが「NOT FOUND」のページを返しました）';

/**
 * 公式ページを見張れないときのお知らせ。
 *   「ページが見つかりません」（missing）はその日のうちに、開けない・見張る行がないは3日続いたら知らせる（watch.mjs）
 */
export function downIssue(page, error, fails, { missing = false } = {}) {
  const layout = !missing && /見張る行/.test(String(error));
  if (!missing && isBlocked(error)) return blockedIssue(page, error, fails);
  return {
    key: `watchdown-${page.id}`,
    title: missing ? `【確認のお願い】${page.name}が見つかりません（URL が変わった可能性）`
      : layout ? `【確認のお願い】${page.name}の作りが変わった可能性があります` : `【確認のお願い】${page.name}を開けません`,
    body: [
      missing
        ? `毎日の自動チェックで次の公式ページを開くと、「ページが見つかりません（NOT FOUND）」と表示されました。ページのURLが変わったか、なくなった可能性があります。直すまで、このページの見張りは止まっています。`
        : layout
        ? `毎日の自動チェックで、次の公式ページから${fails}日続けて、見張る行（${(page.keywords || []).join('・')}を含む行）が見つかりませんでした。ページの作りや言葉が変わったか、別のページに移った可能性があります。`
        : `毎日の自動チェックで、次の公式ページを${fails}日続けて開けませんでした。ページのURLが変わったか、なくなった可能性があります。`,
      '',
      `- ページ：[${page.name}](${page.url})`,
      `- エラー：${error}`,
      '',
      '### やること',
      `1. 公式サイトで同じ内容のページを探し、新しいURLを \`config/watch.json\` の \`${page.id}\` の \`url\` に入れます（言葉が変わっただけなら \`keywords\` を直します）。`,
      `2. ページがなくなっていたら、\`${page.file}\` の内容（${page.what}）がまだ正しいかを確認し、\`config/watch.json\` からこの項目を消します。`,
      '3. 開けるようになると、この Issue は自動で閉じます。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

/**
 * 公式サイトが、自動のアクセスを断ったとき（HTTP 401・403・429）。ページはあるので「URL が変わった」とは書かず、
 * 断られる日が続いたとき（BLOCKED_DAYS 日）だけ知らせる。開けるようになると自動で閉じる
 */
export const isBlocked = (error) => /HTTP (?:401|403|429)\b/.test(String(error));
export const BLOCKED_DAYS = 7;
export function blockedIssue(page, error, fails) {
  return {
    key: `watchdown-${page.id}`,
    title: `【お知らせ】${page.name}が自動チェックを断っています（サイトの表示には影響なし）`,
    body: [
      `毎日の自動チェックで次の公式ページを開こうとすると、${fails}日続けて「アクセスの拒否」が返りました。ページがなくなったのではなく、公式サイトが GitHub のサーバーからの自動のアクセスを断っていると考えられます。サイトの表示と還元率の計算には影響しません。`,
      '',
      `- ページ：[${page.name}](${page.url})`,
      `- 応答：${error}`,
      `- 見張っていた内容：${page.what}（\`${page.file}\`）`,
      '',
      '### やること',
      `1. 上のページをブラウザで開き、${page.what}が変わっていないかを確かめます（URL を探す必要はありません）。`,
      `2. 断られる状態が続くと、このページの変化は自動では分かりません。見張りをやめるときは、\`config/watch.json\` から \`${page.id}\` の行を消します（消すと、この Issue は自動で閉じます）。${page.kind === 'point' ? 'ポイントの率は、確認から90日たつと見直しのお願いが届くので、そこで確かめられます。' : ''}`,
      '3. また開けるようになると、この Issue は自動で閉じます。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

const addDays = (iso, k) => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const dayNo = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/** 変わり続けるページ（毎日ちがう内容）は、見つけてからこの日数で知らせる（1日だけの一時的な表示は知らせない） */
export const PENDING_MAX_DAYS = 3;
/** まだ閉じていない「内容が変わりました」の Issue を、まとめたり元に戻ったら閉じたりする対象にする日数 */
export const ISSUE_KEEP_DAYS = 30;
const BACK_NOTE = '自動チェックで、公式ページがこの Issue の前の内容に戻ったことを確認しました。一時的な変化だったと考えられるので、この Issue を閉じます。この Issue を見てファイルを直していたら、元に戻してください。';
const MERGE_NOTE = '同じページで新しい変化があったので、新しい Issue にまとめました（最初の変化の前の内容と比べています）。この Issue は閉じます。';

/**
 * 公式ページの見張りの判断（通信しない部分）。data/watch.json の記録 rec と、今日取り出した行 got から、何をするかを決める。
 *   same     … 前の日と同じ（前の日に見つけた変化が元に戻っていたら reverted：一時的な表示だったので知らせない）
 *   pending  … 変化を見つけた。次の日も変わったままなら知らせる（メンテナンス中の表示など、1日だけの変化を知らせないため）
 *   raise    … 次の日も変わったまま（または PENDING_MAX_DAYS 日変わり続けた）→「内容が変わりました」の Issue。
 *              同じページのまだ閉じていない古い Issue は、新しい Issue にまとめて閉じる（比べるのは最初の変化の前の内容）
 *   back     … まだ閉じていない Issue の前の内容に戻った → その Issue を閉じる
 * closed … 閉じた Issue の key（読めなかったときは null。そのときは「元に戻った」の判断をしない）。
 *          閉じた Issue（運営者や Claude が確かめたもの）は、確認済みとして記録から消す
 * 戻り値：{ rec, action, issue?, close: [{ key, note }] }
 */
export function trackPage(page, rec = {}, got = [], { today, closed = null } = {}) {
  const r = { ...rec };
  const close = [];
  const newHash = hashLines(got);
  // 閉じた Issue と、30日より前の Issue は、確認済みとして外す（すべて外れたら「最初の変化の前の内容」も捨てる）
  const fresh = (k) => { const m = String(k).match(/(\d{4}-\d{2}-\d{2})$/); return !m || dayNo(today) - dayNo(m[1]) <= ISSUE_KEEP_DAYS; };
  if (r.issueKeys?.length) {
    r.issueKeys = r.issueKeys.filter((k) => fresh(k) && !(closed && closed.has(k)));
    if (!r.issueKeys.length) { delete r.issueKeys; delete r.base; }
  }
  const accept = () => { r.hash = newHash; r.lines = got; delete r.pending; };
  if (!r.hash) { accept(); return { rec: r, action: 'first', close }; }
  const prevLines = watchedLines(page, r.lines || []);
  const prevHash = hashLines(prevLines);
  if (newHash === prevHash) {
    const action = r.pending ? 'reverted' : 'same';
    accept();
    return { rec: r, action, close };
  }
  if (closed && r.base && newHash === r.base.hash) {
    for (const key of r.issueKeys || []) close.push({ key, note: BACK_NOTE });
    delete r.base; delete r.issueKeys; accept();
    return { rec: r, action: 'back', close };
  }
  if (r.pending && (r.pending.hash === newHash || dayNo(today) - dayNo(r.pending.since) >= PENDING_MAX_DAYS - 1)) {
    const open = r.issueKeys || [];
    for (const key of open) close.push({ key, note: MERGE_NOTE });
    const issue = changeIssue(page, r.base?.lines || prevLines, got, today, { merged: open.length });
    r.base ??= { hash: prevHash, lines: prevLines, since: r.pending.since };
    r.issueKeys = [issue.key];
    r.changedAt = today;
    accept();
    return { rec: r, action: 'raise', issue, close };
  }
  r.pending = { hash: newHash, lines: got, since: r.pending?.since || today };
  return { rec: r, action: 'pending', close };
}

/** 最後のジャンボが売り終わってから、次のジャンボが登録されないまま何日たったら知らせるか（ふだんの間は35〜60日） */
export const JUMBO_GAP_DAYS = 60;
/** キャンペーン情報（config/campaigns.json）の見直しをお願いするまでの日数 */
export const CAMPAIGN_DAYS = 30;

/**
 * 日付から分かる「お願い」
 *   ・次のジャンボ宝くじが登録されていない（ふつうは公式発表から自動で登録される。発売中・発売前のジャンボがなく、
 *     最後のジャンボが売り終わってから60日たっても次が登録されないときだけ知らせる）
 *   ・報道などをもとに入れた賞金表（verify が付いていて、自動登録ではないくじ）の発売が30日以内に近づいた
 *   ・ポイントの率を最後に確認してから90日たった
 * 戻り値：[{ type: 'raise', key, title, body } | { type: 'clear', key }]
 */
export function scheduleChecks(defs, points, today, campaigns = null) {
  const out = [];
  const jumbos = Object.values(defs).filter((d) => d.model === 'fixed' && d.salesStart && d.salesEnd);
  const current = jumbos.filter((d) => d.salesEnd >= today);
  const lastEnd = jumbos.map((d) => d.salesEnd).sort().pop() || '';
  if (!current.length && (!lastEnd || lastEnd < addDays(today, -JUMBO_GAP_DAYS))) {
    out.push({
      type: 'raise', key: 'jumbo-next',
      title: '【確認のお願い】次のジャンボ宝くじが登録されていません',
      body: [
        `登録されているジャンボ宝くじは、${lastEnd ? `${lastEnd}で` : 'すでに'}すべて売り終わり、それから${JUMBO_GAP_DAYS}日以上たちました。ふつうは宝くじ公式サイトの発表（宝ニュース）から自動で登録しますが、次のジャンボがまだ登録されていません。`,
        '',
        '### やること',
        '1. [宝くじ公式サイトの「ジャンボ宝くじ等の普通くじ」](https://www.takarakuji-official.jp/kuji/jumbo/)で、次のジャンボの発売が発表されているか確認します。',
        '2. 発表されていれば、この Issue を Claude に見せて「次のジャンボを追加して」と頼んでください（`data/games.json` に追加します）。',
        '3. まだ発表されていなければ、何もしなくてかまいません。発売前のジャンボが登録されると、この Issue は自動で閉じます。',
        '',
        HOW_TO_FIX,
      ].join('\n'),
    });
  } else out.push({ type: 'clear', key: 'jumbo-next' });

  for (const d of Object.values(defs)) {
    const key = `verify-${d.id}`;
    const soon = d.salesStart && d.salesStart <= addDays(today, 30) && (!d.salesEnd || d.salesEnd >= today);
    // 公式発表から自動で登録した項目（autoFrom）の確認は、自動登録の Issue（jumbo-auto-…）でお願いする
    if (d.verify && !d.autoFrom && soon) {
      out.push({
        type: 'raise', key,
        title: `【お願い】${d.name}の賞金表を公式発表で確認してください`,
        body: [
          `${d.name}は ${d.salesStart} に発売されます。いま登録している賞金表は、公式発表の前の情報をもとにしています。`,
          '',
          `> ${d.verify}`,
          '',
          '宝くじ公式サイトの発表（宝ニュース）が出ると、毎朝の自動チェックで読み取り、公式の内容に置き換えます（そのときは、この Issue は自動で閉じ、確認のお願いの Issue が別に届きます）。',
          '',
          '### 発売の1週間前になっても置き換わらないとき',
          '1. [宝くじ公式サイト](https://www.takarakuji-official.jp/kuji/jumbo/)で、賞金・本数・発売期間・抽せん日・発売総数を確認します。',
          `2. 違っていたら \`data/games.json\` の \`${d.id}\` を直します（この Issue を Claude に見せて「直して」と頼めます）。`,
          `3. 確認できたら、同じ項目の \`"verify": …\` の行を消します。すると、この Issue は自動で閉じ、くじ別ページの注意書きも消えます。`,
          '',
          HOW_TO_FIX,
        ].join('\n'),
      });
    } else out.push({ type: 'clear', key });
  }

  const checked = points?.checkedOn;
  if (checked && checked < addDays(today, -90)) {
    out.push({
      type: 'raise', key: 'points-recheck',
      title: '【お願い】ポイントの率を見直してください（前回の確認から90日以上）',
      body: [
        `ポイントの率を最後に確認したのは ${checked} です。公式ページの見張りで変化がなくても、念のため年に数回は見直してください。`,
        '',
        '### やること',
        '1. `config/points.json` の各項目の `sources` のページを開き、率が変わっていないか確認します。',
        '2. 変わっていたら `rate` を直します。',
        '3. 確認が終わったら `checkedOn` を今日の日付にします。すると、この Issue は自動で閉じます。',
        '',
        HOW_TO_FIX,
      ].join('\n'),
    });
  } else out.push({ type: 'clear', key: 'points-recheck' });

  // 期間限定のキャンペーン（config/campaigns.json）は毎月変わるので、確認から30日で見直しをお願いする
  const cpChecked = campaigns?.checkedOn;
  if (cpChecked && cpChecked < addDays(today, -CAMPAIGN_DAYS)) {
    const active = (campaigns.items || []).filter((c) => !c.until || c.until >= today).length;
    out.push({
      type: 'raise', key: 'campaigns-recheck',
      title: `【お願い】キャンペーン情報を見直してください（前回の確認から${CAMPAIGN_DAYS}日以上）`,
      body: [
        `キャンペーン情報（\`config/campaigns.json\`）を最後に確認したのは ${cpChecked} です。いま表示しているキャンペーンは${active}件です（終わったものは自動で消えています）。宝くじ公式サイトのダブルチャンスキャンペーンや、楽天銀行のスポーツくじのキャンペーンは毎月のように新しくなります。`,
        '',
        '### やること',
        '1. この Issue を Claude に見せて「キャンペーンを見直して」と頼んでください。各社の公式ページで、いま開催中のキャンペーンを確かめて直します。',
        '2. 自分で直すときは、`config/campaigns.json` の `items` を直し、`checkedOn` を今日の日付にします。すると、この Issue は自動で閉じます。',
        '',
        '確かめるページ：[宝くじ公式サイトのキャンペーン](https://www.takarakuji-official.jp/special/campaign/)・[楽天銀行のスポーツくじ](https://www.rakuten-bank.co.jp/toto/)・[楽天totoのキャンペーン](https://toto.rakuten.co.jp/campaign/)・[スポーツくじオフィシャルサイト](https://www.toto-dream.com/)',
        '',
        HOW_TO_FIX,
      ].join('\n'),
    });
  } else out.push({ type: 'clear', key: 'campaigns-recheck' });
  return out;
}

/* ---------------- BIG777（特別開催回）のお知らせ ---------------- */

const WHY_TEXT = {
  rule: '日付の決まりによる判定',
  payout: '1等の当せん金による判定（確定）',
  manual: '`data/overrides.json` の `big777` で指定',
};

function targetNotice(def, v, rounds, today) {
  const sp = def.special;
  const me = rounds.find((r) => r.round === v.round) || {};
  const period = me.salesEnd ? `販売 ${me.salesStart ? fmtShort(me.salesStart) : ''}〜${fmtShort(me.salesEnd)}${me.salesEnd < today ? '・販売は終了' : ''}` : '';
  return {
    title: `【お知らせ】今月の${sp.name}は第${v.round}回として計算しています（1等の上限${sp.capText}）`,
    body: [
      `毎月7日を含む週は、BIG の1等の上限がキャリーオーバーの有無にかかわらず${sp.capText}に上がる「${sp.name}」の回があります。サイトは自動で判定して、次の回を${sp.name}として計算しています。`,
      '',
      `- 対象の回：第${v.round}回${period ? `（${period}）` : ''}`,
      `- 判定の理由：${WHY_TEXT[v.why] || v.why}`,
      `- 決め方：${sp.rule}`,
      '',
      '### やること',
      `1. BIG を売っているサイト（[スポーツくじオフィシャルサイト](https://www.toto-dream.com/big/)や楽天totoなど）で、1等の最高額が「${sp.capText}」になっている回の番号を確認します。`,
      `2. 第${v.round}回で合っていれば、何もしなくてかまいません。この Issue は、${sp.name}の週が終わって1週間たつと自動で閉じます（先に閉じてもかまいません）。`,
      `3. 違っていたら、\`data/overrides.json\` の \`${sp.id}\` を直します。本当の${sp.name}の回の番号を \`add\` に、第${v.round}回を \`remove\` に入れます（例：本当は第${v.round + 1}回だったら \`"add": [${v.round + 1}], "remove": [${v.round}]\`）。保存すると、サイトが作り直されます。`,
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

function unknownNotice(def, w, pending) {
  const sp = def.special;
  return {
    title: `【確認のお願い】今月の${sp.name}の回を判定できませんでした`,
    body: [
      `${fmtShort(w.from)}〜${fmtShort(w.to)}の週（毎月7日を含む週）に、${sp.name}として計算した BIG の回がありませんでした。`,
      pending
        ? `第${pending.round}回は、同じ週にあとから販売が終わる回があるかどうか分からなかったため、通常の回として計算しました。`
        : 'この週に販売が終わる BIG の回が見つかりませんでした（データの取得が止まっていた可能性もあります）。',
      '',
      '### やること',
      `1. BIG を売っているサイト（[スポーツくじオフィシャルサイト](https://www.toto-dream.com/big/)や楽天totoなど）で、今月の${sp.name}（1等の最高額${sp.capText}）の回の番号を確認します。`,
      `2. ${sp.name}の回があったら、\`data/overrides.json\` の \`${sp.id}\` の \`add\` に、その回の番号を入れます（例：第${pending?.round || 1670}回なら \`"add": [${pending?.round || 1670}]\`）。保存すると、過去の還元率の推移が計算し直されます。`,
      '3. 確認できたら、この Issue を閉じてください。',
      '',
      HOW_TO_FIX,
    ].join('\n'),
  };
}

function mismatchNotice(def, r, paid, rule) {
  const sp = def.special;
  const t1 = r.tiers.find((t) => t.tier === 1);
  const capCO = def.tiers.find((t) => t.top).capCO;
  return {
    title: `【確認のお願い】第${r.round}回の${sp.name}の判定が、実際の当せん金と合いませんでした`,
    body: [
      `第${r.round}回の BIG の1等は、1口${yenJa(t1.prize)}（${t1.winners}口）でした。${paid
        ? `通常の上限（${yenJa(capCO)}）を超えているので、この回は${sp.name}の回でした。`
        : `通常の上限（${yenJa(capCO)}）ちょうどなので、この回は${sp.name}の回ではありませんでした。`}`,
      `一方、サイトの日付の決まり（${sp.rule}）では、${rule.on ? `${sp.name}の回` : '通常の回'}と判定していました。`,
      '',
      '- この回の還元率の推移は、実際の当せん金に合わせて計算し直しています（何もしなくて大丈夫です）。',
      '- ただし、日付の決まりが公式の決め方と違っている可能性があり、来月以降の判定がずれるおそれがあります。',
      '',
      '### やること',
      `この Issue の題名と本文をそのままコピーして、Claude に「${sp.name}の決め方を直して」と頼んでください。直ったら、この Issue を閉じてください。`,
    ].join('\n'),
  };
}

/**
 * BIG777 のお知らせ（watch.mjs から1日1回）。
 *   ・今月の BIG777 の回が分かったら、1回だけお知らせする（その週が終わって1週間たつと自動で閉じる）
 *   ・今月の週が終わっても BIG777 の回が分からなかったら、1回だけ確認をお願いする
 *   ・実際の1等の当せん金が、日付の決まりと合わなかった回を、1回だけお知らせする
 * memo は data/watch.json に残す記録（同じお知らせを何度も出さないため）。この関数が中身を書き換える。
 * 戻り値：[{ type: 'raise', key, title, body } | { type: 'clear', key }]
 */
export function specialChecks(defs, state, overrides, today, memo = {}) {
  const out = [];
  for (const def of Object.values(defs)) {
    const sp = def.special;
    if (!sp) continue;
    const st = state?.games?.[def.id] || {};
    const manual = overrides?.[sp.id] || {};
    const m = (memo[def.id] ??= {});
    m.since ??= today;
    m.notified ??= [];
    m.mismatch ??= [];
    const rounds = knownRounds(st);
    const w = weekWith7(today);
    const key = `special-${def.id}-${w.month}`;
    const verdicts = rounds.filter((r) => r.salesEnd && r.salesEnd >= w.from && r.salesEnd <= w.to).map((r) => specialOf(def, r.round, st, manual));
    const target = verdicts.filter((v) => v.on && v.sure).pop() || null;
    if (!m.notified.includes(w.month)) {
      if (w.to < m.since) m.notified.push(w.month); // 見張りを始める前に終わった週は、お知らせしない
      else if (target) { out.push({ type: 'raise', key, ...targetNotice(def, target, rounds, today) }); m.notified.push(w.month); }
      else if (today > w.to) { out.push({ type: 'raise', key: `${key}-unknown`, ...unknownNotice(def, w, verdicts.find((v) => !v.sure) || null) }); m.notified.push(w.month); }
    }
    if (today > addDaysIso(w.to, 7)) out.push({ type: 'clear', key });

    for (const r of st.results || []) {
      if (!r?.round || !r.resultDate || r.resultDate < m.since || m.mismatch.includes(r.round)) continue;
      if ([...(manual.add || []), ...(manual.remove || [])].map(Number).includes(r.round)) continue;
      const paid = payoutVerdict(def, r);
      if (paid === null) continue;
      const rule = ruleVerdict(rounds, r.round);
      if (rule.on === paid) continue;
      out.push({ type: 'raise', key: `special-${def.id}-mismatch-${r.round}`, ...mismatchNotice(def, r, paid, rule) });
      m.mismatch.push(r.round);
    }
    m.notified = m.notified.slice(-24);
    m.mismatch = m.mismatch.slice(-50);
  }
  return out;
}
