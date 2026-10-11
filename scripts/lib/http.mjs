// 取得用の小さな HTTP クライアント（Node 20 以上の fetch を使用）
//   ・リダイレクトを自前で追い、Cookie を引き継ぐ（セッション必須のページ対策）
//   ・タイムアウトと再試行
//   ・Shift_JIS / UTF-8 の判定

import { sleep } from './util.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 takarakuji-kitaichi/1.0';

const jar = new Map(); // host -> Map(name -> value)

function storeCookies(url, res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (!list.length) return;
  const host = new URL(url).host;
  const m = jar.get(host) || new Map();
  for (const c of list) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  jar.set(host, m);
}

function cookieHeader(url) {
  const m = jar.get(new URL(url).host);
  return m && m.size ? [...m].map(([k, v]) => `${k}=${v}`).join('; ') : null;
}

/** バイト列で取得 */
export async function fetchBytes(url, { tries = 3, timeoutMs = 25000, referer = null } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      let current = url;
      for (let hop = 0; hop < 6; hop++) {
        const headers = {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8',
          'accept-language': 'ja,en;q=0.5',
        };
        const ck = cookieHeader(current);
        if (ck) headers.cookie = ck;
        if (referer) headers.referer = referer;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        let res;
        try {
          res = await fetch(current, { headers, redirect: 'manual', signal: ctrl.signal });
        } finally {
          clearTimeout(timer);
        }
        storeCookies(current, res);
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) {
          current = new URL(loc, current).toString();
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} ${current}`);
        const buf = Buffer.from(await res.arrayBuffer());
        return { buf, url: current, contentType: res.headers.get('content-type') || '' };
      }
      throw new Error(`リダイレクトが多すぎます ${url}`);
    } catch (e) {
      lastErr = e;
      if (attempt < tries) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

const SJIS = new Set(['shift_jis', 'shift-jis', 'sjis', 'x-sjis', 'windows-31j', 'cp932', 'ms932', 'ms_kanji']);

/** バイト列 → 文字列。prefer を優先し、文字化けしていれば UTF-8 でやり直す */
export function decodeBytes(buf, contentType = '', prefer = null) {
  let enc = prefer;
  if (!enc) {
    const m = String(contentType).toLowerCase().match(/charset=["']?([\w-]+)/);
    if (m) enc = m[1];
  }
  if (!enc) {
    const head = buf.subarray(0, 4096).toString('latin1');
    const m = head.match(/charset\s*=\s*["']?([\w-]+)/i);
    if (m) enc = m[1];
  }
  enc = (enc || 'utf-8').toLowerCase();
  if (SJIS.has(enc)) enc = 'shift_jis';
  let text;
  try {
    text = new TextDecoder(enc).decode(buf);
  } catch {
    text = new TextDecoder('utf-8').decode(buf);
  }
  const bad = (text.match(/�/g) || []).length;
  if (bad > 5) {
    const alt = new TextDecoder(enc === 'utf-8' ? 'shift_jis' : 'utf-8').decode(buf);
    if ((alt.match(/�/g) || []).length < bad) text = alt;
  }
  return text;
}

export async function fetchText(url, opts = {}) {
  const { buf, contentType } = await fetchBytes(url, opts);
  return decodeBytes(buf, contentType, opts.encoding || null);
}
