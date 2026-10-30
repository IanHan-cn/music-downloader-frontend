import { STYLES } from './styles';
import { CLIENT_JS } from './client';

export interface PageEnv {
  ALLOW_API_OVERRIDE?: string;
  MAX_CONCURRENCY?: string;
  API_PATH?: string;
  API_BASE_URL?: string;
}

const SAMPLE_TEXT = `歌名：Asylums for the Feeling
歌手：Silent Poets, Leila Adu
专辑：Death Stranding (Songs from the Video Game)
时长：07:07
来源：netease
歌曲ID：1419188876
文件大小：84.58MB
播放音质：FLAC无损音质 [1658Kbps]
封面链接：https://p2.music.126.net/T7CfAIy9BGu80xIIflmcAg==/109951168959882340.jpg
歌曲链接：https://m701.music.126.net/20261030010209/3da53af5b8890880c024b25b6cc80626/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/32281004916/cd01/0896/0b01/ca2003353ec616817610ce4191b03290.flac`;

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  batch: svg('<path d="M12 13v8"/><polyline points="8 17 12 21 16 17"/><path d="M20.4 14.9A5 5 0 0 0 18 6h-1.3A7 7 0 1 0 5 12.3"/>'),
  zap: svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  check: svg('<polyline points="20 6 9 17 4 12"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  refresh: svg('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>'),
  close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  sliders: svg('<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>'),
  sparkles: svg('<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
  send: svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>')
};

const EMPTY_ART = `
<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4f6bff" stop-opacity=".22"/>
      <stop offset="100%" stop-color="#22c7e8" stop-opacity=".10"/>
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="52" fill="url(#g1)"/>
  <circle cx="60" cy="60" r="34" stroke="currentColor" stroke-width="2.2" opacity=".55"/>
  <circle cx="60" cy="60" r="20" stroke="currentColor" stroke-width="2.2" opacity=".38"/>
  <circle cx="60" cy="60" r="6" fill="currentColor" opacity=".55"/>
  <path d="M60 12a48 48 0 0 1 44 29" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>
  <path d="M97 41l7 3-3 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>
</svg>`;

/** 生成完整 HTML 页面 */
export function renderPage(env: PageEnv): string {
  const config = {
    allowApiOverride: env.ALLOW_API_OVERRIDE === 'true',
    maxConcurrency: clampInt(env.MAX_CONCURRENCY, 1, 5, 2),
    backendConfigured: Boolean(env.API_BASE_URL)
  };

  const runtime = [
    `var SAMPLE_TEXT = ${JSON.stringify(SAMPLE_TEXT)};`,
    `var ICON_MUSIC = ${JSON.stringify(ICONS.music)};`,
    `var ICON_DOWNLOAD = ${JSON.stringify(ICONS.download)};`,
    `var ICON_COPY = ${JSON.stringify(ICONS.copy)};`,
    `var ICON_REFRESH = ${JSON.stringify(ICONS.refresh)};`,
    `var ICON_X = ${JSON.stringify(ICONS.close)};`,
    `var ICON_ARIA = ${JSON.stringify(ICONS.zap)};`,
    `var ICON_CHECK = ${JSON.stringify(ICONS.check)};`,
    ''
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>Music Fetch · 音乐下载</title>
<meta name="description" content="粘贴曲目信息文本，自动解析并生成下载链接，支持连续提交与多任务队列。" />
<style>${STYLES}</style>
</head>
<body>
  <div class="wrap">
    <header class="header">
      <div class="brand">
        <div class="brand-mark">${ICONS.music}</div>
        <div>
          <h1>Music Fetch</h1>
          <p>粘贴曲目信息 · 自动生成下载链接</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost" id="settings-btn" type="button">${ICONS.sliders}<span>设置</span></button>
      </div>
    </header>

    <section class="card panel" id="settings">
      <h3>运行设置</h3>

      <div class="panel-block">
        <div class="field" id="api-row">
          <label for="api-base">临时后端地址（调试用，留空则使用 Worker 环境变量）</label>
          <input id="api-base" type="url" placeholder="https://your-backend.example.com" autocomplete="off" />
          <small>仅在 Worker 开启 ALLOW_API_OVERRIDE 时生效，配置保存在本地浏览器。</small>
        </div>
        <div class="field">
          <label for="concurrency">最大并发处理数（1–5）</label>
          <input id="concurrency" type="number" min="1" max="5" step="1" value="${config.maxConcurrency}" />
          <small>等待期间可继续提交新文本，任务按顺序排队处理。</small>
        </div>
      </div>

      <div class="panel-block">
        <h4>Aria2 批量下载</h4>
        <p class="block-desc">启用后，队列工具栏会出现「批量下载」，通过 JSON-RPC 把已生成的链接一次性推送给 aria2。</p>
        <div class="switch-row">
          <div class="sr-text">
            <strong>启用 JSON-RPC 批量下载</strong>
            <small>浏览器直连 aria2 RPC，配置保存在本地浏览器</small>
          </div>
          <button class="switch" id="aria-enabled" type="button" role="switch" aria-checked="false" aria-label="启用 Aria2 批量下载"></button>
        </div>

        <div class="aria-only" id="aria-config">
          <div class="field">
            <label for="aria-endpoint">JSON-RPC 端点</label>
            <input id="aria-endpoint" type="url" placeholder="http://127.0.0.1:6800/jsonrpc" autocomplete="off" />
            <small>aria2 需带 <code>--enable-rpc --rpc-allow-origin-all</code> 启动。填写后自动检测连接，结果见下方状态。</small>
          </div>
          <div class="field">
            <label for="aria-secret">RPC 密钥（rpc-secret）</label>
            <input id="aria-secret" type="password" autocomplete="off" placeholder="未设置 --rpc-secret 时留空" />
          </div>
          <div class="field">
            <label for="aria-dir">下载目录（可选）</label>
            <input id="aria-dir" autocomplete="off" placeholder="留空则使用 aria2 默认目录" />
          </div>
          <div class="field">
            <label for="aria-referer">Referer 请求头（可选）</label>
            <input id="aria-referer" autocomplete="off" placeholder="留空则不发送 Referer" />
          </div>

          <div class="aria-status" id="aria-status" role="status" aria-live="polite"></div>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">
        <button class="btn btn-primary" id="save-settings" type="button">${ICONS.send}<span>保存设置</span></button>
      </div>
    </section>

    <section class="card composer">
      <textarea id="input" spellcheck="false" placeholder="在此粘贴曲目信息，例如：&#10;歌名：淘汰&#10;歌手：陈奕迅&#10;专辑：认了吧&#10;时长：04:45&#10;歌曲链接：https://...&#10;封面链接：https://...&#10;&#10;也支持直接粘贴 JSON，例如 {&quot;name&quot;:&quot;淘汰&quot;,&quot;artist&quot;:&quot;陈奕迅&quot;,&quot;url&quot;:&quot;https://...&quot;,&quot;duration&quot;:285}&#10;可一次粘贴多首，提交后可立即继续粘贴下一段。"></textarea>
      <div class="preview" id="preview">
        <div class="preview-title" id="preview-title">识别结果</div>
        <div class="preview-row" id="preview-row"></div>
      </div>
      <div class="composer-foot">
        <div class="hint">
          <button class="btn btn-ghost" id="sample" type="button">${ICONS.sparkles}<span>填入示例</span></button>
          <button class="btn btn-ghost" id="clear" type="button">清空</button>
        </div>
        <div class="hint"><kbd>⌘</kbd><kbd>Enter</kbd> 提交 · 支持批量粘贴</div>
        <button class="btn btn-primary" id="submit" type="button" disabled>${ICONS.download}<span>加入队列</span></button>
      </div>
    </section>

    <div class="toolbar">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <h2>下载队列</h2>
        <div class="stats" id="stats"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary hidden" id="batch-download" type="button" disabled>${ICONS.batch}<span>批量下载</span></button>
        <button class="btn btn-ghost" id="retry-failed" type="button" disabled>${ICONS.refresh}<span>重试失败</span></button>
        <button class="btn btn-ghost" id="clear-done" type="button" disabled>清除已完成</button>
      </div>
    </div>

    <div class="list" id="list"></div>

    <div class="empty show" id="empty">
      ${EMPTY_ART}
      <h3>队列还是空的</h3>
      <p>粘贴一段包含「歌名 / 歌手 / 专辑 / 歌曲链接 / 封面链接」的文本即可开始。</p>
    </div>
  </div>

  <div class="toasts" id="toasts"></div>

  <script>
    window.__APP_CONFIG__ = ${JSON.stringify(config)};
  </script>
  <script>
${runtime}${CLIENT_JS}
  </script>
</body>
</html>`;
}

function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
