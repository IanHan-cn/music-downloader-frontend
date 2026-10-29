/**
 * 浏览器端脚本（以字符串形式内联，随 HTML 一起返回）
 * 注意：这里用 String.raw 包裹，内部不使用模板字面量，避免转义与插值冲突。
 */
export const CLIENT_JS = String.raw`
(function () {
  'use strict';

  var CONFIG = window.__APP_CONFIG__ || {};
  var STORE_KEY = 'mfw.tasks.v1';
  var PREF_KEY = 'mfw.prefs.v1';
  var UNKNOWN_TITLE = '未命名音轨';
  var UNKNOWN_ARTIST = '未知歌手';

  var prefs = loadPrefs();
  var concurrency = clampInt(prefs.concurrency || CONFIG.maxConcurrency || 2, 1, 5, 2);
  var apiOverride = prefs.apiBaseUrl || '';
  var allowOverride = CONFIG.allowApiOverride === true;
  var tasks = [];
  var batchBusy = false;

  var aria = {
    enabled: (prefs.aria && prefs.aria.enabled) === true,
    endpoint: (prefs.aria && prefs.aria.endpoint) || 'http://127.0.0.1:6800/jsonrpc',
    secret: (prefs.aria && prefs.aria.secret) || '',
    dir: (prefs.aria && prefs.aria.dir) || '',
    referer: (prefs.aria && prefs.aria.referer) || ''
  };

  /* ---------------- DOM ---------------- */
  var el = {
    input: document.getElementById('input'),
    preview: document.getElementById('preview'),
    previewRow: document.getElementById('preview-row'),
    previewTitle: document.getElementById('preview-title'),
    submit: document.getElementById('submit'),
    clear: document.getElementById('clear'),
    sample: document.getElementById('sample'),
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    stats: document.getElementById('stats'),
    clearDone: document.getElementById('clear-done'),
    retryFailed: document.getElementById('retry-failed'),
    batch: document.getElementById('batch-download'),
    settingsBtn: document.getElementById('settings-btn'),
    settings: document.getElementById('settings'),
    apiInput: document.getElementById('api-base'),
    apiRow: document.getElementById('api-row'),
    concInput: document.getElementById('concurrency'),
    saveSettings: document.getElementById('save-settings'),
    ariaSwitch: document.getElementById('aria-enabled'),
    ariaConfig: document.getElementById('aria-config'),
    ariaEndpoint: document.getElementById('aria-endpoint'),
    ariaSecret: document.getElementById('aria-secret'),
    ariaDir: document.getElementById('aria-dir'),
    ariaReferer: document.getElementById('aria-referer'),
    ariaTest: document.getElementById('aria-test'),
    toasts: document.getElementById('toasts')
  };

  /* ---------------- 文本解析 ---------------- */
  var RULES = [
    { key: 'title', re: /^(?:歌\s*名|曲\s*名|歌曲\s*名|标\s*题|曲\s*目|title|name)$/i },
    { key: 'artist', re: /^(?:歌\s*手|艺\s*人|演\s*唱(?:者)?|artists?|singer)$/i },
    { key: 'album', re: /^(?:专\s*辑|唱\s*片|album)$/i },
    { key: 'file_url', re: /^(?:歌曲\s*链接|下\s*载\s*链\s*接|文\s*件\s*链\s*接|音\s*乐\s*链\s*接|音频\s*链接|file[_-]?url|url|src)$/i, url: true },
    { key: 'cover_url', re: /^(?:封面\s*链接|封\s*面|图\s*片|cover[_-]?url|cover|pic|picurl)$/i, url: true }
  ];

  function isUrl(v) { return typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()); }
  function safeUrl(v) { return isUrl(v) ? v.trim() : ''; }

  function splitBlocks(text) {
    var raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return [];
    var parts = raw.split(/\n\s*\n+/).filter(function (p) { return p.trim(); });
    if (parts.length <= 1) {
      var byTitle = raw.split(/(?=^\s*(?:歌\s*名|曲\s*名|标\s*题|title)\s*[:：])/im);
      var kept = [];
      for (var i = 0; i < byTitle.length; i++) { if (byTitle[i].trim()) kept.push(byTitle[i]); }
      if (kept.length > 1) parts = kept;
    }
    return parts.map(function (p) { return p.trim(); });
  }

  function parseBlock(block) {
    var out = { title: '', artist: '', album: '', file_url: '', cover_url: '', raw: block };
    var lines = block.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || !line.trim()) continue;
      var m = line.match(/^\s*[-\u2022*]?\s*([^:\n：]{1,16})\s*[:：]\s*(.+?)\s*$/);
      if (!m) {
        // 兜底：整行是一条链接时，按顺序补 file_url / cover_url
        var only = line.trim();
        if (isUrl(only)) {
          if (/m\d+\.music\.126\.net|\.(flac|mp3|m4a|wav|ogg|ape|opus)(\?|$)/i.test(only)) {
            if (!out.file_url) out.file_url = safeUrl(only);
          } else if (!out.cover_url && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(only)) {
            out.cover_url = safeUrl(only);
          }
        }
        continue;
      }
      var label = m[1].trim();
      var value = m[2].trim();
      for (var j = 0; j < RULES.length; j++) {
        var r = RULES[j];
        if (!r.re.test(label)) continue;
        if (r.url) {
          if (isUrl(value) && !out[r.key]) out[r.key] = safeUrl(value);
        } else if (!out[r.key]) {
          out[r.key] = value;
        }
        break;
      }
    }
    return out;
  }

  function parseText(text) {
    var blocks = splitBlocks(text);
    var songs = [];
    for (var i = 0; i < blocks.length; i++) {
      var s = parseBlock(blocks[i]);
      if (!s.file_url && !s.title) continue;
      songs.push(s);
    }
    return songs;
  }

  function validate(song) {
    if (!song.file_url) return '未解析到「歌曲链接」，请检查文本是否包含可下载的音频地址';
    return '';
  }

  /* ---------------- 任务队列 ---------------- */
  function enqueue(songs) {
    var added = 0, skipped = 0;
    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      var err = validate(s);
      if (err) { toast(s.title ? '《' + s.title + '》：' + err : err, 'err'); skipped++; continue; }
      tasks.push({
        id: uid(),
        title: s.title || guessName(s.file_url) || UNKNOWN_TITLE,
        artist: s.artist || UNKNOWN_ARTIST,
        album: s.album || '',
        cover_url: s.cover_url || '',
        file_url: s.file_url,
        raw: s.raw || '',
        status: 'queued',
        download_url: '',
        message: '排队中',
        createdAt: Date.now(),
        expireAt: 0,
        expired: false
      });
      added++;
    }
    if (added) {
      render();
      save();
      pump();
    }
    return { added: added, skipped: skipped };
  }

  function pump() {
    var running = 0, i;
    for (i = 0; i < tasks.length; i++) if (tasks[i].status === 'running') running++;
    for (i = 0; i < tasks.length && running < concurrency; i++) {
      if (tasks[i].status === 'queued') { running++; runTask(tasks[i]); }
    }
  }

  function runTask(t) {
    t.status = 'running';
    t.message = '已提交，等待后端生成链接…';
    render();

    var payload = {
      file_url: t.file_url,
      cover_url: t.cover_url,
      title: t.title === UNKNOWN_TITLE ? '' : t.title,
      artist: t.artist === UNKNOWN_ARTIST ? '' : t.artist,
      album: t.album
    };
    var headers = { 'content-type': 'application/json' };
    if (allowOverride && apiOverride) headers['x-api-base-url'] = apiOverride;

    fetch('/api/process', { method: 'POST', headers: headers, body: JSON.stringify(payload) })
      .then(function (res) {
        return res.json().catch(function () {
          return { ok: false, error: '后端返回内容无法解析（HTTP ' + res.status + '）' };
        });
      })
      .then(function (data) {
        if (data && data.ok && data.file_url) {
          t.status = 'done';
          t.download_url = data.file_url;
          t.message = data.message || '处理完成，可以下载了';
          t.expireAt = Date.now() + ttlFromUrl(data.file_url) * 1000;
          t.expired = false;
          toast('《' + t.title + '》下载链接已生成', 'ok');
        } else {
          t.status = 'error';
          t.message = (data && data.error) || '后端未返回下载链接';
          toast('《' + t.title + '》处理失败', 'err');
        }
      })
      .catch(function (err) {
        t.status = 'error';
        t.message = '请求失败：' + (err && err.message ? err.message : String(err));
        toast('《' + t.title + '》请求失败', 'err');
      })
      .then(function () {
        render();
        save();
        pump();
      });
  }

  function retry(id) {
    var t = find(id);
    if (!t) return;
    if (t.raw) {
      var songs = parseText(t.raw);
      if (songs.length && !validate(songs[0])) {
        t.file_url = songs[0].file_url;
        t.cover_url = songs[0].cover_url;
      }
    }
    t.status = 'queued';
    t.message = '排队中';
    t.expired = false;
    t.pushed = false;
    t.gid = '';
    t.pushError = '';
    render();
    pump();
  }

  function remove(id) {
    tasks = tasks.filter(function (t) { return t.id !== id; });
    render();
    save();
  }

  function clearFinished() {
    tasks = tasks.filter(function (t) { return t.status === 'queued' || t.status === 'running'; });
    render();
    save();
  }

  function retryFailed() {
    var n = 0;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].status === 'error' || tasks[i].expired) { tasks[i].status = 'queued'; tasks[i].expired = false; n++; }
    }
    if (n) { render(); pump(); }
    toast(n ? '已重新提交 ' + n + ' 个任务' : '没有可重试的任务', n ? 'ok' : 'err');
  }

  /* ---------------- 下载 ---------------- */
  function buildFileName(t) {
    var name = (t.title && t.title !== UNKNOWN_TITLE ? t.title : 'track');
    if (t.artist && t.artist !== UNKNOWN_ARTIST) name = name + ' - ' + t.artist;
    var ext = extFromUrl(t.download_url || t.file_url) || 'flac';
    return sanitize(name) + '.' + ext;
  }

  function triggerDownload(t) {
    if (!t.download_url) return;
    if (t.expired || (t.expireAt && Date.now() > t.expireAt)) { toast('链接已过期，请重新提交', 'err'); return; }
    if (t.busy) return;

    var name = buildFileName(t);
    t.busy = true;
    render();

    // 跨源链接上 a[download] 会被浏览器忽略，因此优先取回 blob 再落盘，
    // 若对象存储未放行 CORS，则回退到新标签页交给浏览器处理。
    fetch(t.download_url, { mode: 'cors', credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        saveBlob(blob, name);
        toast('已开始下载：' + name, 'ok');
      })
      .catch(function () {
        var win = window.open(t.download_url, '_blank', 'noopener');
        if (win) toast('已在新标签页开始下载：' + name, 'ok');
        else toast('请点击「复制链接」手动下载', 'err');
      })
      .then(function () {
        t.busy = false;
        render();
      });
  }

  function saveBlob(blob, name) {
    var objUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = objUrl;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(objUrl); }, 30000);
  }

  function copyLink(t) {
    var text = t.download_url || t.file_url;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('链接已复制到剪贴板', 'ok'); }, fallbackCopy);
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('链接已复制到剪贴板', 'ok'); }
      catch (e) { toast('复制失败，请手动选择链接', 'err'); }
      ta.remove();
    }
  }

  /* ---------------- Aria2 JSON-RPC ---------------- */
  function withSecret(params) {
    return aria.secret ? ['token:' + aria.secret].concat(params) : params;
  }

  function aria2Call(method, params) {
    var body = JSON.stringify({ jsonrpc: '2.0', id: uid(), method: method, params: params || [] });
    return fetch(aria.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().catch(function () { throw new Error('aria2 返回的不是 JSON'); });
      })
      .then(function (data) {
        if (!data) throw new Error('aria2 返回内容为空');
        if (data.error) throw new Error(data.error.message || 'aria2 返回错误');
        return data.result;
      });
  }

  function aria2Options(t) {
    var opts = { out: buildFileName(t) };
    if (aria.dir) opts.dir = aria.dir;
    if (aria.referer) opts.header = ['Referer: ' + aria.referer];
    return opts;
  }

  function aria2Add(t) {
    return aria2Call('aria2.addUri', withSecret([[t.download_url], aria2Options(t)]));
  }

  function canPush(t) {
    if (!aria.enabled) return false;
    if (t.status !== 'done' || !t.download_url) return false;
    if (t.expired || (t.expireAt && Date.now() > t.expireAt)) return false;
    return !t.pushed;
  }

  function pushable() {
    return tasks.filter(function (t) { return canPush(t); });
  }

  function pushOne(t) {
    if (t.busy) return;
    t.busy = true;
    render();
    aria2Add(t)
      .then(function (gid) {
        t.pushed = true;
        t.gid = gid || '';
        t.pushError = '';
        toast('已加入 aria2：' + buildFileName(t), 'ok');
      })
      .catch(function (err) {
        t.pushError = msgOf(err);
        toast('推送失败：' + msgOf(err), 'err');
      })
      .then(function () {
        t.busy = false;
        render();
        save();
        renderStats();
      });
  }

  // 串行推送，避免瞬间向 aria2 灌入大量请求
  function pushBatch() {
    if (batchBusy) return;
    var queue = pushable();
    if (!queue.length) {
      toast('暂无可推送的任务（需先生成下载链接）', 'err');
      return;
    }
    batchBusy = true;
    renderStats();
    render();

    var okCount = 0;
    var failed = [];

    (function next() {
      if (!queue.length) {
        batchBusy = false;
        render();
        renderStats();
        toast(failed.length
          ? '推送完成：成功 ' + okCount + ' 个，失败 ' + failed.length + ' 个'
          : '已把 ' + okCount + ' 个任务加入 aria2', failed.length ? 'err' : 'ok');
        return;
      }
      var t = queue.shift();
      aria2Add(t)
        .then(function (gid) { t.pushed = true; t.gid = gid || ''; t.pushError = ''; okCount++; })
        .catch(function (err) { t.pushError = msgOf(err); failed.push(t); })
        .then(function () { render(); save(); next(); });
    })();
  }

  function testAria2() {
    el.ariaTest.disabled = true;
    setBusyLabel(el.ariaTest, true);
    aria2Call('aria2.getVersion', withSecret([]))
      .then(function (res) {
        toast('连接成功 · aria2 ' + ((res && res.version) || ''), 'ok');
      })
      .catch(function (err) {
        toast('连接失败：' + msgOf(err) + ' · 请确认已开启 --rpc-allow-origin-all', 'err');
      })
      .then(function () {
        el.ariaTest.disabled = false;
        setBusyLabel(el.ariaTest, false);
      });
  }

  function setBusyLabel(btn, busy) {
    var span = btn.querySelector('span');
    var old = btn.querySelector('.spinner');
    if (old) old.remove();
    if (busy) {
      var sp = document.createElement('span');
      sp.className = 'spinner';
      btn.insertBefore(sp, span);
    }
    if (span) span.textContent = busy ? '测试中…' : '测试 Aria2 连接';
  }

  function applyAriaUI() {
    el.ariaSwitch.setAttribute('aria-checked', aria.enabled ? 'true' : 'false');
    el.ariaConfig.classList.toggle('show', aria.enabled);
    el.ariaTest.classList.toggle('hidden', !aria.enabled);
    el.batch.classList.toggle('hidden', !aria.enabled);
  }

  function persistAria() {
    aria.endpoint = (el.ariaEndpoint.value || '').trim();
    aria.secret = (el.ariaSecret.value || '').trim();
    aria.dir = (el.ariaDir.value || '').trim();
    aria.referer = (el.ariaReferer.value || '').trim();
    prefs.aria = {
      enabled: aria.enabled,
      endpoint: aria.endpoint,
      secret: aria.secret,
      dir: aria.dir,
      referer: aria.referer
    };
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var html = '';
    for (var i = 0; i < tasks.length; i++) html += renderTask(tasks[i]);
    el.list.innerHTML = html;
    el.empty.classList.toggle('show', tasks.length === 0);
    renderStats();
  }

  function renderStats() {
    var s = { queued: 0, running: 0, done: 0, error: 0 };
    for (var i = 0; i < tasks.length; i++) s[tasks[i].status]++;
    el.stats.innerHTML =
      '<span class="stat">共 <b>' + tasks.length + '</b></span>' +
      '<span class="stat is-run">处理中 <b>' + (s.running + s.queued) + '</b></span>' +
      '<span class="stat is-done">已完成 <b>' + s.done + '</b></span>' +
      '<span class="stat is-err">失败 <b>' + s.error + '</b></span>';
    el.clearDone.disabled = s.done + s.error === 0;
    el.retryFailed.disabled = s.error === 0;

    if (aria.enabled) {
      var pend = pushable().length;
      el.batch.disabled = batchBusy || pend === 0;
      var label = el.batch.querySelector('span');
      if (label) label.textContent = batchBusy ? '推送中…' : ('批量下载' + (pend ? ' (' + pend + ')' : ''));
    }
  }

  function renderTask(t) {
    var cls = 'task' + (t.status === 'done' ? ' is-done' : t.status === 'error' ? ' is-error' : t.status === 'running' ? ' is-running' : '');
    var cover = t.cover_url
      ? '<img class="cover" src="' + esc(t.cover_url) + '" alt="cover" loading="lazy" referrerpolicy="no-referrer" />'
      : '<div class="cover-fallback">' + ICON_MUSIC + '</div>';

    var side = '';
    if (t.status === 'queued') side = '<span class="badge badge-queue"><i class="dot"></i>排队中</span>' + actionBtn(t.id, 'remove', '移除', 'btn-ghost btn-icon', ICON_X);
    else if (t.status === 'running') side = '<span class="badge badge-run"><i class="dot pulse"></i>生成中</span>' + actionBtn(t.id, 'remove', '移除', 'btn-ghost btn-icon', ICON_X);
    else if (t.status === 'done') {
      if (t.expired || (t.expireAt && Date.now() > t.expireAt)) {
        side = '<span class="badge badge-out">链接已过期</span>' + actionBtn(t.id, 'retry', '重新生成', 'btn-ok', ICON_REFRESH) + actionBtn(t.id, 'remove', '移除', 'btn-ghost btn-icon', ICON_X);
      } else if (t.pushed) {
        side = '<span class="badge badge-push" title="GID: ' + esc(t.gid || '-') + '">' + ICON_CHECK + '<span>已加入 aria2</span></span>' +
               actionBtn(t.id, 'download', '浏览器下载', 'btn-ghost btn-icon', ICON_DOWNLOAD) +
               actionBtn(t.id, 'copy', '复制链接', 'btn-ghost btn-icon', ICON_COPY) +
               actionBtn(t.id, 'remove', '移除', 'btn-ghost btn-icon', ICON_X);
      } else {
        side = actionBtn(t.id, 'download', t.busy ? '准备中' : '下载', 'btn-primary', ICON_DOWNLOAD, !!t.busy) +
               (aria.enabled ? actionBtn(t.id, 'push', '加入 aria2', 'btn-ghost btn-icon', ICON_ARIA, !!t.busy) : '') +
               actionBtn(t.id, 'copy', '复制链接', 'btn-ghost btn-icon', ICON_COPY) +
               actionBtn(t.id, 'remove', '移除', 'btn-ghost btn-icon', ICON_X);
      }
    } else {
      side = '<span class="badge badge-err">失败</span>' + actionBtn(t.id, 'retry', '重试', 'btn-ok', ICON_REFRESH) + actionBtn(t.id, 'remove', '移除', 'btn-ghost btn-icon', ICON_X);
    }

    var bar = t.status === 'running' ? '<div class="bar"><i></i></div>' : '';
    var msg = t.pushError && !t.pushed ? '推送失败：' + t.pushError : t.message;
    var msgCls = 'task-msg' + (t.status === 'error' || (t.pushError && !t.pushed) ? ' is-err' : '');
    var meta = [t.artist, t.album].filter(Boolean).join(' · ') || t.file_url;

    return '<div class="' + cls + '">' + cover +
      '<div class="task-main">' +
        '<div class="task-title" title="' + esc(t.title) + '">' + esc(t.title) + '</div>' +
        '<div class="task-meta" title="' + esc(meta) + '">' + esc(meta) + '</div>' +
        '<div class="' + msgCls + '" title="' + esc(msg) + '">' + esc(msg) + '</div>' +
      '</div>' +
      '<div class="task-side">' + side +
        (t.status === 'done' && !t.expired ? '<span class="expire" data-expire="' + t.id + '">' + expireText(t) + '</span>' : '') +
      '</div>' + bar + '</div>';
  }

  function actionBtn(id, act, label, cls, icon, disabled) {
    var title = ' title="' + esc(label) + '"';
    var text = cls.indexOf('btn-icon') >= 0 ? '' : '<span>' + esc(label) + '</span>';
    return '<button class="btn ' + cls + '" data-act="' + act + '" data-id="' + id + '"' + title +
      (disabled ? ' disabled' : '') + '>' + icon + text + '</button>';
  }

  function expireText(t) {
    if (!t.expireAt) return '';
    var left = Math.floor((t.expireAt - Date.now()) / 1000);
    return left > 0 ? '链接有效 ' + fmtTime(left) : '链接已过期';
  }

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clampInt(v, min, max, dft) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return dft;
    return Math.min(max, Math.max(min, n));
  }
  function sanitize(name) { return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120); }
  function extFromUrl(u) {
    var m = String(u || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : '';
  }
  function guessName(u) {
    try {
      var p = new URL(u).pathname.split('/').pop() || '';
      return decodeURIComponent(p.replace(/\.[a-z0-9]{2,5}$/i, '')) || '';
    } catch (e) { return ''; }
  }
  function ttlFromUrl(u) {
    var m = String(u || '').match(/X-Amz-Expires=(\d+)/i);
    return m ? parseInt(m[1], 10) : 600;
  }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function msgOf(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.message || String(err);
  }
  function find(id) {
    for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
    return null;
  }
  function toast(msg, type) {
    var d = document.createElement('div');
    d.className = 'toast' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
    d.textContent = msg;
    el.toasts.appendChild(d);
    window.setTimeout(function () {
      d.style.transition = 'opacity .25s ease, transform .25s ease';
      d.style.opacity = '0';
      d.style.transform = 'translateY(6px)';
      window.setTimeout(function () { d.remove(); }, 260);
    }, 3000);
  }

  /* ---------------- 持久化 ---------------- */
  function save() {
    try {
      var data = tasks
        .filter(function (t) { return t.status === 'done' || t.status === 'error'; })
        .slice(-50)
        .map(function (t) {
          return {
            id: t.id, title: t.title, artist: t.artist, album: t.album,
            cover_url: t.cover_url, file_url: t.file_url, raw: t.raw,
            status: t.status, download_url: t.download_url, message: t.message,
            createdAt: t.createdAt, expireAt: t.expireAt,
            pushed: !!t.pushed, gid: t.gid || ''
          };
        });
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* 忽略隐私模式下的写入失败 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return;
      tasks = data.filter(function (t) { return t && t.id && t.file_url; }).map(function (t) {
        t.expired = t.status === 'done' && t.expireAt && Date.now() > t.expireAt;
        if (t.expired) t.message = '链接已过期，可重新生成';
        return t;
      });
    } catch (e) { tasks = []; }
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  /* ---------------- 事件 ---------------- */
  el.input.addEventListener('input', updatePreview);

  el.input.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  el.submit.addEventListener('click', submit);

  el.clear.addEventListener('click', function () {
    el.input.value = '';
    updatePreview();
    el.input.focus();
  });

  el.sample.addEventListener('click', function () {
    el.input.value = SAMPLE_TEXT;
    updatePreview();
    el.input.focus();
  });

  el.list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var t = find(btn.getAttribute('data-id'));
    if (!t) return;
    var act = btn.getAttribute('data-act');
    if (act === 'download') triggerDownload(t);
    else if (act === 'copy') copyLink(t);
    else if (act === 'push') pushOne(t);
    else if (act === 'retry') retry(t.id);
    else if (act === 'remove') remove(t.id);
  });

  el.clearDone.addEventListener('click', clearFinished);
  el.retryFailed.addEventListener('click', retryFailed);
  el.batch.addEventListener('click', pushBatch);
  el.ariaTest.addEventListener('click', testAria2);

  el.ariaSwitch.addEventListener('click', function () {
    aria.enabled = !aria.enabled;
    persistAria();
    savePrefs();
    applyAriaUI();
    renderStats();
    render();
    toast(aria.enabled ? '已启用 Aria2 批量下载' : '已关闭 Aria2 批量下载', 'ok');
  });

  el.settingsBtn.addEventListener('click', function () {
    el.settings.classList.toggle('show');
  });

  el.saveSettings.addEventListener('click', function () {
    apiOverride = (el.apiInput.value || '').trim();
    concurrency = clampInt(el.concInput.value, 1, 5, 2);
    prefs.apiBaseUrl = apiOverride;
    prefs.concurrency = concurrency;
    persistAria();
    savePrefs();
    toast('设置已保存', 'ok');
    pump();
  });

  window.setInterval(function () {
    var now = Date.now(), dirty = false;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (t.status !== 'done' || !t.expireAt) continue;
      var node = document.querySelector('[data-expire="' + t.id + '"]');
      var left = Math.floor((t.expireAt - now) / 1000);
      if (node) {
        node.textContent = left > 0 ? '链接有效 ' + fmtTime(left) : '链接已过期';
        node.className = 'expire' + (left > 0 && left < 60 ? ' soon' : '');
      }
      if (left <= 0 && !t.expired) { t.expired = true; t.message = '链接已过期，可重新生成'; dirty = true; }
    }
    if (dirty) { render(); save(); }
  }, 1000);

  function updatePreview() {
    var songs = parseText(el.input.value);
    if (!el.input.value.trim()) { el.preview.classList.remove('show'); el.submit.disabled = true; return; }
    el.submit.disabled = songs.length === 0;
    if (!songs.length) { el.preview.classList.remove('show'); return; }

    el.previewTitle.textContent = songs.length > 1
      ? '识别到 ' + songs.length + ' 首曲目'
      : '识别结果';
    var html = '';
    var limit = Math.min(songs.length, 6);
    for (var i = 0; i < limit; i++) {
      var s = songs[i];
      var bad = validate(s);
      html += '<span class="chip' + (bad ? ' missing' : '') + '">' + esc(s.title || UNKNOWN_TITLE) + '</span>';
      if (s.artist) html += '<span class="chip">' + esc(s.artist) + '</span>';
      if (s.album) html += '<span class="chip">' + esc(s.album) + '</span>';
      html += s.file_url
        ? '<span class="chip url">' + esc(extFromUrl(s.file_url).toUpperCase() || 'LINK') + '</span>'
        : '<span class="chip missing">缺少歌曲链接</span>';
    }
    if (songs.length > limit) html += '<span class="chip">+' + (songs.length - limit) + '</span>';
    el.previewRow.innerHTML = html;
    el.preview.classList.add('show');
  }

  function submit() {
    var text = el.input.value;
    if (!text.trim()) { toast('请先粘贴文本', 'err'); return; }
    var songs = parseText(text);
    if (!songs.length) { toast('未能从文本中识别出歌曲信息', 'err'); return; }
    var r = enqueue(songs);
    if (r.added) {
      el.input.value = '';
      updatePreview();
      el.input.focus();
      toast('已加入队列：' + r.added + ' 个任务', 'ok');
    }
  }

  /* ---------------- 启动 ---------------- */
  load();
  el.apiInput.value = apiOverride;
  el.concInput.value = String(concurrency);
  el.ariaEndpoint.value = aria.endpoint;
  el.ariaSecret.value = aria.secret;
  el.ariaDir.value = aria.dir;
  el.ariaReferer.value = aria.referer;
  if (!allowOverride) {
    el.apiRow.style.display = 'none';
  }
  applyAriaUI();
  render();
  el.input.focus();
})();
`;
