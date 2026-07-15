(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const chat = $('chat');
  const params = new URLSearchParams(location.search);
  const requestedInstance = params.get('instance') || '';
  const instanceId = /^[a-z0-9_-]{4,64}$/i.test(requestedInstance)
    ? requestedInstance
    : `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePrefix = `chatiffy:${instanceId}:`;
  const memoryStorage = new Map();
  const stored = (key) => {
    try { return localStorage.getItem(`${storagePrefix}${key}`); }
    catch (_) { return memoryStorage.get(key) ?? null; }
  };
  const save = (key, value) => {
    memoryStorage.set(key, String(value));
    try { localStorage.setItem(`${storagePrefix}${key}`, String(value)); }
    catch (_) { /* OBS may disable persistent storage; URL still contains the settings. */ }
  };
  const numberSetting = (name, storageKey, fallback, min, max) => {
    const value = Number(params.get(name) ?? stored(storageKey) ?? fallback);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const enumSetting = (name, storageKey, fallback, allowed) => {
    const value = params.get(name) ?? stored(storageKey) ?? fallback;
    return allowed.includes(value) ? value : fallback;
  };
  const settingsVersion = 6;
  const hasCurrentSettings = Number(stored('settingsVersion')) >= settingsVersion;
  const rawChannel = (params.get('channel') || stored('channel') || 'zakvielchannel').toLowerCase().replace(/^#/, '');
  const config = {
    channel: /^[a-z0-9_]{1,25}$/.test(rawChannel) ? rawChannel : 'zakvielchannel',
    fontSize: numberSetting('size', 'fontSize', 28, 16, 48),
    lifetime: numberSetting('lifetime', 'lifetime', 0, 0, 120),
    maxMessages: numberSetting('max', 'maxMessages', 9, 5, 30),
    background: (params.get('background') || (hasCurrentSettings && stored('background')) || '0') !== '0',
    theme: enumSetting('theme', 'theme', 'glass', ['glass', 'clean', 'neon']),
    align: enumSetting('align', 'align', 'left', ['left', 'right']),
    textColor: /^#[0-9a-f]{6}$/i.test(params.get('text') || stored('textColor') || '') ? (params.get('text') || stored('textColor')) : '#ffffff',
    panelOpacity: numberSetting('panel', 'panelOpacity', 32, 0, 80),
    vignette: numberSetting('vignette', 'vignette', 55, 0, 100),
    radius: numberSetting('radius', 'radius', 24, 0, 40)
  };
  let socket;
  let reconnectTimer;
  let joinTimer;
  let watchdogTimer;
  let reconnectDelay = 1000;
  let connectionGeneration = 0;
  let assetGeneration = 0;
  let emotes7tv = new Map();
  let twitchBadges = new Map();
  const seenMessageIds = new Set();

  function setStatus(text, error = false) {
    $('status').textContent = text;
    $('debug').textContent = error ? text : '';
    const badge = $('connectionBadge');
    badge.classList.toggle('error', error);
    badge.classList.add('visible');
    clearTimeout(setStatus.hideTimer);
    if (!error && text.startsWith('Онлайн')) setStatus.hideTimer = setTimeout(() => badge.classList.remove('visible'), 1800);
  }

  function syncUi() {
    $('channelInput').value = config.channel;
    $('fontSizeInput').value = config.fontSize;
    $('fontSizeOutput').value = `${config.fontSize} px`;
    $('lifetimeInput').value = config.lifetime;
    $('lifetimeOutput').value = config.lifetime ? `${config.lifetime} сек` : 'всегда';
    $('maxMessagesInput').value = config.maxMessages;
    $('backgroundInput').checked = config.background;
    $('themeInput').value = config.theme;
    $('alignInput').value = config.align;
    $('textColorInput').value = config.textColor;
    $('panelOpacityInput').value = config.panelOpacity;
    $('panelOpacityOutput').value = `${config.panelOpacity}%`;
    $('vignetteInput').value = config.vignette;
    $('vignetteOutput').value = `${config.vignette}%`;
    $('radiusInput').value = config.radius;
    $('radiusOutput').value = `${config.radius} px`;
    document.documentElement.style.setProperty('--font-size', `${config.fontSize}px`);
    document.documentElement.style.setProperty('--text-color', config.textColor);
    document.documentElement.style.setProperty('--panel-opacity', (config.panelOpacity / 100).toFixed(2));
    document.documentElement.style.setProperty('--vignette', (config.vignette / 100).toFixed(2));
    document.documentElement.style.setProperty('--panel-radius', `${config.radius}px`);
    chat.classList.toggle('with-background', config.background);
    chat.classList.toggle('align-right', config.align === 'right');
    chat.classList.remove('theme-glass', 'theme-clean', 'theme-neon');
    chat.classList.add(`theme-${config.theme}`);
    if ($('overlayUrlOutput')) $('overlayUrlOutput').value = createOverlayUrl();
    updateScale();
  }

  function updateScale() {
    const scale = Math.max(.68, Math.min(1.45, Math.min(innerWidth / 600, innerHeight / 900)));
    document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveTwitchId(channel) {
    const knownChannels = { zakvielchannel: '44407373' };
    if (knownChannels[channel]) return knownChannels[channel];
    const resolvers = [
      async () => {
        if (location.protocol !== 'http:' && location.protocol !== 'https:') return '';
        const response = await fetchWithTimeout(`/api/channel?login=${encodeURIComponent(channel)}`);
        if (!response.ok) return '';
        return (await response.json()).id;
      },
      async () => (await fetchWithTimeout(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(channel)}`)).json().then(x => x[0]?.id),
      async () => (await fetchWithTimeout(`https://decapi.me/twitch/id/${encodeURIComponent(channel)}`)).text()
    ];
    for (const resolve of resolvers) {
      try {
        const id = String(await resolve()).trim();
        if (/^\d+$/.test(id)) return id;
      } catch (_) { /* пробуем следующий сервис */ }
    }
    throw new Error('Не удалось определить Twitch ID канала');
  }

  function add7tvSet(data, target) {
    const list = data?.emote_set?.emotes || data?.emotes || [];
    for (const item of list) {
      const host = item.data?.host || item.host;
      const files = host?.files || [];
      const preferred = files.find(f => f.name === '2x.webp')
        || files.find(f => f.name === '2x.avif')
        || files.find(f => /^2x\./.test(f.name || ''))
        || files[files.length - 1];
      if (!host?.url || !preferred) continue;
      const baseUrl = host.url.startsWith('//') ? `https:${host.url}` : host.url;
      target.set(item.name, `${baseUrl}/${preferred.name}`);
    }
  }

  async function load7tv(twitchId, generation) {
    const next = new Map();
    try {
      const results = await Promise.allSettled([
        fetchWithTimeout(`https://7tv.io/v3/users/twitch/${twitchId}`),
        fetchWithTimeout('https://7tv.io/v3/emote-sets/global')
      ]);
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.ok) add7tvSet(await result.value.json(), next);
      }
      if (generation !== assetGeneration) return;
      emotes7tv = next;
      if (!next.size) $('debug').textContent = '7TV временно не вернул набор эмоутов; Twitch-чат продолжает работать.';
    } catch (error) {
      console.warn('7TV:', error);
      if (generation === assetGeneration) $('debug').textContent = '7TV временно недоступен; Twitch-чат продолжает работать.';
    }
  }

  function addHelixBadges(sets, target) {
    for (const set of sets || []) {
      for (const version of set.versions || []) {
        target.set(`${set.set_id}/${version.id}`, {
          url: version.image_url_2x || version.image_url_1x,
          title: version.title || set.set_id
        });
      }
    }
  }

  async function loadBadges(channelId, generation) {
    const cdn = (id) => `https://static-cdn.jtvnw.net/badges/v1/${id}/2`;
    const next = new Map([
      ['broadcaster/1', { url: cdn('5527c58c-fb7d-422d-b71b-f309dcb85cc1'), title: 'Стример' }],
      ['moderator/1', { url: cdn('d97c37bd-a6f5-4c38-8f57-4e4bef88af34'), title: 'Модератор' }],
      ['vip/1', { url: cdn('b817aba4-fad8-49e2-b88a-7cc744dfa6ec'), title: 'VIP' }],
      ['subscriber/0', { url: cdn('5d9f2208-5dd8-11e7-8513-2ff4adfae661'), title: 'Подписчик' }],
      ['founder/0', { url: cdn('fc71386c-86cd-11e7-a55d-43f591dc0c71'), title: 'Основатель' }]
    ]);
    twitchBadges = next;

    try {
      // На HTTP-сервере полный каталог безопасно загружается через локальный API.
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        const response = await fetchWithTimeout(`/api/badges?channelId=${channelId}`, {}, 9000);
        if (response.ok) {
          const data = await response.json();
          addHelixBadges(data.global, next);
          addHelixBadges(data.channel, next); // Канальные версии имеют приоритет.
        }
      }
      if (generation !== assetGeneration) return;
      twitchBadges = next;
    } catch (_) { /* встроенного набора достаточно */ }
  }

  async function refreshAssets(channel) {
    const generation = ++assetGeneration;
    emotes7tv = new Map();
    try {
      const twitchId = await resolveTwitchId(channel);
      if (generation !== assetGeneration) return;
      await Promise.allSettled([
        load7tv(twitchId, generation),
        loadBadges(twitchId, generation)
      ]);
    } catch (error) {
      if (generation === assetGeneration) $('debug').textContent = error.message;
    }
  }

  function parseTags(raw) {
    const tags = {};
    for (const pair of raw.split(';')) {
      const separator = pair.indexOf('=');
      const key = separator === -1 ? pair : pair.slice(0, separator);
      const value = separator === -1 ? '' : pair.slice(separator + 1);
      tags[key] = value.replace(/\\([snr:\\])/g, (_, escaped) => ({ s: ' ', n: '\n', r: '\r', ':': ';', '\\': '\\' })[escaped]);
    }
    return tags;
  }

  function parseIrc(line) {
    const match = line.match(/^@([^ ]+) :([^ ]+) PRIVMSG #[^ ]+ :(.*)$/);
    if (!match) return null;
    const tags = parseTags(match[1]);
    return { tags, user: match[2].split('!')[0], text: match[3] };
  }

  function twitchEmoteRanges(tag) {
    const ranges = [];
    if (!tag) return ranges;
    for (const group of tag.split('/')) {
      const [id, positions] = group.split(':');
      for (const position of (positions || '').split(',')) {
        const [start, end] = position.split('-').map(Number);
        if (Number.isFinite(start) && Number.isFinite(end)) ranges.push({ start, end, url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0` });
      }
    }
    return ranges.sort((a, b) => a.start - b.start);
  }

  function image(url, alt) {
    const img = document.createElement('img');
    img.className = 'emote'; img.src = url; img.alt = alt; img.title = alt;
    img.decoding = 'async';
    img.onerror = () => img.replaceWith(document.createTextNode(alt));
    return img;
  }

  function renderBadges(container, tag) {
    if (!tag) return;
    const wrap = document.createElement('span');
    wrap.className = 'badges';
    for (const badgeId of tag.split(',')) {
      const [setId] = badgeId.split('/');
      const badge = twitchBadges.get(badgeId)
        || ((setId === 'subscriber' || setId === 'founder') ? twitchBadges.get(`${setId}/0`) : null);
      if (!badge) continue;
      const img = document.createElement('img');
      img.className = 'badge';
      img.src = badge.url;
      img.alt = badge.title;
      img.title = badge.title;
      img.decoding = 'async';
      img.onerror = () => img.remove();
      wrap.append(img);
    }
    if (wrap.childElementCount) container.append(wrap);
  }

  function renderContent(container, text, twitchTag) {
    const chars = Array.from(text);
    const ranges = twitchEmoteRanges(twitchTag);
    let cursor = 0;
    for (const range of ranges) {
      render7tvText(container, chars.slice(cursor, range.start).join(''));
      container.append(image(range.url, chars.slice(range.start, range.end + 1).join('')));
      cursor = range.end + 1;
    }
    render7tvText(container, chars.slice(cursor).join(''));
  }

  function render7tvText(container, text) {
    const parts = text.split(/(\s+)/);
    for (const part of parts) {
      const url = emotes7tv.get(part);
      container.append(url ? image(url, part) : document.createTextNode(part));
    }
  }

  function removeMessage(node) {
    if (!node?.isConnected) return;
    node.classList.add('removing');
    setTimeout(() => node.remove(), 350);
  }

  function showMessage(message) {
    const messageId = message.tags.id || '';
    if (messageId && seenMessageIds.has(messageId)) return;
    if (messageId) {
      seenMessageIds.add(messageId);
      if (seenMessageIds.size > 500) seenMessageIds.delete(seenMessageIds.values().next().value);
    }
    const row = document.createElement('div');
    row.className = 'message';
    row.dataset.messageId = messageId;
    row.dataset.userId = message.tags['user-id'] || '';
    const author = document.createElement('span');
    author.className = 'author';
    author.style.color = message.tags.color || '#b89cff';
    author.textContent = `${message.tags['display-name'] || message.user}:`;
    renderBadges(row, message.tags.badges);
    row.append(author, document.createTextNode(' '));
    renderContent(row, message.text, message.tags.emotes);
    chat.append(row);
    while (chat.children.length > config.maxMessages) chat.firstElementChild.remove();
    if (config.lifetime > 0) setTimeout(() => removeMessage(row), config.lifetime * 1000);
  }

  function handleModerationLine(line) {
    const tagMatch = line.match(/^@([^ ]+) /);
    const tags = tagMatch ? parseTags(tagMatch[1]) : {};
    if (line.includes(' CLEARMSG ')) {
      const id = tags['target-msg-id'];
      for (const row of chat.querySelectorAll('.message')) if (row.dataset.messageId === id) removeMessage(row);
    }
    if (line.includes(' CLEARCHAT ')) {
      const userId = tags['target-user-id'];
      for (const row of chat.querySelectorAll('.message')) {
        if (!userId || row.dataset.userId === userId) removeMessage(row);
      }
    }
  }

  function clearConnectionTimers() {
    clearTimeout(reconnectTimer);
    clearTimeout(joinTimer);
    clearTimeout(watchdogTimer);
  }

  function armWatchdog(generation) {
    clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      if (generation === connectionGeneration && socket?.readyState === WebSocket.OPEN) socket.close(4000, 'Twitch timeout');
    }, 6 * 60 * 1000);
  }

  function scheduleReconnect(generation, immediate = false) {
    if (generation !== connectionGeneration || !navigator.onLine) return;
    const baseDelay = immediate ? 250 : reconnectDelay;
    const delay = Math.round(baseDelay * (.85 + Math.random() * .3));
    setStatus(`Переподключение через ${Math.max(1, Math.round(delay / 1000))} сек…`, true);
    reconnectTimer = setTimeout(connect, delay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  function connect() {
    clearConnectionTimers();
    const generation = ++connectionGeneration;
    if (socket) { socket.onclose = null; socket.close(); }
    if (!navigator.onLine) {
      setStatus('Нет подключения к интернету', true);
      return;
    }

    const nick = `justinfan${Math.floor(10000 + Math.random() * 80000)}`;
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    socket = ws;
    let joined = false;
    setStatus(`Подключение к #${config.channel}…`);

    joinTimer = setTimeout(() => {
      if (!joined && generation === connectionGeneration) {
        setStatus('Twitch не подтвердил вход в канал', true);
        ws.close(4001, 'Join timeout');
      }
    }, 15000);

    ws.onopen = () => {
      if (generation !== connectionGeneration) return;
      ws.send('PASS SCHMOOPIIE\r\n');
      ws.send(`NICK ${nick}\r\n`);
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
      ws.send(`JOIN #${config.channel}\r\n`);
      armWatchdog(generation);
    };

    ws.onmessage = ({ data }) => {
      if (generation !== connectionGeneration) return;
      armWatchdog(generation);
      for (const line of String(data).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) {
          if (ws.readyState === WebSocket.OPEN) ws.send(`${line.replace(/^PING/, 'PONG')}\r\n`);
          continue;
        }
        if (line.includes(' RECONNECT')) {
          ws.onclose = null;
          ws.close();
          scheduleReconnect(generation, true);
          return;
        }
        if (line.includes(' ROOMSTATE #')) {
          joined = true;
          clearTimeout(joinTimer);
          reconnectDelay = 1000;
          setStatus(`Онлайн · #${config.channel} · 7TV: ${emotes7tv.size}`);
        }
        if (line.includes(' NOTICE ')) {
          const noticeText = line.slice(line.lastIndexOf(' :') + 2);
          if (/authentication failed|suspended|does not exist/i.test(noticeText)) setStatus(noticeText, true);
        }
        if (line.includes(' CLEARMSG ') || line.includes(' CLEARCHAT ')) handleModerationLine(line);
        const message = parseIrc(line);
        if (message) showMessage(message);
      }
    };

    ws.onerror = () => {
      if (generation === connectionGeneration) setStatus('Ошибка соединения с Twitch', true);
    };
    ws.onclose = () => {
      if (generation !== connectionGeneration) return;
      clearTimeout(joinTimer);
      clearTimeout(watchdogTimer);
      scheduleReconnect(generation);
    };
  }

  function buildShareParams() {
    return new URLSearchParams({
      instance: instanceId,
      channel: config.channel,
      size: String(config.fontSize),
      lifetime: String(config.lifetime),
      max: String(config.maxMessages),
      background: config.background ? '1' : '0',
      theme: config.theme,
      align: config.align,
      text: config.textColor,
      panel: String(config.panelOpacity),
      vignette: String(config.vignette),
      radius: String(config.radius)
    });
  }

  function createOverlayUrl() {
    return location.protocol.startsWith('http')
      ? new URL(`/overlay?${buildShareParams()}`, location.origin).href
      : location.href;
  }

  function apply() {
    const nextChannel = $('channelInput').value.trim().toLowerCase().replace(/^#/, '');
    if (!/^[a-z0-9_]{1,25}$/.test(nextChannel)) {
      $('debug').textContent = 'Введите корректный Twitch-логин: латинские буквы, цифры и подчёркивание.';
      $('channelInput').focus();
      return null;
    }
    config.channel = nextChannel;
    config.fontSize = +$('fontSizeInput').value;
    config.lifetime = +$('lifetimeInput').value;
    config.maxMessages = Math.min(30, Math.max(5, +$('maxMessagesInput').value || 9));
    config.background = $('backgroundInput').checked;
    config.theme = $('themeInput').value;
    config.align = $('alignInput').value;
    config.textColor = $('textColorInput').value;
    config.panelOpacity = +$('panelOpacityInput').value;
    config.vignette = +$('vignetteInput').value;
    config.radius = +$('radiusInput').value;
    for (const [key, value] of Object.entries(config)) save(key, value ? String(value) : '0');
    save('settingsVersion', settingsVersion);
    const shareParams = buildShareParams();
    history.replaceState(null, '', `${location.pathname}?${shareParams}`);
    syncUi();
    $('settings').hidden = true;
    chat.replaceChildren();
    seenMessageIds.clear();
    connect();
    refreshAssets(config.channel);
    return shareParams;
  }

  $('settingsButton').onclick = () => { $('settings').hidden = !$('settings').hidden; };
  $('fontSizeInput').oninput = () => { $('fontSizeOutput').value = `${$('fontSizeInput').value} px`; };
  $('lifetimeInput').oninput = () => { $('lifetimeOutput').value = +$('lifetimeInput').value ? `${$('lifetimeInput').value} сек` : 'всегда'; };
  $('applyButton').onclick = apply;
  $('overlayUrlOutput').onclick = () => $('overlayUrlOutput').select();
  $('copyButton').onclick = async () => {
    const applied = apply();
    if (!applied) return;
    const overlayUrl = createOverlayUrl();
    try {
      await navigator.clipboard.writeText(overlayUrl);
      $('copyButton').textContent = 'Ссылка скопирована ✓';
    } catch (_) {
      prompt('Скопируйте ссылку для OBS:', overlayUrl);
    }
    setTimeout(() => { $('copyButton').textContent = 'Скопировать ссылку для OBS'; }, 1800);
  };

  const liveControls = ['fontSizeInput', 'backgroundInput', 'themeInput', 'alignInput', 'textColorInput', 'panelOpacityInput', 'vignetteInput', 'radiusInput'];
  for (const id of liveControls) $(id).addEventListener('input', () => {
    config.fontSize = +$('fontSizeInput').value;
    config.background = $('backgroundInput').checked;
    config.theme = $('themeInput').value;
    config.align = $('alignInput').value;
    config.textColor = $('textColorInput').value;
    config.panelOpacity = +$('panelOpacityInput').value;
    config.vignette = +$('vignetteInput').value;
    config.radius = +$('radiusInput').value;
    syncUi();
  });

  const presets = {
    soft: { fontSize: 28, panelOpacity: 32, vignette: 55, radius: 24, background: false, theme: 'glass' },
    compact: { fontSize: 22, panelOpacity: 45, vignette: 35, radius: 12, background: false, theme: 'clean' },
    neon: { fontSize: 28, panelOpacity: 28, vignette: 72, radius: 26, background: true, theme: 'neon' },
    transparent: { fontSize: 28, panelOpacity: 0, vignette: 0, radius: 0, background: false, theme: 'glass' }
  };
  for (const button of document.querySelectorAll('[data-preset]')) button.onclick = () => {
    Object.assign(config, presets[button.dataset.preset]);
    syncUi();
  };
  addEventListener('resize', updateScale);
  addEventListener('offline', () => {
    clearConnectionTimers();
    if (socket) { socket.onclose = null; socket.close(); }
    setStatus('Нет подключения к интернету', true);
  });
  addEventListener('online', () => connect());
  addEventListener('beforeunload', () => {
    clearConnectionTimers();
    if (socket) { socket.onclose = null; socket.close(); }
  });
  if (!hasCurrentSettings) {
    save('maxMessages', config.maxMessages);
    save('background', config.background ? '1' : '0');
    save('settingsVersion', settingsVersion);
  }
  if (!params.has('instance')) {
    params.set('instance', instanceId);
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }
  if (location.pathname === '/overlay') document.body.classList.add('overlay-mode');
  syncUi();
  connect();
  refreshAssets(config.channel);
})();
