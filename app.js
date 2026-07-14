(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const chat = $('chat');
  const params = new URLSearchParams(location.search);
  const config = {
    channel: (params.get('channel') || localStorage.getItem('channel') || 'zakvielchannel').toLowerCase().replace(/^#/, ''),
    fontSize: +(params.get('size') || localStorage.getItem('fontSize') || 28),
    lifetime: +(params.get('lifetime') || localStorage.getItem('lifetime') || 35),
    maxMessages: +(params.get('max') || localStorage.getItem('maxMessages') || 40),
    background: (params.get('background') || localStorage.getItem('background') || '1') !== '0',
    theme: params.get('theme') || localStorage.getItem('theme') || 'glass',
    align: params.get('align') || localStorage.getItem('align') || 'left'
  };
  let socket;
  let reconnectTimer;
  let reconnectDelay = 1000;
  let emotes7tv = new Map();
  let twitchBadges = new Map();

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
    document.documentElement.style.setProperty('--font-size', `${config.fontSize}px`);
    chat.classList.toggle('with-background', config.background);
    chat.classList.toggle('align-right', config.align === 'right');
    chat.classList.remove('theme-glass', 'theme-clean', 'theme-neon');
    chat.classList.add(`theme-${config.theme}`);
    updateScale();
  }

  function updateScale() {
    const scale = Math.max(.68, Math.min(1.45, Math.min(innerWidth / 600, innerHeight / 900)));
    document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
  }

  async function resolveTwitchId(channel) {
    const knownChannels = { zakvielchannel: '44407373' };
    if (knownChannels[channel]) return knownChannels[channel];
    const resolvers = [
      async () => (await fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(channel)}`)).json().then(x => x[0]?.id),
      async () => (await fetch(`https://decapi.me/twitch/id/${encodeURIComponent(channel)}`)).text()
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
      const animated = item.data?.animated || files.some(f => f.name?.endsWith('.gif'));
      const preferred = files.find(f => f.name === `2x.${animated ? 'webp' : 'webp'}`)
        || files.find(f => f.name === '2x.avif') || files.find(f => /^2x\./.test(f.name || '')) || files.at(-1);
      if (!host?.url || !preferred) continue;
      target.set(item.name, `https:${host.url}/${preferred.name}`);
    }
  }

  async function load7tv() {
    const next = new Map();
    try {
      const twitchId = await resolveTwitchId(config.channel);
      const [channelRes, globalRes] = await Promise.all([
        fetch(`https://7tv.io/v3/users/twitch/${twitchId}`),
        fetch('https://7tv.io/v3/emote-sets/global')
      ]);
      if (channelRes.ok) add7tvSet(await channelRes.json(), next);
      if (globalRes.ok) add7tvSet(await globalRes.json(), next);
      emotes7tv = next;
      setStatus(`7TV: ${next.size} эмоутов · подключение к чату…`);
    } catch (error) {
      console.warn('7TV:', error);
      setStatus(`7TV временно недоступен: ${error.message}`, true);
    }
  }

  function addBadgeSets(data, target) {
    for (const [setId, set] of Object.entries(data?.badge_sets || {})) {
      for (const [versionId, version] of Object.entries(set.versions || {})) {
        target.set(`${setId}/${versionId}`, {
          url: version.image_url_2x || version.image_url_1x,
          title: version.title || setId
        });
      }
    }
  }

  async function loadBadges() {
    const cdn = (id) => `https://static-cdn.jtvnw.net/badges/v1/${id}/2`;
    const next = new Map([
      ['broadcaster/1', { url: cdn('5527c58c-fb7d-422d-b71b-f309dcb85cc1'), title: 'Стример' }],
      ['moderator/1', { url: cdn('d97c37bd-a6f5-4c38-8f57-4e4bef88af34'), title: 'Модератор' }],
      ['vip/1', { url: cdn('b817aba4-fad8-49e2-b88a-7cc744dfa6ec'), title: 'VIP' }],
      ['subscriber/0', { url: cdn('5d9f2208-5dd8-11e7-8513-2ff4adfae661'), title: 'Подписчик' }],
      ['founder/0', { url: cdn('fc71386c-86cd-11e7-a55d-43f591dc0c71'), title: 'Основатель' }]
    ]);
    twitchBadges = next;

    // Старый публичный каталог иногда доступен через кэш/прокси OBS.
    // Ошибка не мешает встроенным основным бейджам работать.
    try {
      const channelId = await resolveTwitchId(config.channel);
      for (const url of [
        'https://badges.twitch.tv/v1/badges/global/display',
        `https://badges.twitch.tv/v1/badges/channels/${channelId}/display`
      ]) {
        try {
          const response = await fetch(url);
          if (response.ok) addBadgeSets(await response.json(), next);
        } catch (_) { /* используем встроенные бейджи */ }
      }
      twitchBadges = next;
    } catch (_) { /* встроенного набора достаточно */ }
  }

  function parseTags(raw) {
    const tags = {};
    for (const pair of raw.split(';')) {
      const [key, value = ''] = pair.split('=');
      tags[key] = value.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
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
    const row = document.createElement('div');
    row.className = 'message';
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

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket) { socket.onclose = null; socket.close(); }
    const nick = `justinfan${Math.floor(10000 + Math.random() * 80000)}`;
    socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    setStatus(`Подключение к #${config.channel}…`);
    socket.onopen = () => {
      socket.send('PASS SCHMOOPIIE\r\n');
      socket.send(`NICK ${nick}\r\n`);
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
      socket.send(`JOIN #${config.channel}\r\n`);
    };
    socket.onmessage = ({ data }) => {
      for (const line of data.split('\r\n')) {
        if (line.startsWith('PING')) { socket.send('PONG :tmi.twitch.tv\r\n'); continue; }
        if (line.includes(' 001 ')) { reconnectDelay = 1000; setStatus(`Онлайн · #${config.channel} · 7TV: ${emotes7tv.size}`); }
        const message = parseIrc(line);
        if (message) showMessage(message);
      }
    };
    socket.onerror = () => setStatus('Ошибка соединения с Twitch', true);
    socket.onclose = () => {
      setStatus(`Связь потеряна, повтор через ${Math.round(reconnectDelay / 1000)} сек…`, true);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
  }

  function apply() {
    config.channel = $('channelInput').value.trim().toLowerCase().replace(/^#/, '') || 'zakvielchannel';
    config.fontSize = +$('fontSizeInput').value;
    config.lifetime = +$('lifetimeInput').value;
    config.maxMessages = Math.max(5, +$('maxMessagesInput').value || 40);
    config.background = $('backgroundInput').checked;
    config.theme = $('themeInput').value;
    config.align = $('alignInput').value;
    for (const [key, value] of Object.entries(config)) localStorage.setItem(key, value ? String(value) : '0');
    syncUi();
    $('settings').hidden = true;
    chat.replaceChildren();
    Promise.allSettled([load7tv(), loadBadges()]).finally(connect);
  }

  $('settingsButton').onclick = () => { $('settings').hidden = !$('settings').hidden; };
  $('fontSizeInput').oninput = () => { $('fontSizeOutput').value = `${$('fontSizeInput').value} px`; };
  $('lifetimeInput').oninput = () => { $('lifetimeOutput').value = +$('lifetimeInput').value ? `${$('lifetimeInput').value} сек` : 'всегда'; };
  $('applyButton').onclick = apply;
  addEventListener('resize', updateScale);
  syncUi();
  Promise.allSettled([load7tv(), loadBadges()]).finally(connect);
})();
