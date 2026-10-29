/**
 * 页面样式（作为字符串内联进 HTML，随 Worker 一起部署，无需额外静态资源）
 */
export const STYLES = `
*, *::before, *::after { box-sizing: border-box; }

:root {
  --bg: #f5f7fc;
  --glow-1: rgba(99, 122, 255, .28);
  --glow-2: rgba(34, 199, 232, .22);
  --surface: rgba(255, 255, 255, .72);
  --surface-solid: #ffffff;
  --surface-soft: #f2f5fb;
  --border: rgba(15, 23, 42, .08);
  --border-strong: rgba(15, 23, 42, .14);
  --text: #0f172a;
  --text-2: #5c6880;
  --text-3: #94a0b4;
  --brand: #4f6bff;
  --brand-2: #22c7e8;
  --brand-soft: rgba(79, 107, 255, .10);
  --ok: #12b981;
  --ok-soft: rgba(18, 185, 129, .12);
  --warn: #f59e0b;
  --warn-soft: rgba(245, 158, 11, .13);
  --err: #ef4444;
  --err-soft: rgba(239, 68, 68, .11);
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, .05);
  --shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 10px 30px -12px rgba(15, 23, 42, .18);
  --radius: 18px;
  --radius-sm: 12px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a0e1a;
    --glow-1: rgba(88, 110, 255, .30);
    --glow-2: rgba(34, 199, 232, .18);
    --surface: rgba(23, 29, 45, .68);
    --surface-solid: #151b29;
    --surface-soft: #1c2334;
    --border: rgba(148, 163, 184, .14);
    --border-strong: rgba(148, 163, 184, .26);
    --text: #e9eefb;
    --text-2: #a3aec6;
    --text-3: #6f7c94;
    --brand: #6b83ff;
    --brand-2: #38d6f0;
    --brand-soft: rgba(107, 131, 255, .16);
    --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 12px 32px -14px rgba(0, 0, 0, .6);
  }
}

html, body { height: 100%; }

body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body::before {
  content: "";
  position: fixed;
  inset: -20% -10% auto -10%;
  height: 70vh;
  background:
    radial-gradient(45% 55% at 20% 30%, var(--glow-1), transparent 70%),
    radial-gradient(40% 50% at 78% 12%, var(--glow-2), transparent 72%);
  filter: blur(20px);
  pointer-events: none;
  z-index: 0;
}

.wrap {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 40px 20px 80px;
}

/* ---------- Header ---------- */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 26px;
}

.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }

.brand-mark {
  width: 42px; height: 42px;
  flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 13px;
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
  box-shadow: 0 10px 24px -10px rgba(79, 107, 255, .75);
  color: #fff;
}

.brand-mark svg { width: 22px; height: 22px; }

.brand h1 {
  margin: 0;
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -.01em;
  white-space: nowrap;
}

.brand p {
  margin: 1px 0 0;
  font-size: 12.5px;
  color: var(--text-3);
}

.header-actions { display: flex; align-items: center; gap: 8px; }

/* ---------- Buttons ---------- */
.btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  font: inherit;
  font-size: 13.5px;
  font-weight: 550;
  color: var(--text);
  padding: 8px 14px;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  transition: transform .12s ease, background .16s ease, border-color .16s ease, box-shadow .16s ease, opacity .16s ease;
  white-space: nowrap;
}

.btn:active { transform: translateY(1px); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn svg { width: 15px; height: 15px; flex: 0 0 auto; }

.btn-ghost { background: var(--surface); border-color: var(--border); color: var(--text-2); }
.btn-ghost:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text); background: var(--surface-solid); }

.btn-primary {
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
  color: #fff;
  padding: 10px 20px;
  box-shadow: 0 10px 22px -12px rgba(79, 107, 255, .9);
}
.btn-primary:hover:not(:disabled) { filter: brightness(1.06); box-shadow: 0 14px 26px -12px rgba(79, 107, 255, .95); }

.btn-ok { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.btn-ok:hover:not(:disabled) { background: var(--ok); color: #fff; }

.btn-danger { background: var(--err-soft); color: var(--err); border-color: transparent; }
.btn-danger:hover:not(:disabled) { background: var(--err); color: #fff; }

.btn-icon { padding: 9px; border-radius: 10px; }

/* ---------- Card ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
}

.composer { padding: 16px; margin-bottom: 22px; }

.composer textarea {
  width: 100%;
  min-height: 148px;
  resize: vertical;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14.5px;
  line-height: 1.7;
  padding: 6px 8px;
}

.composer textarea::placeholder { color: var(--text-3); }

.composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 8px 4px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}

.hint { font-size: 12.5px; color: var(--text-3); display: flex; align-items: center; gap: 8px; }

kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--surface-soft);
  color: var(--text-2);
}

/* ---------- Preview ---------- */
.preview {
  margin: 4px 8px 0;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  border: 1px dashed var(--border-strong);
  display: none;
}
.preview.show { display: block; animation: fadeUp .22s ease; }
.preview-title { font-size: 12px; font-weight: 600; color: var(--text-3); letter-spacing: .04em; margin-bottom: 8px; }
.preview-row { display: flex; flex-wrap: wrap; gap: 6px; }

.chip {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip.missing { background: var(--err-soft); color: var(--err); }
.chip.url { background: var(--surface-solid); color: var(--text-2); }

/* ---------- Toolbar ---------- */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.toolbar h2 { margin: 0; font-size: 15px; font-weight: 620; }

.stats { display: flex; gap: 6px; flex-wrap: wrap; }

.stat {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-2);
}
.stat b { color: var(--text); font-weight: 620; }
.stat.is-run b { color: var(--brand); }
.stat.is-done b { color: var(--ok); }
.stat.is-err b { color: var(--err); }

/* ---------- Task list ---------- */
.list { display: flex; flex-direction: column; gap: 10px; }

.task {
  display: grid;
  grid-template-columns: 54px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 13px 14px;
  border-radius: 16px;
  background: var(--surface-solid);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  animation: fadeUp .26s ease;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.task:hover { border-color: var(--border-strong); box-shadow: var(--shadow); }
.task.is-done { border-color: rgba(18, 185, 129, .28); }
.task.is-error { border-color: rgba(239, 68, 68, .28); }
.task.is-running { border-color: rgba(79, 107, 255, .30); }

.cover {
  width: 54px; height: 54px;
  border-radius: 12px;
  object-fit: cover;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  display: block;
}
.cover-fallback {
  width: 54px; height: 54px;
  border-radius: 12px;
  display: grid; place-items: center;
  background: linear-gradient(135deg, var(--brand-soft), var(--surface-soft));
  color: var(--brand);
}
.cover-fallback svg { width: 22px; height: 22px; }

.task-main { min-width: 0; }

.task-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  font-size: 12.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.task-msg {
  font-size: 12px;
  margin-top: 4px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-msg.is-err { color: var(--err); }

.task-side { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

.badge {
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.badge-run { background: var(--brand-soft); color: var(--brand); }
.badge-queue { background: var(--surface-soft); color: var(--text-2); border: 1px solid var(--border); }
.badge-done { background: var(--ok-soft); color: var(--ok); }
.badge-err { background: var(--err-soft); color: var(--err); }
.badge-out { background: var(--warn-soft); color: var(--warn); }

.dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dot.pulse { animation: pulse 1.1s ease-in-out infinite; }

.bar {
  grid-column: 1 / -1;
  height: 3px;
  border-radius: 999px;
  background: var(--surface-soft);
  overflow: hidden;
  position: relative;
}
.bar > i {
  position: absolute;
  inset: 0 auto 0 0;
  width: 38%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--brand), var(--brand-2));
  animation: slide 1.25s ease-in-out infinite;
}

.expire { font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.expire.soon { color: var(--warn); }

/* ---------- Empty ---------- */
.empty {
  display: none;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px 24px 52px;
  color: var(--text-3);
}
.empty.show { display: flex; }
.empty svg { width: 92px; height: 92px; opacity: .85; margin-bottom: 14px; }
.empty h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; color: var(--text-2); }
.empty p { margin: 0; font-size: 13px; max-width: 320px; }

/* ---------- Settings panel ---------- */
.panel {
  display: none;
  padding: 16px;
  margin-bottom: 18px;
}
.panel.show { display: block; animation: fadeUp .2s ease; }
.panel h3 { margin: 0 0 12px; font-size: 13.5px; font-weight: 620; }
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 12.5px; color: var(--text-2); margin-bottom: 5px; font-weight: 550; }
.field input {
  width: 100%;
  padding: 9px 12px;
  font: inherit;
  font-size: 13.5px;
  color: var(--text);
  background: var(--surface-solid);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  outline: none;
  transition: border-color .16s ease, box-shadow .16s ease;
}
.field input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.field small { display: block; margin-top: 5px; font-size: 11.5px; color: var(--text-3); }

/* ---------- Toast ---------- */
.toasts {
  position: fixed;
  right: 18px; bottom: 18px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}
.toast {
  background: var(--surface-solid);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text);
  max-width: 340px;
  animation: fadeUp .2s ease;
  display: flex; align-items: center; gap: 8px;
}
.toast.err { border-color: rgba(239, 68, 68, .35); color: var(--err); }
.toast.ok { border-color: rgba(18, 185, 129, .35); }

@keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
@keyframes slide { 0% { left: -40%; } 100% { left: 100%; } }

/* ---------- Settings blocks ---------- */
.panel-block + .panel-block {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.panel-block h4 { margin: 0 0 4px; font-size: 13.5px; font-weight: 620; }
.block-desc { margin: 0 0 12px; font-size: 12px; color: var(--text-3); line-height: 1.55; }

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  margin-bottom: 12px;
}
.switch-row strong { display: block; font-size: 13.5px; font-weight: 600; }
.switch-row small { display: block; font-size: 11.5px; color: var(--text-3); margin-top: 1px; }

.switch {
  position: relative;
  width: 44px; height: 26px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--border-strong);
  cursor: pointer;
  transition: background .18s ease;
}
.switch::after {
  content: "";
  position: absolute;
  top: 3px; left: 3px;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .28);
  transition: transform .18s ease;
}
.switch[aria-checked="true"] { background: linear-gradient(135deg, var(--brand), var(--brand-2)); }
.switch[aria-checked="true"]::after { transform: translateX(18px); }

.hidden { display: none !important; }
.aria-only { display: none; }
.aria-only.show { display: block; animation: fadeUp .2s ease; }

.spinner {
  width: 14px; height: 14px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, .45);
  border-top-color: #fff;
  animation: spin .7s linear infinite;
}
.btn-ghost .spinner { border-color: var(--border-strong); border-top-color: var(--brand); }

.badge svg { width: 12px; height: 12px; flex: 0 0 auto; }
.badge-push { background: var(--brand-soft); color: var(--brand); }

/* Aria2 自动连接检测状态条 */
.aria-status {
  display: none;
  align-items: flex-start;
  gap: 8px;
  margin-top: 4px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.5;
}
.aria-status.show { display: flex; animation: fadeUp .2s ease; }
.aria-status svg { width: 14px; height: 14px; flex: 0 0 auto; margin-top: 2px; }
.aria-status .spinner { margin-top: 2px; border-color: var(--border-strong); border-top-color: var(--brand); }
.aria-status.is-ok {
  background: var(--ok-soft);
  border-color: rgba(18, 185, 129, .28);
  color: var(--ok);
}
.aria-status.is-err {
  background: var(--err-soft);
  border-color: rgba(239, 68, 68, .28);
  color: var(--err);
}
.task-note { font-size: 11.5px; color: var(--text-3); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

@media (max-width: 620px) {
  .wrap { padding: 28px 14px 64px; }
  .task { grid-template-columns: 46px 1fr; row-gap: 10px; }
  .cover, .cover-fallback { width: 46px; height: 46px; }
  .task-side { grid-column: 1 / -1; justify-content: flex-end; }
  .header p { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;
