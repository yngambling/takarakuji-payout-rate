// 解説ページ（content/guide/*.md）の読み取りと、HTML への変換。外部のパッケージは使わない小さな Markdown。
// 書き方は README の「解説ページ（宝くじの基礎知識）」。
//
//   ---                                 ← 先頭の「---」から「---」までが設定（front matter）
//   title: 検索結果に出る題名
//   h1: ページの見出し（なければ title）
//   short: サイドバーなどに出る短い名前
//   description: 検索結果に出る説明
//   checkedOn: 2026-10-18                ← 内容を一次情報で確かめた日
//   order: 1                             ← 並び順
//   sources:
//   - 出典の名前 | https://…
//   ---
//   最初の段落はリード文になる。
//   ## 見出し {#id}                       ← 大見出し（id は目次とリンクに使うので必ず付ける）
//   ### 小見出し
//   段落（続けて書いた行は1つの段落）。**太字**、[リンク](kuji/loto6.html)（トップページは [トップ](/)）、{{rate:loto6}} のような自動の数字
//   - 箇条書き　／　1. 番号付き
//   | 表 | 表 |  ← 2行目は |---|---|
//   > 注意書き（小さな字）　／　!> 目立たせるお知らせ
//   {{table:ev}}                          ← 1行だけで書くと、自動の表などに置き換わる
//   Q: よくある質問？                     ← Q と A は組にする（よくある質問の構造化データにもなる）
//   A: 答え

import { esc } from './util.mjs';

/**
 * 贈与税（暦年課税）の計算。国税庁 No.4408「贈与税の計算と税率（暦年課税）」（令和8年4月1日現在法令等）の表のとおり。
 *   1年間にもらった額から基礎控除110万円を引き、税率を掛けて控除額を引く。
 *   special … 18歳以上の人が父母や祖父母からもらったとき（特例税率）
 */
export const GIFT_BASIC = 1100000;
const GIFT_GENERAL = [[2e6, 0.1, 0], [3e6, 0.15, 1e5], [4e6, 0.2, 2.5e5], [6e6, 0.3, 6.5e5], [1e7, 0.4, 1.25e6], [1.5e7, 0.45, 1.75e6], [3e7, 0.5, 2.5e6], [Infinity, 0.55, 4e6]];
const GIFT_SPECIAL = [[2e6, 0.1, 0], [4e6, 0.15, 1e5], [6e6, 0.2, 3e5], [1e7, 0.3, 9e5], [1.5e7, 0.4, 1.9e6], [3e7, 0.45, 2.65e6], [4.5e7, 0.5, 4.15e6], [Infinity, 0.55, 6.4e6]];
export const GIFT_AMOUNTS = [2e6, 5e6, 1e7, 3e7, 1e8];
export function giftTax(amount, { special = false } = {}) {
  const base = Math.max(0, amount - GIFT_BASIC);
  if (!base) return 0;
  const [, rate, minus] = (special ? GIFT_SPECIAL : GIFT_GENERAL).find(([upTo]) => base <= upTo);
  return Math.max(0, Math.round(base * rate - minus));
}

