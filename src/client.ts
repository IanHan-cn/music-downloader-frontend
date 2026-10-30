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
  // 并发上限完全来自环境变量 MAX_CONCURRENCY（由 Worker 注入），页面可以在 1 ~ 上限之间调整；
  // 这里不额外封顶，只对缺值/非法值兜底到 2。
  var concLimit = clampInt(CONFIG.maxConcurrency, 1, Number.MAX_SAFE_INTEGER, 2);
  var concurrency = clampInt(prefs.concurrency || concLimit, 1, concLimit, concLimit);
  var apiOverride = prefs.apiBaseUrl || '';
  var allowOverride = CONFIG.allowApiOverride === true;
  var tasks = [];
  var batchBusy = false;
  var inputHasSongs = false;

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
    ariaStatus: document.getElementById('aria-status'),
    toasts: document.getElementById('toasts')
  };

  /* ---------------- 文本解析 ---------------- */
  var RULES = [
    { key: 'title', re: /^(?:歌\s*名|曲\s*名|歌曲\s*名|标\s*题|曲\s*目|title|name)$/i },
    { key: 'artist', re: /^(?:歌\s*手|艺\s*人|演\s*唱(?:者)?|artists?|singer)$/i },
    { key: 'album', re: /^(?:专\s*辑|唱\s*片|album)$/i },
    { key: 'file_url', re: /^(?:歌曲\s*链接|下\s*载\s*链\s*接|文\s*件\s*链\s*接|音\s*乐\s*链\s*接|音频\s*链接|file[_-]?url|url|src)$/i, url: true },
    { key: 'cover_url', re: /^(?:封面\s*链接|封\s*面|图\s*片|cover[_-]?url|cover|pic|picurl)$/i, url: true },
    { key: 'duration', re: /^(?:时\s*长|长\s*度|时\s*间|片\s*长|duration|length|time)$/i, number: true }
  ];

  function isUrl(v) { return typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()); }
  function safeUrl(v) { return isUrl(v) ? v.trim() : ''; }

  // 时长归一化为秒：支持 285 / "285" / "07:07" / "1:02:03"，无法识别时返回 ''
  function toSeconds(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') return isFinite(value) && value >= 0 ? Math.round(value) : '';

    var s = String(value).trim();
    if (!s) return '';

    var parts = s.split(':');
    if (parts.length >= 2 && parts.length <= 3) {
      var nums = [];
      for (var i = 0; i < parts.length; i++) {
        if (!/^\d{1,4}$/.test(parts[i].trim())) return '';
        nums.push(parseInt(parts[i], 10));
      }
      // 首段（时或分）允许超过 59，其余段必须是合法的分/秒
      for (var k = 1; k < nums.length; k++) {
        if (nums[k] > 59) return '';
      }
      if (parts.length === 2) return nums[0] * 60 + nums[1];
      return nums[0] * 3600 + nums[1] * 60 + nums[2];
    }
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
    return '';
  }

  // 歌手字段可能是数组
  function arrayToText(v) {
    if (Array.isArray(v)) return v.filter(Boolean).join(', ');
    if (typeof v === 'string') return v;
    return v === null || v === undefined ? '' : String(v);
  }

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
    var out = { title: '', artist: '', album: '', file_url: '', cover_url: '', duration: '', raw: block };
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
        } else if (r.number) {
          if (out[r.key] === '') out[r.key] = toSeconds(value);
        } else if (!out[r.key]) {
          out[r.key] = value;
        }
        break;
      }
    }
    return out;
  }

  function isJsonDoc(raw) {
    var s = String(raw || '').trim();
    return (s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'));
  }

  // JSON 整段解析（单个对象或数组），失败或没有可用条目时返回空数组
  function songsFromJson(raw) {
    if (!isJsonDoc(raw)) return [];
    try {
      var parsedJson = JSON.parse(String(raw).trim());
      var jsonArr = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      var jsonSongs = [];
      for (var k = 0; k < jsonArr.length; k++) {
        var item = jsonArr[k];
        if (!item || typeof item !== 'object') continue;
        jsonSongs.push({
          title: item.name || item.title || '',
          artist: arrayToText(item.artist) || '',
          album: item.album || '',
          file_url: safeUrl(item.url || item.file_url || ''),
          cover_url: safeUrl(item.pic || item.cover_url || ''),
          duration: toSeconds(item.duration),
          raw: JSON.stringify(item, null, 2)
        });
      }
      return jsonSongs;
    } catch (e) {
      // 解析失败则降级走纯文本块逻辑
      return [];
    }
  }

  function parseBlocks(raw) {
    var blocks = splitBlocks(raw);
    var songs = [];
    for (var i = 0; i < blocks.length; i++) {
      var s = parseBlock(blocks[i]);
      if (!s.file_url && !s.title) continue;
      songs.push(s);
    }
    return songs;
  }

  function parseText(text) {
    var raw = String(text || '').trim();
    if (!raw) return [];

    // 1. 尝试直接解析为 JSON（适配类似你提供的 JSON 数组或对象样式）
    var jsonSongs = songsFromJson(raw);
    if (jsonSongs.length > 0) return jsonSongs;

    // 2. 纯文本多行解析
    return parseBlocks(raw);
  }

  // 供自动入队使用：找出「已经可以入队」的曲目，并带回它们对应的原始文本块
  function detectSongs(raw) {
    var text = String(raw || '');
    if (!text.trim()) return { songs: [], blocks: [] };

    var jsonSongs = songsFromJson(text);
    if (jsonSongs.length > 0) {
      // JSON 是整块文本，无法按条切走，所以只在至少有一条可用时才一次性收走，
      // 全部都没有链接（典型场景：粘贴了搜索结果）时留在输入框里，由预览标红提示。
      var usable = [], missing = 0;
      for (var i = 0; i < jsonSongs.length; i++) {
        if (validate(jsonSongs[i])) missing++;
        else usable.push(jsonSongs[i]);
      }
      return usable.length ? { songs: usable, blocks: [text.trim()], missing: missing } : { songs: [], blocks: [], missing: missing };
    }

    var blocks = splitBlocks(text);
    var songs = [], used = [];
    for (var j = 0; j < blocks.length; j++) {
      var s = parseBlock(blocks[j]);
      // 还没有歌曲链接的块视为「没输完」，留在输入框里继续等
      if (!s.file_url) continue;
      songs.push(s);
      used.push(blocks[j]);
    }
    return { songs: songs, blocks: used };
  }

  function validate(song) {
    if (!song.file_url) return '未解析到「歌曲链接」，请检查文本是否包含可下载的音频地址';
    return '';
  }

  /* ---------------- 任务队列 ---------------- */
  // 自动识别出来的曲目先进列表，状态是 pending，**不提交后台**；
  // 只有点「立即处理」（startPending）才会转成 queued 并由 pump 真正发出请求。
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
        duration: s.duration === undefined ? '' : s.duration,
        raw: s.raw || '',
        status: 'pending',
        download_url: '',
        message: '待处理',
        createdAt: Date.now(),
        expireAt: 0,
        expired: false
      });
      added++;
    }
    if (added) {
      render();
      save();
      // 注意：这里不 pump，等用户点「立即处理」
    }
    return { added: added, skipped: skipped };
  }

  function hasPending() {
    for (var i = 0; i < tasks.length; i++) if (tasks[i].status === 'pending') return true;
    return false;
  }

  function countPending() {
    var n = 0;
    for (var i = 0; i < tasks.length; i++) if (tasks[i].status === 'pending') n++;
    return n;
  }

  // 点「立即处理」后再真正开始：pending → queued
  function startPending() {
    var n = 0;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].status !== 'pending') continue;
      tasks[i].status = 'queued';
      tasks[i].message = '排队中';
      n++;
    }
    if (!n) return 0;
    render();
    save();
    pump();
    return n;
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
    // 时长仅在解析到时才附带，避免后端收到空值
    if (t.duration !== '' && t.duration !== null && t.duration !== undefined) {
      payload.duration = Number(t.duration);
    }
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
        if (songs[0].duration !== '' && songs[0].duration !== undefined) t.duration = songs[0].duration;
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
    tasks = tasks.filter(function (t) {
      return t.status === 'pending' || t.status === 'queued' || t.status === 'running';
    });
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
  // override 非空时用它（页面实时输入），否则用已保存的配置
  function aria2Call(method, params, override) {
    var endpoint = override && override.endpoint ? override.endpoint : aria.endpoint;
    var secret = override ? override.secret : aria.secret;
    var body = JSON.stringify({
      jsonrpc: '2.0', id: uid(), method: method,
      params: secret ? ['token:' + secret].concat(params || []) : (params || [])
    });
    return fetch(endpoint, {
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
    return aria2Call('aria2.addUri', [[t.download_url], aria2Options(t)]);
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
    setAriaStatus('pending');
    aria2Call('aria2.getVersion', [], currentAriaInput())
      .then(function (res) {
        setAriaStatus('ok', (res && res.version) || '');
        toast('Aria2 连接成功', 'ok');
      })
      .catch(function (err) {
        setAriaStatus('err', msgOf(err));
      });
  }

  // 直接读取输入框当前值，不等用户点保存
  function currentAriaInput() {
    return {
      endpoint: (el.ariaEndpoint.value || '').trim(),
      secret: (el.ariaSecret.value || '').trim()
    };
  }

  var ariaTestTimer = null;
  var ariaTestSeq = 0;

  function scheduleAriaTest() {
    if (!aria.enabled) return;
    var cfg = currentAriaInput();
    if (!cfg.endpoint) {
      ariaTestSeq++;
      if (ariaTestTimer) { clearTimeout(ariaTestTimer); ariaTestTimer = null; }
      setAriaStatus('empty');
      return;
    }
    setAriaStatus('pending');
    var seq = ++ariaTestSeq;
    if (ariaTestTimer) clearTimeout(ariaTestTimer);
    ariaTestTimer = window.setTimeout(function () {
      if (seq !== ariaTestSeq) return;
      testAria2();
    }, 600);
  }

  function setAriaStatus(state, detail) {
    if (!el.ariaStatus) return;
    var cls = { ok: 'is-ok', err: 'is-err', empty: 'is-empty', pending: 'is-pending' }[state] || 'is-pending';
    el.ariaStatus.className = 'aria-status show ' + cls;
    if (state === 'pending') {
      el.ariaStatus.innerHTML = '<span class="spinner"></span><span>正在连接 aria2…</span>';
    } else if (state === 'ok') {
      el.ariaStatus.innerHTML = ICON_CHECK + '<span>已连接 · aria2 ' + esc(detail || '') + '</span>';
    } else if (state === 'empty') {
      el.ariaStatus.innerHTML = '<span>填写端点后将自动检测连接</span>';
    } else {
      el.ariaStatus.innerHTML = ICON_X + '<span>连接失败：' + esc(detail || '') +
        ' · 请确认已开启 --rpc-allow-origin-all</span>';
    }
  }

  function applyAriaUI() {
    el.ariaSwitch.setAttribute('aria-checked', aria.enabled ? 'true' : 'false');
    el.ariaConfig.classList.toggle('show', aria.enabled);
    el.batch.classList.toggle('hidden', !aria.enabled);
    if (!aria.enabled && ariaTestTimer) {
      clearTimeout(ariaTestTimer);
      ariaTestTimer = null;
      ariaTestSeq++;
      setAriaStatus('empty');
    }
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
    var s = { pending: 0, queued: 0, running: 0, done: 0, error: 0 };
    for (var i = 0; i < tasks.length; i++) s[tasks[i].status]++;
    el.stats.innerHTML =
      '<span class="stat">共 <b>' + tasks.length + '</b></span>' +
      '<span class="stat">待处理 <b>' + s.pending + '</b></span>' +
      '<span class="stat is-run">处理中 <b>' + (s.running + s.queued) + '</b></span>' +
      '<span class="stat is-done">已完成 <b>' + s.done + '</b></span>' +
      '<span class="stat is-err">失败 <b>' + s.error + '</b></span>';
    el.clearDone.disabled = s.done + s.error === 0;
    el.retryFailed.disabled = s.error === 0;
    refreshSubmit();

    if (aria.enabled) {
      var pend = pushable().length;
      el.batch.disabled = batchBusy || pend === 0;
      var label = el.batch.querySelector('span');
      if (label) label.textContent = batchBusy ? '推送中…' : ('批量下载' + (pend ? ' (' + pend + ')' : ''));
    }
  }

  // 「立即处理」在两种情况下可用：列表里还有待处理的任务，或输入框里有能识别的内容
  function refreshSubmit() {
    var n = countPending();
    el.submit.disabled = !n && !inputHasSongs;
    var label = el.submit.querySelector('span');
    if (label) label.textContent = n ? '立即处理 (' + n + ')' : '立即处理';
  }

  function renderTask(t) {
    var cls = 'task' + (t.status === 'done' ? ' is-done' : t.status === 'error' ? ' is-error' : t.status === 'running' ? ' is-running' : '');
    var cover = t.cover_url
      ? '<img class="cover" src="' + esc(t.cover_url) + '" alt="cover" loading="lazy" referrerpolicy="no-referrer" />'
      : '<div class="cover-fallback">' + ICON_MUSIC + '</div>';

    var side = '';
    if (t.status === 'pending') side = '<span class="badge badge-queue"><i class="dot"></i>待处理</span>' + actionBtn(t.id, 'remove', '移除', 'btn-ghost btn-icon', ICON_X);
    else if (t.status === 'queued') side = '<span class="badge badge-queue"><i class="dot"></i>排队中</span>' + actionBtn(t.id, 'remove', '移除', 'btn-ghost btn-icon', ICON_X);
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
    var metaParts = [t.artist, t.album].filter(Boolean);
    if (hasDuration(t)) metaParts.push(fmtTime(Number(t.duration)));
    var meta = metaParts.length ? metaParts.join(' · ') : t.file_url;

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
  function hasDuration(t) {
    return t.duration !== '' && t.duration !== null && t.duration !== undefined;
  }
  function msgOf(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.message || String(err);
  }

  // 从原文里挖掉已入队的文本块，剩下的内容保持原样（兼容 ES5，不用 trimEnd）
  function stripBlocks(raw, blocks) {
    var out = String(raw);
    for (var i = 0; i < blocks.length; i++) {
      var idx = out.indexOf(blocks[i]);
      if (idx >= 0) out = out.slice(0, idx) + out.slice(idx + blocks[i].length);
    }
    return out.replace(/\n{3,}/g, '\n\n').replace(/^[ \t]*\n/, '').replace(/\s+$/, '');
  }

  function caretToEnd() {
    var len = el.input.value.length;
    try { el.input.setSelectionRange(len, len); } catch (e) { /* 某些输入类型不支持 */ }
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
        // pending 也要留下：刷新后仍停在列表里等你点「立即处理」
        .filter(function (t) { return t.status === 'pending' || t.status === 'done' || t.status === 'error'; })
        .slice(-50)
        .map(function (t) {
          return {
            id: t.id, title: t.title, artist: t.artist, album: t.album,
            cover_url: t.cover_url, file_url: t.file_url, raw: t.raw, duration: t.duration,
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
        // 早期版本可能存了 queued/running，统一回到 pending，等用户点「立即处理」
        if (t.status !== 'done' && t.status !== 'error') {
          t.status = 'pending';
          t.message = '待处理';
          t.download_url = '';
        } else {
          t.expired = t.status === 'done' && t.expireAt && Date.now() > t.expireAt;
          if (t.expired) t.message = '链接已过期，可重新生成';
        }
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
  el.input.addEventListener('input', function () {
    updatePreview();
    scheduleAutoEnqueue();
  });

  el.input.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); flushAutoEnqueue(); }
  });

  el.submit.addEventListener('click', flushAutoEnqueue);

  el.clear.addEventListener('click', function () {
    el.input.value = '';
    updatePreview();
    el.input.focus();
  });

  // 「填入示例」后也走自动识别，示例文本会直接落到队列里
  el.sample.addEventListener('click', function () {
    el.input.value = SAMPLE_TEXT;
    updatePreview();
    el.input.focus();
    scheduleAutoEnqueue();
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

  el.ariaEndpoint.addEventListener('input', scheduleAriaTest);
  el.ariaSecret.addEventListener('input', scheduleAriaTest);
  el.ariaEndpoint.addEventListener('blur', function () { if (aria.enabled) testAria2(); });

  el.ariaSwitch.addEventListener('click', function () {
    aria.enabled = !aria.enabled;
    persistAria();
    savePrefs();
    applyAriaUI();
    renderStats();
    render();
    if (aria.enabled) testAria2();
    toast(aria.enabled ? '已启用 Aria2 批量下载' : '已关闭 Aria2 批量下载', 'ok');
  });

  function setSettingsOpen(open) {
    el.settings.classList.toggle('show', open);
    el.settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  el.settingsBtn.addEventListener('click', function () {
    setSettingsOpen(!el.settings.classList.contains('show'));
  });

  el.saveSettings.addEventListener('click', function () {
    apiOverride = (el.apiInput.value || '').trim();
    // 页面可以改并发，但不能超过环境变量给的上限
    var wanted = parseInt(el.concInput.value, 10);
    concurrency = clampInt(el.concInput.value, 1, concLimit, concLimit);
    prefs.concurrency = concurrency;
    el.concInput.value = String(concurrency);
    persistAria();
    savePrefs();
    // 保存完直接把面板收回原来的位置
    setSettingsOpen(false);
    if (!isNaN(wanted) && wanted > concLimit) {
      toast('并发数超过环境变量上限 ' + concLimit + '，已按上限处理', 'err');
    } else {
      toast('设置已保存', 'ok');
    }
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
    if (!el.input.value.trim()) {
      inputHasSongs = false;
      el.preview.classList.remove('show');
      refreshSubmit();
      return;
    }
    var songs = parseText(el.input.value);
    // 只有「已能入队」的才会让按钮可用；仅有条目但缺链接的仍然留在预览里标红
    inputHasSongs = detectSongs(el.input.value).songs.length > 0;
    refreshSubmit();
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
      if (s.duration !== '' && s.duration !== undefined) {
        html += '<span class="chip url">' + esc(fmtTime(Number(s.duration))) + '</span>';
      }
      html += s.file_url
        ? '<span class="chip url">' + esc(extFromUrl(s.file_url).toUpperCase() || 'LINK') + '</span>'
        : '<span class="chip missing">缺少歌曲链接</span>';
    }
    if (songs.length > limit) html += '<span class="chip">+' + (songs.length - limit) + '</span>';
    el.previewRow.innerHTML = html;
    el.preview.classList.add('show');
  }

  /* ---------------- 自动入队 ---------------- */
  // 输入框里的内容一旦被识别成可下载的曲目，就自动进下方队列；
  // 已入队的那部分文本会从输入框里挖走，没识别完的（比如还缺歌曲链接）继续留在框里等待补全。
  var AUTO_DELAY = 600;
  var autoTimer = null;

  function scheduleAutoEnqueue() {
    if (autoTimer) window.clearTimeout(autoTimer);
    autoTimer = window.setTimeout(function () {
      autoTimer = null;
      autoEnqueue(false);
    }, AUTO_DELAY);
  }

  // 点「立即处理」/ ⌘Enter：先把输入框里剩下的识别出来，再统一提交后台
  function flushAutoEnqueue() {
    if (autoTimer) { window.clearTimeout(autoTimer); autoTimer = null; }
    var got = autoEnqueue(true);
    var started = startPending();
    if (started) toast('已开始处理 ' + started + ' 个任务', 'ok');
    else if (!got) toast('列表里没有待处理的任务', 'err');
  }

  function autoEnqueue(force) {
    var raw = el.input.value;
    if (!raw.trim()) return false;

    var hit = detectSongs(raw);

    if (!hit.songs.length) {
      if (!force) return false;
      // 手动触发时给出明确原因：识别到了条目但缺链接 → 走 enqueue 输出具体报错
      var all = parseText(raw);
      if (all.length) { enqueue(all); return false; }
      toast('未能从文本中识别出歌曲信息', 'err');
      return false;
    }

    var r = enqueue(hit.songs);
    if (!r.added) return false;

    el.input.value = stripBlocks(raw, hit.blocks);
    caretToEnd();
    updatePreview();
    if (!force) toast('已加入列表：' + r.added + ' 首，点「立即处理」开始', 'ok');
    if (hit.missing) toast('另有 ' + hit.missing + ' 条缺少歌曲链接，未加入队列', 'err');
    return true;
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
  if (aria.enabled) scheduleAriaTest();
  el.input.focus();
})();
`;
