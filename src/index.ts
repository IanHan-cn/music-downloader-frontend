/**
 * Cloudflare Worker 入口
 *
 * 路由：
 *   GET  /              返回前端页面
 *   GET  /api/config    下发非敏感前端配置
 *   POST /api/process   代理转发到真实后端（规避 CORS、隐藏后端地址）
 */

import { concurrencyLimit, renderPage } from './page';

export interface Env {
  /** 后端根地址，例如 https://api.example.com（建议用 secret 配置） */
  API_BASE_URL?: string;
  /** 拼接在 API_BASE_URL 之后的路径，默认 /process */
  API_PATH?: string;
  /** 后端鉴权 token，配置后附带 Authorization: Bearer <token> */
  API_TOKEN?: string;
  /** 代理请求超时（毫秒），默认 120000 */
  API_TIMEOUT_MS?: string;
  /** 前端最大并发数，取环境变量 MAX_CONCURRENCY，缺省 2 */
  MAX_CONCURRENCY?: string;
  /** 是否允许页面临时覆盖后端地址（调试用，生产建议 false） */
  ALLOW_API_OVERRIDE?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return withCors(request, new Response(renderPage(env), { headers: HTML_HEADERS }));
    }

    if (url.pathname === '/api/config' && request.method === 'GET') {
      return withCors(
        request,
        json({
          allowApiOverride: env.ALLOW_API_OVERRIDE === 'true',
          maxConcurrency: concurrencyLimit(env.MAX_CONCURRENCY),
          backendConfigured: Boolean(env.API_BASE_URL)
        })
      );
    }

    if (url.pathname === '/api/process' && request.method === 'POST') {
      return withCors(request, await handleProcess(request, env));
    }

    return withCors(request, json({ ok: false, error: 'Not Found' }, 404));
  }
} satisfies ExportedHandler<Env>;

/** 代理一次「生成下载链接」请求 */
async function handleProcess(request: Request, env: Env): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('bad body');
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: '请求体不是合法的 JSON 对象' }, 400);
  }

  const fileUrl = normalizeUrl(payload.file_url);
  if (!fileUrl) {
    return json({ ok: false, error: '缺少或非法的 file_url（需为 http/https 地址）' }, 400);
  }

  const resolved = resolveTarget(env, request.headers.get('x-api-base-url'));
  if (typeof resolved !== 'string') return resolved; // 返回的是错误响应

  const timeoutMs = clampInt(env.API_TIMEOUT_MS, 1_000, 300_000, 120_000);

  // duration 仅在解析到时才附带，避免后端收到空值
  const body: Record<string, unknown> = {
    file_url: fileUrl,
    cover_url: normalizeUrl(payload.cover_url) ?? '',
    title: toText(payload.title),
    artist: toText(payload.artist),
    album: toText(payload.album)
  };
  const duration = toDuration(payload.duration);
  if (duration !== null) body.duration = duration;

    let upstream: Response;
    try {
      upstream = await fetch(resolved, {
        method: 'POST',
        headers: buildHeaders(env),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return json(
      {
        ok: false,
        error: timeout
          ? `后端处理超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请稍后重试`
          : `无法连接后端：${errorText(error)}`
      },
      504
    );
  }

  const raw = await upstream.text();
  const parsed = tryParseJson(raw);

  if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const downloadUrl = extractDownloadUrl(record);
    if (downloadUrl) {
      return json({
        ok: true,
        code: typeof record.code === 'number' ? record.code : upstream.status,
        message: typeof record.message === 'string' ? record.message : '',
        file_url: downloadUrl
      });
    }
    if (!upstream.ok || (typeof record.code === 'number' && record.code >= 400)) {
      return json(
        { ok: false, error: typeof record.message === 'string' && record.message ? record.message : `后端返回错误（HTTP ${upstream.status}）` },
        502
      );
    }
    return json({ ok: false, error: '后端响应中未找到 data.file_url' }, 502);
  }

  if (!upstream.ok) {
    return json({ ok: false, error: `后端返回 HTTP ${upstream.status}` }, 502);
  }
  return json({ ok: false, error: '后端响应不是 JSON，无法解析下载链接' }, 502);
}

/**
 * 解析上游响应中的下载链接，兼容：
 *   { data: { file_url } } / { data: "https://..." } / { file_url } / { url }
 */
function extractDownloadUrl(record: Record<string, unknown>): string | null {
  const data = record.data;
  if (typeof data === 'string') return normalizeUrl(data);
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    const fromData = normalizeUrl(nested.file_url) ?? normalizeUrl(nested.url) ?? normalizeUrl(nested.download_url);
    if (fromData) return fromData;
  }
  return normalizeUrl(record.file_url) ?? normalizeUrl(record.url) ?? normalizeUrl(record.download_url) ?? null;
}

/** 决定真实请求地址：仅当显式开启时才允许页面覆盖 */
function resolveTarget(env: Env, override: string | null): string | Response {
  if (env.ALLOW_API_OVERRIDE === 'true' && override && override.trim()) {
    const url = parseHttpUrl(override.trim());
    if (!url) return json({ ok: false, error: '临时后端地址非法（需为 http/https 地址）' }, 400);
    return url.toString();
  }

  const base = (env.API_BASE_URL ?? '').trim();
  if (!base) {
    return json({ ok: false, error: 'Worker 未配置后端地址 API_BASE_URL' }, 500);
  }
  const baseUrl = parseHttpUrl(base);
  if (!baseUrl) return json({ ok: false, error: 'API_BASE_URL 配置非法' }, 500);

  const path = env.API_PATH ?? '/process';
  const cleanBase = baseUrl.toString().replace(/\/+$/, '');
  if (!path || path === '/') return cleanBase;
  return `${cleanBase}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    accept: 'application/json'
  };
  const token = (env.API_TOKEN ?? '').trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/* ---------------- 工具函数 ---------------- */

function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseHttpUrl(trimmed)?.toString() ?? null;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * 时长归一化为秒（整数）：接受 285、"285"、"07:07"、"1:02:03"。
 * 无法识别或非正数时返回 null，调用方据此决定要不要带这个字段。
 */
function toDuration(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  const parts = text.split(':');
  if (parts.length === 2 || parts.length === 3) {
    const nums: number[] = [];
    for (const part of parts) {
      if (!/^\d{1,4}$/.test(part.trim())) return null;
      nums.push(Number.parseInt(part, 10));
    }
    // 首段（时或分）允许超过 59，其余段必须是合法的分/秒
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] > 59) return null;
    }
    const total =
      parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2];
    return total > 0 ? total : null;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number.parseFloat(text);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  return null;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '未知错误';
}

function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-api-base-url',
    'access-control-max-age': '86400'
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  return headers;
}

function withCors(request: Request, response: Response): Response {
  const headers = corsHeaders(request);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}
