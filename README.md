# Music Fetch · 音乐下载前端

一个可部署在 **Cloudflare Worker** 上的单页应用：粘贴曲目信息文本 → 前端解析出核心参数 → 由 Worker 代理转发给真实后端 → 后端返回下载链接后，页面在对应卡片上显示下载按钮。

等待期间可以继续粘贴下一段文本，任务按提交顺序排队、并发处理，谁的链接先就绪谁先出现下载按钮。

## 目录结构

```
.
├── package.json          # 脚本：dev / deploy / typecheck
├── wrangler.jsonc        # Worker 配置与环境变量
├── tsconfig.json
├── .dev.vars.example     # 本地开发变量模板（复制为 .dev.vars）
└── src/
    ├── index.ts          # Worker 入口：页面托管 + /api/process 代理
    ├── page.ts           # HTML 页面骨架、图标、配置注入
    ├── styles.ts         # 内联 CSS（含浅色/深色自适应）
    └── client.ts         # 浏览器端脚本：文本解析、任务队列、下载
```

页面、样式、脚本全部内联，无需额外的静态资源目录或 `assets` 配置，构建产物约 49 KiB（gzip 后约 15 KiB）。

## 环境变量

| 变量                 | 必填 | 默认值     | 说明                                                                                                         |
| -------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `API_BASE_URL`       | 是   | —          | 后端根地址，如 `https://api.example.com`。建议用 secret 配置，不放进 `wrangler.jsonc`（避免与 var 同名冲突） |
| `API_PATH`           | 否   | `/process` | 拼接在 `API_BASE_URL` 之后的路径；填 `/` 表示直接打根地址                                                    |
| `API_TOKEN`          | 否   | —          | 配置后 Worker 会附带 `Authorization: Bearer <token>`                                                         |
| `API_TIMEOUT_MS`     | 否   | `120000`   | 代理请求超时（毫秒），上限 300000                                                                            |
| `MAX_CONCURRENCY`    | 否   | `2`        | 单页面最大并发处理数（1–5），页面设置里可覆盖                                                                |
| `ALLOW_API_OVERRIDE` | 否   | `true`     | 是否允许页面临时覆盖后端地址。**生产环境务必设为 `false`**，否则存在 SSRF 风险                               |

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入真实的 API_BASE_URL
npm run dev                       # 默认 http://127.0.0.1:8787
```

没有真实后端时，可以先起一个假后端验证链路：它对 `/process` 延迟若干秒后返回 `{ code: 202, data: { file_url: "..." } }`，再把 `API_BASE_URL` 指向它，即可完整体验排队与下载按钮出现的流程。

## 部署

```bash
npx wrangler secret put API_BASE_URL   # 生产后端地址
npx wrangler secret put API_TOKEN      # 若后端需要鉴权
# 把 wrangler.jsonc 里的 ALLOW_API_OVERRIDE 改为 "false"
npm run deploy
```

类型检查：`npm run typecheck`。

## 接口契约

### 前端 → Worker：`POST /api/process`

```json
{
  "file_url": "https://m701.music.126.net/.../ca2003353ec616817610ce4191b03290.flac",
  "cover_url": "https://p2.music.126.net/.../109951168959882340.jpg",
  "title": "Asylums for the Feeling",
  "artist": "Silent Poets, Leila Adu",
  "album": "Death Stranding (Songs from the Video Game)"
}
```

覆盖后端地址时额外带请求头 `x-api-base-url`（仅 `ALLOW_API_OVERRIDE=true` 生效）。

### Worker → 后端

同样以 `POST` + JSON 转发到 `API_BASE_URL + API_PATH`，附带 `Authorization`（若配置了 `API_TOKEN`）。

### Worker → 前端

成功：

```json
{
  "ok": true,
  "code": 202,
  "message": "FLAC file modified successfully",
  "file_url": "https://.../xxx.flac?X-Amz-Expires=600&..."
}
```

下载链接从后端响应里按 `data.file_url` → `data`（字符串）→ `file_url` → `url` 的顺序提取，兼容多种返回结构。

失败：HTTP 状态码 + `{ "ok": false, "error": "..." }`，其中 400 为入参问题、500 为 Worker 未配置后端、502 为后端返回异常、504 为超时或不可达。

## Aria2 批量下载（JSON-RPC）

开关位置：设置面板 → **Aria2 批量下载**，默认关闭。开启后才会显示配置项、测试按钮与队列工具栏的「批量下载」。

| 配置项 | 说明 |
| --- | --- |
| JSON-RPC 端点 | 默认 `http://127.0.0.1:6800/jsonrpc` |
| RPC 密钥 | 对应 `--rpc-secret`，作为 JSON-RPC 首个参数 `token:<secret>` 传入；未设置时留空，则不发送该参数 |
| 下载目录 | 对应 `aria2.addUri` 的 `dir` 选项，留空则使用 aria2 默认目录 |
| Referer | 通过 `header` 选项发送，留空则不发送 |

