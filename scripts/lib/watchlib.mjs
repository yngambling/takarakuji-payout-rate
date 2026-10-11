// 公式ページの見張り（watch.mjs）で使う、通信しない部分
import { createHash } from 'node:crypto';
import { htmlToText } from './parse.mjs';
import { HOW_TO_FIX } from './alerts.mjs';

const DATE_RE = /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*[(（][^)）]{1,3}[)）])?|\d{4}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}:\d{2}/g;

/**
 * ページの中から、見張る行だけを取り出す。
 *   keywords のどれかを含む行（digit が true なら、さらに数字を含む行）
 *   ポイント・支払い・購入場所のページは、日付や時刻を消してから比べる（「更新日」だけの変化で知らせないため）
 */
export function extractLines(html, page) {
  const text = htmlToText(html);
  const keep = [];
  for (let line of text.split('\n')) {
    line = line.replace(/\s+/g, ' ').trim();
    if (!line || line.length > 300) continue;
    if (!(page.keywords || []).some((k) => line.includes(k))) continue;
    if (page.digit && !/\d/.test(line)) continue;
    line = line.replace(/(?:あと|残り)\s*\d+\s*(?:日|時間|分)/g, '');
    if (page.kind !== 'jumbo') line = line.replace(DATE_RE, '');
    line = line.replace(/\s+/g, ' ').trim();
    if (line && !keep.includes(line)) keep.push(line);
    if (keep.length >= 80) break;
  }
  return keep;
}

export const hashLines = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);

export function diffLines(before = [], after = []) {
  const b = new Set(before);
  const a = new Set(after);
  return { removed: before.filter((l) => !a.has(l)), added: after.filter((l) => !b.has(l)) };
}

const KIND_TEXT = { point: 'ポイントの率', pay: '支払い方法', shop: '購入場所', jumbo: 'ジャンボ宝くじの発売' };

export function changeIssue(page, before, after, today) {
  const { removed, added } = diffLines(before, after);
  const list = (xs) => (xs.length ? xs.slice(0, 15).map((l) => `- ${l}`).join('\n') + (xs.length > 15 ? `\n- ほか${xs.length - 15}行` : '') : '- （なし）');
  return {
    key: `watch-${page.id}-${today}`,
    title: `【確認のお願い】${page.name}の内容が変わりました`,
    body: [
      `毎日の自動チェックで、次の公式ページの「${KIND_TEXT[page.kind] || page.kind}」に関係する部分が変わりました。サイトの表示は、まだ何も変えていません。`,
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
      page.kind === 'jumbo' ? '3. 新しいジャンボの賞金表が発表されていたら、`data/games.json` に追加し、`config/links.json` の `games` にも購入リンクを足します（README の「新しいジャンボ宝くじを追加する」）。' : null,
      '',
      HOW_TO_FIX,
    ].filter((x) => x !== null).join('\n'),
  };
}

export function downIssue(page, error, fails) {
  const layout = /見張る行/.test(String(error));
  return {
    key: `watchdown-${page.id}`,
    title: layout ? `【確認のお願い】${page.name}の作りが変わった可能性があります` : `【確認のお願い】${page.name}を開けません`,
    body: [
      layout
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

const addDays = (iso, k) => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);

/**
 * 日付から分かる「お願い」
 *   ・次のジャンボ宝くじが登録されていない（登録済みのジャンボが30日以内に売り終わり、その先がない）
 *   ・報道などをもとに入れた賞金表（verify が付いたくじ）の発売が30日以内に近づいた
 *   ・ポイントの率を最後に確認してから90日たった
 * 戻り値：[{ type: 'raise', key, title, body } | { type: 'clear', key }]
 */
export function scheduleChecks(defs, points, today) {
  const out = [];
  const jumbos = Object.values(defs).filter((d) => d.model === 'fixed' && d.salesStart && d.salesEnd);
  const upcoming = jumbos.filter((d) => d.salesStart > today);
  const lastEnd = jumbos.map((d) => d.salesEnd).sort().pop() || '';
  if (!upcoming.length && (!lastEnd || lastEnd < addDays(today, 30))) {
    out.push({
      type: 'raise', key: 'jumbo-next',
      title: '【お願い】次のジャンボ宝くじの賞金表を登録してください',
      body: [
        `登録されているジャンボ宝くじは、${lastEnd ? `${lastEnd}で` : 'すでに'}すべて売り終わります。次のジャンボ（バレンタイン・ドリーム・サマー・ハロウィン・年末など）がまだ登録されていないため、発売が始まってもランキングに出ません。`,
        '',
        '### やること',
        '1. [宝くじ公式サイトの商品のご案内](https://www.takarakuji-official.jp/kuji/top.html)で、次のジャンボの賞金（1等〜各等の金額と本数）、発売期間、抽せん日、発売総数を確認します。',
        '2. `data/games.json` に、`halloween2026` などをまねて新しい項目を追加し、`config/links.json` の `games` に同じIDで購入リンクを足します（README の「新しいジャンボ宝くじを追加する」）。',
        '3. 発売前のジャンボが登録されると、この Issue は自動で閉じます。',
        '',
        HOW_TO_FIX,
      ].join('\n'),
    });
  } else out.push({ type: 'clear', key: 'jumbo-next' });

  for (const d of Object.values(defs)) {
    const key = `verify-${d.id}`;
    const soon = d.salesStart && d.salesStart <= addDays(today, 30) && (!d.salesEnd || d.salesEnd >= today);
    if (d.verify && soon) {
      out.push({
        type: 'raise', key,
        title: `【お願い】${d.name}の賞金表を公式発表で確認してください`,
        body: [
          `${d.name}は ${d.salesStart} に発売されます。いま登録している賞金表は、公式発表の前の情報をもとにしています。`,
          '',
          `> ${d.verify}`,
          '',
          '### やること',
          '1. [宝くじ公式サイト](https://www.takarakuji-official.jp/kuji/top.html)で、賞金・本数・発売期間・抽せん日・発売総数を確認します。',
          `2. 違っていたら \`data/games.json\` の \`${d.id}\` を直します。`,
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
  return out;
}