/** 先頭の設定（front matter）と本文に分ける */
export function parseGuide(text, file = '') {
  const s = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}：先頭に「---」で囲んだ設定（title など）がありません`);
  const meta = { sources: [] };
  let inSources = false;
  for (const raw of m[1].split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (inSources && /^\s*-\s+/.test(line)) {
      const body = line.replace(/^\s*-\s+/, '');
      const i = body.lastIndexOf('|');
      if (i < 0) throw new Error(`${file}：sources の行は「名前 | URL」の形で書きます：${body}`);
      meta.sources.push({ title: body.slice(0, i).trim(), url: body.slice(i + 1).trim() });
      continue;
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!kv) throw new Error(`${file}：設定の行が読めません：${line}`);
    inSources = kv[1] === 'sources';
    if (!inSources) meta[kv[1]] = kv[1] === 'order' ? Number(kv[2]) : kv[2].trim();
  }
  const slug = (String(file).split(/[\\/]/).pop() || '').replace(/\.md$/, '');
  return { slug, meta, body: m[2] };
}

const HEAD_RE = /^(#{2,3})\s+(.+?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/;
const TOKEN_RE = /\{\{([a-z0-9]+)(?::([a-z0-9-]+))?\}\}/gi;
const BLOCK_RE = /^\{\{([a-z0-9]+):([a-z0-9-]+)\}\}$/i;

/** 本文の中の自動の数字（{{rate:loto6}} など）を、文字に置き換える */
function fillTokens(s, token) {
  return String(s).replace(TOKEN_RE, (all, name, arg) => {
    const v = token(name.toLowerCase(), arg || '');
    if (v == null) throw new Error(`知らない自動の数字です：${all}`);
    return String(v);
  });
}

/**
 * 1行の中の書式：文字を逃がしてから、**太字** と [リンク](URL) を HTML にする。
 * サイト内のリンク（http で始まらないもの）は、ページの階層に合わせて rel を前に付ける。
 */
export function inline(s, { rel = '', top = null, token = () => null } = {}) {
  let t = esc(fillTokens(s, token));
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
    const u = url.replace(/&amp;/g, '&');
    if (/^https?:\/\//.test(u)) return `<a href="${esc(u)}" target="_blank" rel="noopener">${label}</a>`;
    if (u.startsWith('#')) return `<a href="${esc(u)}">${label}</a>`;
    if (u === '/') return `<a href="${esc(top ?? (rel || './'))}">${label}</a>`;
    return `<a href="${esc(rel + u)}">${label}</a>`;
  });
  return t;
}

/** よくある質問の構造化データ用：書式の記号を外した文字 */
export const plainText = (s, token = () => null) => fillTokens(s, token).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');

/**
 * 本文を HTML にする。
 *   rel … ページの階層からサイトの一番上までの相対パス（guide/ のページなら '../'）。top … トップページへのリンク
 *   token(name, arg) … 自動の数字（文字）。知らない名前は null を返す（止めて知らせる）
 *   block(name, arg) … 1行だけの {{name:arg}} を置き換える HTML。知らない名前は null を返す
 * 戻り値：{ lead, html, toc: [[id, 見出し]], faq: [[質問, 答え（HTML）, 答え（文字）]] }
 */
export function renderGuideBody(body, { rel = '', top = null, token = () => null, block = () => null } = {}) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const toc = [];
  const faq = [];
  const ids = new Set();
  let lead = '';
  let seenHead = false;
  let i = 0;
  const il = (s) => inline(s, { rel, top, token });
  const isSpecial = (l) => HEAD_RE.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || /^\s*\|/.test(l) || /^\s*!?>\s?/.test(l) || BLOCK_RE.test(l.trim()) || /^(Q|A):\s/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(HEAD_RE);
    if (h) {
      const text = h[2].trim();
      if (h[1] === '##') {
        if (!h[3]) throw new Error(`大見出しに id がありません（「## 見出し {#id}」の形で書きます）：${text}`);
        if (ids.has(h[3])) throw new Error(`見出しの id が重なっています：${h[3]}`);
        ids.add(h[3]);
        toc.push([h[3], plainText(text, token)]);
        out.push(`<h2 id="${h[3]}">${il(text)}</h2>`);
      } else out.push(`<h3${h[3] ? ` id="${h[3]}"` : ''}>${il(text)}</h3>`);
      seenHead = true;
      i++;
      continue;
    }
    const bm = line.trim().match(BLOCK_RE);
    if (bm) {
      const html = block(bm[1].toLowerCase(), bm[2]);
      if (html == null) throw new Error(`知らない自動の表です：${line.trim()}`);
      out.push(html);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const re = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i].replace(re, '');
        i++;
        // 次の行が字下げされていれば、同じ項目の続き
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) item += lines[i++].trim();
        items.push(`<li>${il(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++].trim());
      const cells = (r) => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (rows.length < 2 || !/^\|?\s*:?-{2,}/.test(rows[1])) throw new Error(`表の2行目は「|---|---|」の形で書きます：${rows[0]}`);
      const align = cells(rows[1]).map((c) => (/^-+:$/.test(c) ? 'r' : /^:-+:$/.test(c) ? 'c' : ''));
      const head = cells(rows[0]).map((c) => `<th>${il(c)}</th>`).join('');
      const bodyRows = rows.slice(2).map((r) => `<tr>${cells(r).map((c, k) => (k === 0 ? `<th scope="row">${il(c)}</th>` : `<td${align[k] ? ` class="${align[k]}"` : ''}>${il(c)}</td>`)).join('')}</tr>`).join('\n');
      out.push(`<div class="tbl-wrap"><table class="t gtbl"><thead><tr>${head}</tr></thead><tbody>\n${bodyRows}\n</tbody></table></div>`);
      continue;
    }
    if (/^\s*!?>\s?/.test(line)) {
      const notice = /^\s*!>/.test(line);
      const re = notice ? /^\s*!>\s?/ : /^\s*>\s?/;
      const parts = [];
      while (i < lines.length && re.test(lines[i]) && (/^\s*!>/.test(lines[i]) === notice)) parts.push(lines[i++].replace(re, ''));
      out.push(notice ? `<div class="notice"><p>${parts.map(il).join('</p><p>')}</p></div>` : `<div class="note"><p>${parts.map(il).join('</p><p>')}</p></div>`);
      continue;
    }
    if (/^Q:\s/.test(line)) {
      const items = [];
      while (i < lines.length && (/^Q:\s/.test(lines[i]) || !lines[i].trim())) {
        if (!lines[i].trim()) { i++; continue; }
        const q = lines[i++].replace(/^Q:\s*/, '');
        if (i >= lines.length || !/^A:\s/.test(lines[i])) throw new Error(`よくある質問の「Q:」の次の行は「A:」で書きます：${q}`);
        let a = lines[i++].replace(/^A:\s*/, '');
        while (i < lines.length && lines[i].trim() && !/^(Q|A):\s/.test(lines[i]) && !isSpecial(lines[i])) a += lines[i++].trim();
        items.push([q, a]);
      }
      for (const [q, a] of items) faq.push([plainText(q, token), il(a), plainText(a, token)]);
      out.push(`<dl class="faq">${items.map(([q, a]) => `<dt>${il(q)}</dt><dd>${il(a)}</dd>`).join('')}</dl>`);
      continue;
    }
    if (/^A:\s/.test(line)) throw new Error(`「A:」の前に「Q:」がありません：${line}`);
    // 段落：空行か、ほかの書式の行まで
    let para = line.trim();
    i++;
    while (i < lines.length && lines[i].trim() && !isSpecial(lines[i])) para += lines[i++].trim();
    if (!seenHead && !lead) lead = `<p class="lead">${il(para)}</p>`;
    else out.push(`<p>${il(para)}</p>`);
  }
  return { lead, html: out.join('\n'), toc, faq };
}