调用过程（浏览器直连，不经过 Worker）：

1. 「测试 Aria2 连接」调用 `aria2.getVersion`，回显 aria2 版本号。
2. 工具栏「批量下载 (n)」中的 n 是**可推送数量**（已完成、未过期、尚未推送过的任务）。
3. 点击后按队列顺序**串行**调用 `aria2.addUri`，逐个更新结果，避免瞬间向 aria2 灌入大量请求。
4. 每个任务通过 `out` 参数指定文件名 `标题 - 歌手.扩展名`，避免 aria2 用 URL 哈希串命名。
5. 推送成功后卡片显示「已加入 aria2」徽章（悬停可见 GID），仍保留「浏览器下载」；失败的任务在消息行红字显示原因，修复后可再次推送。
6. 单曲也可单独推送：已完成任务卡片上的 ⚡ 按钮。

### 前置条件

- aria2 需带 `--enable-rpc --rpc-allow-origin-all` 启动（跨机访问再加 `--rpc-listen-all`），否则浏览器的同源策略会拦截请求，表现为「连接失败」。
- 页面为 https 而 aria2 为 `http://127.0.0.1` 时，Chrome / Edge / Firefox 视 localhost 为可信来源而放行，**Safari 可能按混合内容策略拦截**。如遇拦截，可改用 http 访问页面，或给 aria2 套一层 https 反向代理。
- RPC 端点、密钥等配置保存在浏览器 `localStorage`，不会上传到 Worker。

## 文本解析规则

按行匹配 `标签: 值`（支持中英文冒号，标签前后允许空格、`-`/`*` 项目符号）。识别的标签：

| 字段        | 标签                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `title`     | 歌名 / 曲名 / 歌曲名 / 标题 / 曲目 / title / name                           |
| `artist`    | 歌手 / 艺人 / 演唱(者) / artist(s) / singer                                 |
| `album`     | 专辑 / 唱片 / album                                                         |
| `file_url`  | 歌曲链接 / 下载链接 / 文件链接 / 音乐链接 / 音频链接 / file_url / url / src |
| `cover_url` | 封面链接 / 封面 / 图片 / cover_url / cover / pic                            |

其它行（时长、来源、歌曲 ID、文件大小、音质等）自动忽略。整行是链接时会按扩展名兜底判断是音频还是封面。

**多首拆分**：优先按空行分段；若整段没有空行，则按 `歌名：` 出现的位置切分，因此一次粘贴多首也能识别为多个任务。

`file_url` 为必填，缺失时该条会被拒绝并提示原因；`title` 缺失时回退为从链接文件名推断。

## 页面行为

- **连续提交**：提交后立即清空输入框并聚焦，可直接粘贴下一段。支持 `⌘/Ctrl + Enter` 提交。
- **实时预览**：输入时实时显示识别结果，缺字段的条目标红。
- **队列卡片**：展示封面（无封面时显示占位图标）、标题、歌手 · 专辑、状态徽章与进度条。
- **下载**：优先取回 blob 落盘以保留文件名；若对象存储未放行 CORS，则回退到新标签页。同时提供「复制链接」。
- **批量下载**：开启 Aria2 后可用，见上一节。
- **有效期**：从链接的 `X-Amz-Expires` 推断有效期并倒计时，过期后按钮变为「重新生成」，可一键用原文本重提。
- **本地留存**：已完成/失败的任务写入 `localStorage`（最多 50 条），刷新后可继续下载，过期项自动标记。

## 待确认

- 真实后端的地址、路径与鉴权方式（当前按 `POST {base}/process` 实现，可通过 `API_PATH`、`API_TOKEN` 调整）。
- 后端是否需要额外字段（如音质、来源平台、歌曲 ID），当前只转发约定的 5 个参数。
