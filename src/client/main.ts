import { demoIdentities } from './demo-identities.js';
import { demoEmotes, startDemoChat } from './demo-chat.js';
import { backupFilename, makeProfileBackup, parseProfileBackup, maxBackupBytes, type ProfileBackup } from '../shared/profile-transfer.js';
import { startSplashes } from './splashes.js';
import { appVersion } from '../shared/version.js';
import { EmoteRegistry, sevenTvProvider } from './providers.js';
import { fontFamilies, canvasSizes, settingsSchema, readSettings, serializeSettings, settingsVersion, type OverlaySettings } from '../shared/settings.js';
import { parseTags, parseIrc, twitchEmoteRanges } from './irc.js';
import type { ChatMessage, BadgeSet, Badge, Cosmetics, Paint } from '../shared/contracts.js';
(() => {
  'use strict';

  interface Elements {
    lockAppearanceButton: HTMLButtonElement;
    appearanceLockStatus: HTMLParagraphElement;
    undoAppearanceButton: HTMLButtonElement;
    restartDemoButton: HTMLButtonElement;
    previewBackdropInput: HTMLSelectElement;
    clearPreviewButton: HTMLButtonElement;
    previewSourceInput: HTMLSelectElement;
    previewStatus: HTMLParagraphElement;
    previewZoomInput: HTMLSelectElement;
    pausePreviewButton: HTMLButtonElement;
    onboarding: HTMLElement;
    dismissOnboardingButton: HTMLButtonElement;
    exportProfileButton: HTMLButtonElement;
    importProfileButton: HTMLButtonElement;
    importProfileInput: HTMLInputElement;
    transferStatus: HTMLParagraphElement;
    layoutInput: HTMLSelectElement;
    sourceDimensions: HTMLParagraphElement;
    sceneSummary: HTMLParagraphElement;
    splashText: HTMLSpanElement;
    splashDescription: HTMLSpanElement;
    profileSelect: HTMLSelectElement;
    profileNameInput: HTMLInputElement;
    newProfileButton: HTMLButtonElement;
    duplicateProfileButton: HTMLButtonElement;
    profileHint: HTMLParagraphElement;
    app: HTMLElementTagNameMap['main'];
    chat: HTMLElementTagNameMap['section'];
    connectionBadge: HTMLElementTagNameMap['div'];
    status: HTMLElementTagNameMap['span'];
    settings: HTMLElementTagNameMap['aside'];
    versionLabel: HTMLElementTagNameMap['span'];
    channelInput: HTMLElementTagNameMap['input'];
    channelError: HTMLElementTagNameMap['p'];
    fontFamilyInput: HTMLElementTagNameMap['select'];
    fontSizeInput: HTMLElementTagNameMap['input'];
    fontSizeOutput: HTMLElementTagNameMap['output'];
    textColorInput: HTMLElementTagNameMap['input'];
    fontWeightInput: HTMLElementTagNameMap['select'];
    fontStyleInput: HTMLElementTagNameMap['select'];
    lineHeightInput: HTMLElementTagNameMap['input'];
    lineHeightOutput: HTMLElementTagNameMap['output'];
    letterSpacingInput: HTMLElementTagNameMap['input'];
    letterSpacingOutput: HTMLElementTagNameMap['output'];
    themeInput: HTMLElementTagNameMap['select'];
    alignInput: HTMLElementTagNameMap['select'];
    backgroundInput: HTMLElementTagNameMap['input'];
    panelOpacityInput: HTMLElementTagNameMap['input'];
    panelOpacityOutput: HTMLElementTagNameMap['output'];
    vignetteInput: HTMLElementTagNameMap['input'];
    vignetteOutput: HTMLElementTagNameMap['output'];
    radiusInput: HTMLElementTagNameMap['input'];
    radiusOutput: HTMLElementTagNameMap['output'];
    maxMessagesInput: HTMLElementTagNameMap['input'];
    hideMessagesInput: HTMLElementTagNameMap['input'];
    lifetimeLabel: HTMLElementTagNameMap['label'];
    lifetimeInput: HTMLElementTagNameMap['input'];
    lifetimeOutput: HTMLElementTagNameMap['output'];
    resetButton: HTMLElementTagNameMap['button'];
    previewFrame: HTMLElementTagNameMap['div'];
    saveStatus: HTMLElementTagNameMap['p'];
    retrySaveButton: HTMLElementTagNameMap['button'];
    copyButton: HTMLElementTagNameMap['button'];
    obsHelp: HTMLElementTagNameMap['p'];
    overlayUrlOutput: HTMLElementTagNameMap['input'];
    debug: HTMLElementTagNameMap['p'];
    updatesSection: HTMLElementTagNameMap['details'];
    updateStatus: HTMLElementTagNameMap['p'];
    checkUpdatesButton: HTMLElementTagNameMap['button'];
    installUpdateButton: HTMLElementTagNameMap['button'];
    releaseLink: HTMLElementTagNameMap['a'];
    diagnosticsSection: HTMLElementTagNameMap['details'];
    diagnosticsButton: HTMLElementTagNameMap['button'];
    diagnosticsOutput: HTMLElementTagNameMap['pre'];
  }
  function $<K extends keyof Elements>(id: K): Elements[K] {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing required element: ${id}`);
    return element as Elements[K];
  }
  const chat = $('chat');
  const params = new URLSearchParams(location.search);
  const isOverlay = location.pathname === '/overlay';
  const requestedInstance = params.get('instance') || '';
  const instanceId = /^[a-z0-9_-]{4,64}$/i.test(requestedInstance)
    ? requestedInstance
    : `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePrefix = `chatiffy:${instanceId}:`;
  const memoryStorage = new Map<string, string>();
  const stored = (key: string) => {
    try { return localStorage.getItem(`${storagePrefix}${key}`); }
    catch (_) { return memoryStorage.get(key) ?? null; }
  };
  const save = (key: string, value: string | number) => {
    memoryStorage.set(key, String(value));
    try { localStorage.setItem(`${storagePrefix}${key}`, String(value)); }
    catch (_) { /* OBS may disable persistent storage; URL still contains the settings. */ }
  };
  const config = readSettings(params, stored);
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let joinTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 1000;
  let connectionGeneration = 0;
  let assetGeneration = 0;
  let emotes7tv = new Map<string, string>();
  let twitchBadges = new Map<string, Badge>();
  const cosmetics7tv = new Map<string, Promise<Cosmetics | null>>();
  const seenMessageIds = new Set<string>();

  let statusHideTimer: ReturnType<typeof setTimeout> | undefined;
  function setStatus(text: string, error = false) {
    $('status').textContent = text;
    if (!isOverlay) $('previewStatus').textContent = text;
    $('debug').textContent = error ? text : '';
    const badge = $('connectionBadge');
    badge.classList.toggle('error', error);
    badge.classList.add('visible');
    clearTimeout(statusHideTimer);
    if (!error && text.startsWith('Онлайн')) statusHideTimer = setTimeout(() => badge.classList.remove('visible'), 1800);
  }

  const presets: Record<string, Partial<OverlaySettings>> = {
    pixel: { fontSize: 28, panelOpacity: 32, vignette: 0, radius: 0, background: true, theme: 'pixel' },
    soft: { fontSize: 28, panelOpacity: 32, vignette: 55, radius: 24, background: false, theme: 'glass' },
    compact: { fontSize: 22, panelOpacity: 45, vignette: 35, radius: 12, background: false, theme: 'clean' },
    neon: { fontSize: 28, panelOpacity: 28, vignette: 72, radius: 26, background: true, theme: 'neon' },
    transparent: { fontSize: 28, panelOpacity: 0, vignette: 0, radius: 0, background: false, theme: 'glass' }
  };
  const appearanceHistory: OverlaySettings[] = [];
  let appearanceBaseline: OverlaySettings | undefined;
  let appearanceProfile = '';
  function appearanceKey(settings: OverlaySettings) {
    const { channel, layout, ...appearance } = settings;
    return JSON.stringify(appearance);
  }
  function appearanceLocked() {
    try { return localStorage.getItem(`chatiffy:appearanceLock:${profileId}`) === '1'; } catch { return false; }
  }
  function updateAppearanceLock(busy = profileOperation || !profileReady) {
    if (isOverlay) return;
    const locked = appearanceLocked();
    $('lockAppearanceButton').disabled = busy;
    $('lockAppearanceButton').textContent = locked ? 'Разблокировать оформление' : 'Защитить оформление';
    $('lockAppearanceButton').setAttribute('aria-pressed', String(locked));
    $('appearanceLockStatus').textContent = locked
      ? 'Оформление защищено в этом браузере. Для экспериментов создай копию профиля.'
      : 'Изменения оформления сохраняются автоматически.';
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('.appearance-panel input, .appearance-panel select, .appearance-panel button, [data-preset]')) {
      if (control !== $('lockAppearanceButton')) control.disabled = busy || locked;
    }
    $('undoAppearanceButton').disabled = busy || locked || !appearanceHistory.length;
    $('resetButton').disabled = busy || locked;
  }
  function syncUi() {
    if (!isOverlay && (appearanceProfile !== profileId || !appearanceBaseline)) {
      appearanceHistory.length = 0; appearanceProfile = profileId; appearanceBaseline = { ...config };
    }
    updateAppearanceLock();

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
      const preset = presets[button.dataset.preset || ''];
      const selected = !!preset && Object.entries(preset).every(([key, value]) => config[key as keyof OverlaySettings] === value);
      button.setAttribute('aria-pressed', String(selected));
    }
    $('channelInput').value = String(config.channel);
    $('layoutInput').value = config.layout;
    const canvas = canvasSizes[config.layout];
    $('sourceDimensions').textContent = `Размер только для предпросмотра: ${canvas.width} × ${canvas.height}. Размер источника задаётся вручную в OBS.`;
    $('obsHelp').textContent = `В OBS: «Источники» → «+» → «Браузер». Вставь ссылку, укажи ширину ${canvas.width} и высоту ${canvas.height}. После добавления оформление обновляется автоматически.`;
    $('sceneSummary').textContent = `«${profileName}» · #${config.channel}`;
    for (const key of ['fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing'] as const) $(`${key}Input`).value = String(config[key]);
    $('lineHeightOutput').value = config.lineHeight.toFixed(2);
    $('letterSpacingOutput').value = `${config.letterSpacing} px`;
    for (const target of [chat]) {
      target.style.setProperty('--chat-font', fontFamilies[config.fontFamily]);
      target.style.setProperty('--chat-weight', config.fontWeight);
      target.style.setProperty('--chat-style', config.fontStyle);
      target.style.setProperty('--chat-line', String(config.lineHeight));
      target.style.setProperty('--chat-spacing', `${config.letterSpacing}px`);
    }
    $('fontSizeInput').value = String(config.fontSize);
    $('fontSizeOutput').value = `${config.fontSize} px`;
    $('hideMessagesInput').checked = config.lifetime > 0;
    $('lifetimeLabel').hidden = config.lifetime === 0;
    $('lifetimeInput').value = String(config.lifetime || 30);
    $('lifetimeOutput').value = config.lifetime ? `${config.lifetime} сек` : 'всегда';
    $('maxMessagesInput').value = String(config.maxMessages);
    $('backgroundInput').checked = config.background;
    $('themeInput').value = String(config.theme);
    $('alignInput').value = String(config.align);
    $('textColorInput').value = String(config.textColor);
    $('panelOpacityInput').value = String(config.panelOpacity);
    $('panelOpacityOutput').value = `${config.panelOpacity}%`;
    $('vignetteInput').value = String(config.vignette);
    $('vignetteOutput').value = `${config.vignette}%`;
    $('radiusInput').value = String(config.radius);
    $('radiusOutput').value = `${config.radius} px`;
    document.documentElement.style.setProperty('--font-size', `${config.fontSize}px`);
    document.documentElement.style.setProperty('--text-color', config.textColor);
    document.documentElement.style.setProperty('--panel-opacity', (config.panelOpacity / 100).toFixed(2));
    document.documentElement.style.setProperty('--vignette', (config.vignette / 100).toFixed(2));
    document.documentElement.style.setProperty('--panel-radius', `${config.radius}px`);
    chat.classList.toggle('with-background', config.background);
    chat.classList.toggle('align-right', config.align === 'right');
    chat.classList.remove('theme-pixel', 'theme-glass', 'theme-clean', 'theme-neon');
    chat.classList.add(`theme-${config.theme}`);
    if ($('overlayUrlOutput')) $('overlayUrlOutput').value = createOverlayUrl();
    updateScale();
    if (!isOverlay) renderPreview();
  }

  function updateScale() {
    const canvas = canvasSizes[config.layout];
    const width = isOverlay ? innerWidth : canvas.width;
    const height = isOverlay ? innerHeight : canvas.height;
    const scale = Math.max(.68, Math.min(1.45, Math.min(width / 600, height / 900)));
    document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
    // Match source padding to the logical canvas, not the editor window dimensions.
    chat.style.padding = `${Math.max(14, Math.min(30, Math.min(width, height) * .027))}px`;
    if (!isOverlay) {
      const frame = $('previewFrame');
      const native = $('previewZoomInput').value === 'actual';
      frame.classList.toggle('preview-native', native);
      frame.style.setProperty('--preview-ratio', `${canvas.width} / ${canvas.height}`);
      frame.style.setProperty('--preview-width', `${Math.min(430, Math.max(120, innerHeight - 350) * canvas.width / canvas.height)}px`);
      const previewScale = native ? 1 : Math.max(.01, frame.clientWidth / canvas.width);
      chat.style.width = `${canvas.width}px`;
      chat.style.height = `${canvas.height}px`;
      chat.style.transform = `scale(${previewScale})`;
      if (native) frame.scrollTop = frame.scrollHeight;
    }
  }

  async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveTwitchId(channel: string) {
    const knownChannels: Record<string, string> = { zakvielchannel: '44407373' };
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

  const emoteProviders = new EmoteRegistry().register(sevenTvProvider);
  async function load7tv(twitchId: string, generation: number) {
    const next = await emoteProviders.load({ twitchId, fetch: fetchWithTimeout });
    if (generation !== assetGeneration) return;
    emotes7tv = next;
    if (!next.size) $('debug').textContent = 'Провайдеры временно не вернули эмоуты; Twitch-чат продолжает работать.';
  }

  function addHelixBadges(sets: BadgeSet[] | undefined, target: Map<string, Badge>) {
    for (const set of sets || []) {
      for (const version of set.versions || []) {
        target.set(`${set.set_id}/${version.id}`, {
          url: version.image_url_2x || version.image_url_1x,
          title: version.title || set.set_id
        });
      }
    }
  }

  async function loadBadges(channelId: string, generation: number) {
    const cdn = (id: string) => `https://static-cdn.jtvnw.net/badges/v1/${id}/2`;
    const next = new Map([
      ['broadcaster/1', { url: cdn('5527c58c-fb7d-422d-b71b-f309dcb85cc1'), title: 'Стример' }],
      ['moderator/1', { url: cdn('d97c37bd-a6f5-4c38-8f57-4e4bef88af34'), title: 'Модератор' }],
      ['vip/1', { url: cdn('b817aba4-fad8-49e2-b88a-7cc744dfa6ec'), title: 'VIP' }],
      ['subscriber/0', { url: cdn('5d9f2208-5dd8-11e7-8513-2ff4adfae661'), title: 'Подписчик' }],
      ['founder/0', { url: cdn('fc71386c-86cd-11e7-a55d-43f591dc0c71'), title: 'Основатель' }]
    ]);
    if (generation !== assetGeneration) return;
    twitchBadges = next;

    try {
      // На HTTP-сервере полный каталог безопасно загружается через локальный API.
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        const url = channelId ? `/api/badges?channelId=${channelId}` : '/api/badges';
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetchWithTimeout(url, {}, 9000);
            if (!response.ok) throw new Error('Twitch badge catalog unavailable');
            const data = await response.json();
            addHelixBadges(data.global, next);
            addHelixBadges(data.channel, next); // Канальные версии имеют приоритет.
            break;
          } catch (error) {
            if (generation !== assetGeneration || attempt === 1) throw error;
          }
        }
      }
      if (generation !== assetGeneration) return;
      twitchBadges = next;
      for (const row of chat.querySelectorAll<HTMLElement>('.message')) renderBadges(row, row.dataset.badges);
    } catch (_) { /* Встроенные значки остаются при недоступности Twitch. */ }
  }

  async function refreshAssets(channel: string) {
    const generation = ++assetGeneration;
    emotes7tv = new Map();
    const globalBadges = loadBadges('', generation);
    try {
      const twitchId = await resolveTwitchId(channel);
      if (generation !== assetGeneration) return;
      await globalBadges;
      if (generation !== assetGeneration) return;
      await Promise.allSettled([
        load7tv(twitchId, generation),
        loadBadges(twitchId, generation)
      ]);
    } catch (error) {
      if (generation === assetGeneration) $('debug').textContent = error instanceof Error ? error.message : 'Ошибка загрузки ресурсов';
    }
  }

  function image(url: string, alt: string) {
    const img = document.createElement('img');
    img.className = 'emote'; img.src = url; img.alt = alt; img.title = alt;
    img.decoding = 'async';
    img.onerror = () => img.replaceWith(document.createTextNode(alt));
    return img;
  }

  function appendBadges(container: HTMLElement, badges: readonly Badge[]) {
    if (!badges.length) return;
    const wrap = document.createElement('span');
    wrap.className = 'badges';
    for (const badge of badges) {
      const img = document.createElement('img');
      img.className = 'badge';
      img.src = badge.url;
      img.alt = badge.title;
      img.title = badge.title;
      img.decoding = 'async';
      img.onerror = () => img.remove();
      wrap.append(img);
    }
    container.prepend(wrap);
    return wrap;
  }

  function renderBadges(container: HTMLElement, tag: string | undefined) {
    container.querySelector('.badges-twitch')?.remove();
    if (!tag) return;
    const badges: Badge[] = [];
    for (const badgeId of tag.split(',')) {
      const [setId] = badgeId.split('/');
      const badge = twitchBadges.get(badgeId)
        || ((setId === 'subscriber' || setId === 'founder') ? twitchBadges.get(`${setId}/0`) : null);
      if (badge) badges.push(badge);
    }
    appendBadges(container, badges)?.classList.add('badges-twitch');
  }

  const previewBadgeRequests = new Map<string, { until: number; request: Promise<Badge[] | null> }>();
  async function renderCurrentPreviewBadges(row: HTMLElement, userId: string, fallback: Badge[]) {
    let entry = previewBadgeRequests.get(userId);
    if (!entry || Date.now() > entry.until) {
      const request = fetchWithTimeout(`/api/preview/badges?userId=${userId}`, {}, 9000)
        .then(async response => response.ok ? (await response.json()).badges as Badge[] : null).catch(() => null);
      entry = { until: Date.now() + 300000, request }; previewBadgeRequests.set(userId, entry);
    }
    const badges = await entry.request;
    if (!badges || !row.isConnected) return;
    const next = [...badges];
    for (const badge of fallback) if (badge.title === 'Verified' && !next.some(b => b.url === badge.url)) next.push(badge);
    row.querySelector('.badges-preview')?.remove();
    appendBadges(row, next)?.classList.add('badges-preview');
  }

  function rgba7tv(value: number | null | undefined) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return '';
    return `rgba(${(value >>> 24) & 255}, ${(value >>> 16) & 255}, ${(value >>> 8) & 255}, ${((value & 255) / 255).toFixed(3)})`;
  }

  function paint7tvAuthor(author: HTMLElement, paint: Paint | null, fallbackColor: string) {
    if (!paint) {
      if (fallbackColor) author.style.color = fallbackColor;
      return;
    }
    author.classList.add('author-painted');
    const kind = String(paint.function || '').toUpperCase().replaceAll('-', '_');
    const stops = Array.isArray(paint.stops)
      ? paint.stops.filter((stop) => Number.isFinite(stop.at) && Number.isInteger(stop.color))
        .map((stop) => `${rgba7tv(stop.color)} ${Math.max(0, Math.min(100, stop.at * 100))}%`)
      : [];
    let background = '';
    if ((kind === 'LINEAR_GRADIENT' || kind === 'RADIAL_GRADIENT') && stops.length) {
      const repeat = paint.repeat ? 'repeating-' : '';
      const prefix = kind === 'LINEAR_GRADIENT' ? `${Number(paint.angle) || 0}deg, ` : `${paint.shape === 'ellipse' ? 'ellipse' : 'circle'}, `;
      background = `${repeat}${kind === 'LINEAR_GRADIENT' ? 'linear' : 'radial'}-gradient(${prefix}${stops.join(', ')})`;
    } else if (kind === 'URL' && /^https:\/\/cdn\.7tv\.app\//.test(paint.image_url || '')) {
      background = `url("${paint.image_url}")`;
    }
    const solid = rgba7tv(paint.color) || fallbackColor;
    if (background) {
      author.style.backgroundImage = background;
      author.style.backgroundPosition = 'center';
      author.style.backgroundSize = 'cover';
      author.style.backgroundClip = 'text';
      author.style.webkitBackgroundClip = 'text';
      author.style.color = 'transparent';
      author.style.webkitTextFillColor = 'transparent';
    } else if (solid) {
      author.style.color = solid;
    }
    const shadows = Array.isArray(paint.shadows) ? paint.shadows.slice(0, 8) : [];
    const filters = shadows.map((shadow) => {
      const x = Math.max(-20, Math.min(20, Number(shadow.x_offset) || 0));
      const y = Math.max(-20, Math.min(20, Number(shadow.y_offset) || 0));
      const radius = Math.max(0, Math.min(20, Number(shadow.radius) || 0));
      const color = rgba7tv(shadow.color);
      return color ? `drop-shadow(${x}px ${y}px ${radius}px ${color})` : '';
    }).filter(Boolean);
    if (filters.length) author.style.filter = filters.join(' ');
  }

  function load7tvCosmetics(userId: string, login: string) {
    if (!cosmetics7tv.has(userId)) {
      const query = new URLSearchParams({ userId, login });
      const request = fetchWithTimeout(`/api/7tv-cosmetics?${query}`, {}, 9000)
        .then((response): Promise<Cosmetics | null> | null => response.ok ? response.json() as Promise<Cosmetics> : null)
        .catch(() => null);
      cosmetics7tv.set(userId, request);
    }
    return cosmetics7tv.get(userId);
  }

  async function render7tvCosmetics(row: HTMLElement, author: HTMLElement, userId: string, login: string) {
    if (!userId) return;
    const cosmetic = await load7tvCosmetics(userId, login);
    if (!cosmetic || !row.isConnected) return;
    paint7tvAuthor(author, cosmetic.paint, rgba7tv(cosmetic.color));
    if (!cosmetic.badge?.url) return;
    let wrap = row.querySelector<HTMLElement>('.badges-7tv');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'badges badges-7tv';
      row.insertBefore(wrap, author);
    }
    if (wrap.querySelector(`[data-7tv-badge="${cosmetic.badge.id}"]`)) return;
    const badge = document.createElement('img');
    badge.className = 'badge badge-7tv';
    badge.setAttribute('data-7tv-badge', cosmetic.badge.id);
    badge.src = cosmetic.badge.url;
    badge.alt = cosmetic.badge.tooltip || cosmetic.badge.name || '7TV badge';
    badge.title = badge.alt;
    badge.decoding = 'async';
    badge.onerror = () => badge.remove();
    wrap.append(badge);
  }

  function renderContent(container: HTMLElement, text: string, twitchTag: string | undefined) {
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

  function render7tvText(container: HTMLElement, text: string) {
    const parts = text.split(/(\s+)/);
    for (const part of parts) {
      const url = (isOverlay || $('previewSourceInput').value !== 'demo') ? emotes7tv.get(part) : demoEmotes.get(part);
      container.append(url ? image(url, part) : document.createTextNode(part));
    }
  }

  function removeMessage(node: HTMLElement | null) {
    if (!node?.isConnected) return;
    node.classList.add('removing');
    setTimeout(() => node.remove(), 350);
  }

  function showMessage(message: ChatMessage) {
    const messageId = message.tags.id || '';
    if (messageId && seenMessageIds.has(messageId)) return;
    if (messageId) {
      seenMessageIds.add(messageId);
      if (seenMessageIds.size > 500) seenMessageIds.delete(seenMessageIds.values().next().value!);
    }
    const row = document.createElement('div');
    row.className = 'message';
    row.dataset.messageId = messageId;
    row.dataset.userId = message.tags['user-id'] || '';
    row.dataset.badges = message.tags.badges || '';
    const author = document.createElement('span');
    author.className = 'author';
    author.style.color = message.tags.color || '#b89cff';
    author.textContent = `${message.tags['display-name'] || message.user}:`;
    renderBadges(row, message.tags.badges);
    if (!isOverlay && $('previewSourceInput').value === 'demo') {
      const identity = Object.values(demoIdentities).find(item => item.userId === row.dataset.userId);
      if (identity) {
        appendBadges(row, identity.badges)?.classList.add('badges-preview');
        renderCurrentPreviewBadges(row, identity.userId, identity.badges);
      }
    }
    row.append(author, document.createTextNode(' '));
    renderContent(row, message.text, message.tags.emotes);
    chat.append(row);
    render7tvCosmetics(row, author, row.dataset.userId, message.user);
    while (chat.children.length > config.maxMessages) chat.firstElementChild?.remove();
    if (isOverlay && config.lifetime > 0) setTimeout(() => removeMessage(row), config.lifetime * 1000);
    if (!isOverlay && $('previewSourceInput').value !== 'demo') livePreviewMessages.push({ row, time: livePreviewTime });
  }

  function handleModerationLine(line: string) {
    const tagMatch = line.match(/^@([^ ]+) /);
    const tags: Record<string, string> = tagMatch ? parseTags(tagMatch[1]) : {};
    if (line.includes(' CLEARMSG ')) {
      const id = tags['target-msg-id'];
      for (const row of chat.querySelectorAll<HTMLElement>('.message')) if (row.dataset.messageId === id) removeMessage(row);
    }
    if (line.includes(' CLEARCHAT ')) {
      const userId = tags['target-user-id'];
      for (const row of chat.querySelectorAll<HTMLElement>('.message')) {
        if (!userId || row.dataset.userId === userId) removeMessage(row);
      }
    }
  }

  function clearConnectionTimers() {
    clearTimeout(reconnectTimer);
    clearTimeout(joinTimer);
    clearTimeout(watchdogTimer);
  }

  function armWatchdog(generation: number) {
    clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      if (generation === connectionGeneration && socket?.readyState === WebSocket.OPEN) socket.close(4000, 'Twitch timeout');
    }, 6 * 60 * 1000);
  }

  function scheduleReconnect(generation: number, immediate = false) {
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
        if (message && (isOverlay || (!livePreviewPaused && $('previewSourceInput').value !== 'demo'))) showMessage(message);
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

  let profileId = /^[a-f0-9]{32}$/.test(params.get('profile') || '') ? params.get('profile')! : '';
  let profileReady = false;
  let profileName = 'Основной профиль';
  let pendingChanges = false;
  let profileOperation = false;
  interface ProfileSummary { id: string; name: string; channel: string }
  let profileList: ProfileSummary[] = [];
  const snapshotOfProfile = () => JSON.stringify({ name: profileName, settings: config });
  let savedSnapshot = '';
  let revision = '';
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveChain: Promise<void> = Promise.resolve();
  let stopped = false;

  function createOverlayUrl() {
    return new URL(`/overlay?profile=${profileId}`, location.origin).href;
  }
  let syncDemoPlayback = () => {};
  let demoIsPaused = false;
  let livePreviewPaused = false;
  let livePreviewChannel = '';
  let previewStarted = false;
  const previewMessages: { row: HTMLElement; time: number }[] = [];
  const livePreviewMessages: { row: HTMLElement; time: number }[] = [];
  let livePreviewTime = 0;
  let lastPreviewTick = Date.now();
  if (!isOverlay) setInterval(() => {
    const now = Date.now(); const elapsed = Math.min(now - lastPreviewTick, 1000); lastPreviewTick = now;
    if (livePreviewPaused || document.hidden || $('previewSourceInput').value === 'demo') return;
    livePreviewTime += elapsed;
    for (let i = livePreviewMessages.length - 1; i >= 0; i--) {
      const { row, time } = livePreviewMessages[i];
      if (!row.isConnected) { livePreviewMessages.splice(i, 1); continue; }
      if (config.lifetime > 0 && livePreviewTime - time >= config.lifetime * 1000) {
        removeMessage(row); livePreviewMessages.splice(i, 1);
      }
    }
  }, 250);
  function renderPreview() {
    if (profileReady && $('previewSourceInput').value !== 'demo' && livePreviewChannel !== config.channel) {
      livePreviewChannel = config.channel; chat.replaceChildren(); seenMessageIds.clear();
      connect(); void refreshAssets(config.channel);
    }
    while (chat.children.length > config.maxMessages) chat.firstElementChild?.remove();
    if (previewStarted) return;
    previewStarted = true;
    const demo = startDemoChat((message, time) => {
      if ($('previewSourceInput').value !== 'demo') return;
      showMessage(message);
      if ($('previewZoomInput').value === 'actual') $('previewFrame').scrollTop = $('previewFrame').scrollHeight;
      const row = chat.lastElementChild as HTMLElement | null;
      if (row) previewMessages.push({ row, time });
      while (previewMessages.length > 50) previewMessages.shift();
    }, time => {
      for (let i = previewMessages.length - 1; i >= 0; i--) {
        const { row, time: created } = previewMessages[i];
        if (!row.isConnected) { previewMessages.splice(i, 1); continue; }
        if (config.lifetime > 0 && time - created >= config.lifetime * 1000) {
          removeMessage(row); previewMessages.splice(i, 1);
        }
      }
    });
    let enginePaused = false;
    syncDemoPlayback = () => {
      const shouldPause = demoIsPaused || $('previewSourceInput').value !== 'demo';
      if (enginePaused !== shouldPause) enginePaused = demo.togglePause();
    };
    syncDemoPlayback();
    $('restartDemoButton').onclick = () => {
      if ($('previewSourceInput').value !== 'demo') return;
      chat.replaceChildren(); seenMessageIds.clear(); previewMessages.length = 0;
      demo.restart();
      $('previewStatus').textContent = demoIsPaused ? 'Демо начато заново · на паузе' : 'Демо начато заново';
    };
    $('pausePreviewButton').onclick = () => {
      const paused = $('previewSourceInput').value === 'demo' ? (demoIsPaused = !demoIsPaused) : (livePreviewPaused = !livePreviewPaused);
      syncDemoPlayback();
      $('previewStatus').textContent = paused
        ? 'Предпросмотр на паузе · OBS продолжает работать'
        : $('previewSourceInput').value === 'demo' ? 'Демо-чат · можно сразу настраивать оформление.' : `Ожидаем новые сообщения #${config.channel} · история не загружается`;
      $('pausePreviewButton').textContent = paused ? 'Продолжить чат' : 'Пауза';
      $('pausePreviewButton').setAttribute('aria-pressed', String(paused));
    };
  }
  function persistLocal() {
    for (const [key, value] of Object.entries(config)) save(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    save('settingsVersion', settingsVersion);
  }
  function readControls(): boolean {
    const channel = $('channelInput').value.trim().toLowerCase().replace(/^#/, '');
    if (!/^[a-z0-9_]{1,25}$/.test(channel)) {
      $('channelError').textContent = 'Введите Twitch-логин: латинские буквы, цифры и подчёркивание.';
      $('copyButton').disabled = true;
      return false;
    }
    $('channelError').textContent = '';
    const name = $('profileNameInput').value.trim();
    if (!name) { $('profileHint').textContent = 'Добавь название профиля, чтобы отличать её от остальных.'; $('copyButton').disabled = true; return false; }
    profileName = name.slice(0, 64);
    config.channel = channel;
    config.layout = settingsSchema.layout.parse($('layoutInput').value);
    if (appearanceLocked()) return true;
    for (const key of ['layout', 'fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'fontSize', 'theme', 'align', 'textColor', 'panelOpacity', 'vignette', 'radius', 'maxMessages'] as const) {
      const element = $(`${key}Input`);
      Object.assign(config, { [key]: settingsSchema[key].parse(element.value) });
    }
    config.background = $('backgroundInput').checked;
    config.lifetime = $('hideMessagesInput').checked ? settingsSchema.lifetime.parse($('lifetimeInput').value) || 30 : 0;
    return true;
  }
  async function saveProfile(): Promise<boolean> {
    if (!profileReady || !readControls()) return false;
    clearTimeout(saveTimer);
    syncUi(); persistLocal();
    const snapshot = snapshotOfProfile();
    const targetId = profileId;
    $('copyButton').disabled = true;
    $('saveStatus').textContent = 'Сохраняется…';
    const task = saveChain.catch(() => {}).then(async () => {
      if (snapshot !== savedSnapshot) {
        const response = await fetchWithTimeout(`/api/profiles/${targetId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snapshot });
        if (!response.ok) throw new Error('Не удалось сохранить профиль');
        const data = await response.json() as { revision: string };
        if (targetId === profileId) { savedSnapshot = snapshot; revision = data.revision; }
      }
      if (targetId === profileId && snapshot === snapshotOfProfile()) {
        pendingChanges = false;
        updateProfileOption();
        $('saveStatus').textContent = 'Сохранено · OBS обновляется автоматически';
        $('retrySaveButton').hidden = true;
        $('copyButton').disabled = false;
      }
    });
    saveChain = task;
    try { await task; return true; }
    catch {
      $('saveStatus').textContent = 'Нет связи с сервером. Изменения пока только на этом устройстве.';
      $('retrySaveButton').hidden = false;
      return false;
    }
  }
  function changed() {
    if (!profileReady) return;
    pendingChanges = true;
    if (!readControls()) return;
    if (appearanceBaseline && appearanceKey(appearanceBaseline) !== appearanceKey(config)) {
      appearanceHistory.push({ ...appearanceBaseline });
      if (appearanceHistory.length > 30) appearanceHistory.shift();
    }
    appearanceBaseline = { ...config };
    persistLocal(); syncUi();
    $('saveStatus').textContent = 'Есть изменения…'; $('copyButton').disabled = true;
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { void saveProfile(); }, 450);
  }
  function updateProfileOption() {
    const item = profileList.find(profile => profile.id === profileId);
    if (item) { item.name = profileName; item.channel = config.channel; }
    else profileList.push({ id: profileId, name: profileName, channel: config.channel });
    const options = profileList.map(profile => {
      const option = document.createElement('option');
      option.value = profile.id; option.textContent = `${profile.name} · #${profile.channel}`;
      return option;
    });
    $('profileSelect').replaceChildren(...options); $('profileSelect').value = profileId;
    $('profileHint').textContent = `«${profileName}» — отдельная ссылка для этого профиля.`;
  }
  async function loadProfileList() {
    try {
      const response = await fetchWithTimeout('/api/profiles/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('Profile list unavailable');
      const data = await response.json() as { profiles: ProfileSummary[] };
      profileList = data.profiles; updateProfileOption();
    } catch { updateProfileOption(); $('profileHint').textContent = 'Список профилей недоступен. Текущий профиль открыт; обнови страницу для повторной загрузки списка.'; }
  }
  function lockProfileControls(locked: boolean) {
    $('retrySaveButton').disabled = locked;
    $('profileSelect').disabled = locked; $('newProfileButton').disabled = locked;
    $('exportProfileButton').disabled = locked; $('importProfileButton').disabled = locked; $('layoutInput').disabled = locked;
    $('duplicateProfileButton').disabled = locked; $('profileNameInput').disabled = locked;
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('.controls input, .controls select, .controls button')) control.disabled = locked;
    $('undoAppearanceButton').disabled = locked || !appearanceHistory.length;
    $('copyButton').disabled = locked || pendingChanges || !profileReady;
    updateAppearanceLock(locked);
  }
  async function selectProfile(id: string) {
    if (profileOperation || id === profileId) return;
    profileOperation = true; lockProfileControls(true); clearTimeout(saveTimer);
    try {
      if (!await saveProfile()) { $('profileSelect').value = profileId; return; }
      const response = await fetchWithTimeout(`/api/profiles/${id}`);
      if (!response.ok) throw new Error('Не удалось открыть профиль. Текущий профиль сохранён.');
      const profile = await response.json() as { name?: string; revision: string; settings: OverlaySettings };
      profileId = id; profileName = profile.name || 'Основной профиль';
      Object.assign(config, readSettings(serializeSettings(profile.settings, instanceId)));
      revision = profile.revision; savedSnapshot = snapshotOfProfile(); pendingChanges = false;
      $('profileNameInput').value = profileName; syncUi(); persistLocal(); rememberProfile(); updateProfileOption();
      $('saveStatus').textContent = 'Сохранено · OBS обновляется автоматически'; $('copyButton').disabled = false;
      $('obsHelp').hidden = true; $('copyButton').textContent = 'Скопировать ссылку для OBS';
    } catch (error) { $('profileSelect').value = profileId; $('profileHint').textContent = error instanceof Error ? error.message : 'Не удалось переключить профиль.'; }
    finally { profileOperation = false; lockProfileControls(false); }
  }
  function rememberProfile() {
    history.replaceState(null, '', `/?profile=${profileId}`);
    try { localStorage.setItem('chatiffy:lastProfile', profileId); } catch {}
  }
  async function createProfile(duplicate: boolean, imported?: ProfileBackup): Promise<boolean> {
    if (!profileReady || profileOperation) return false;
    profileOperation = true; lockProfileControls(true); clearTimeout(saveTimer);
    try {
      if (!await saveProfile()) return false;
      const id = crypto.randomUUID().replaceAll('-', '');
      const settings = imported ? { ...imported.settings } : duplicate ? { ...config } : { ...readSettings(new URLSearchParams()), channel: config.channel };
      const baseName = imported ? imported.name.slice(0, 56) : duplicate ? `${profileName.slice(0, 45)} — копия` : 'Новый профиль';
      let name = baseName; let suffix = 2;
      while (profileList.some(item => item.name === name)) name = `${baseName} ${suffix++}`;
      const response = await fetchWithTimeout(`/api/profiles/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, settings }) });
      if (!response.ok) throw new Error('Не удалось создать профиль. Текущий профиль сохранён.');
      const profile = await response.json() as { revision: string };
      profileId = id; profileName = name; Object.assign(config, settings);
      revision = profile.revision; savedSnapshot = snapshotOfProfile(); pendingChanges = false;
      $('profileNameInput').value = name; syncUi(); persistLocal(); rememberProfile(); updateProfileOption();
      $('saveStatus').textContent = 'Новый профиль сохранён · скопируй её ссылку в отдельный источник OBS';
      $('obsHelp').hidden = true; $('copyButton').disabled = false;
      return true;
    } catch (error) { $('profileHint').textContent = error instanceof Error ? error.message : 'Не удалось создать профиль.'; return false; }
    finally { profileOperation = false; lockProfileControls(false); }
  }
  function selectEditorTab(name: string) {
    for (const page of document.querySelectorAll<HTMLElement>('[data-editor-page]')) {
      page.classList.toggle('is-active', page.dataset.editorPage === name);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-editor-tab]')) {
      button.setAttribute('aria-pressed', String(button.dataset.editorTab === name));
    }
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-editor-tab]')) {
    button.onclick = () => selectEditorTab(button.dataset.editorTab || 'channel');
  }
  $('previewSourceInput').onchange = () => {
    clearConnectionTimers(); ++connectionGeneration;
    if (socket) { socket.onclose = null; socket.close(); socket = undefined; }
    demoIsPaused = false; syncDemoPlayback(); livePreviewChannel = ''; livePreviewPaused = false;
    chat.replaceChildren(); seenMessageIds.clear(); previewMessages.length = 0; livePreviewMessages.length = 0;
    $('restartDemoButton').disabled = $('previewSourceInput').value !== 'demo';
    $('pausePreviewButton').textContent = 'Пауза'; $('pausePreviewButton').setAttribute('aria-pressed', 'false');
    $('previewStatus').textContent = $('previewSourceInput').value === 'demo' ? 'Демо-чат · можно сразу настраивать оформление.' : 'Ожидаем новые сообщения канала · история не загружается';
    if ($('previewSourceInput').value === 'demo') {
      $('connectionBadge').classList.remove('visible', 'error');
      $('debug').textContent = '';
    }
    renderPreview();
  };
  const backdropChoices = ['checker', 'dark', 'light'];
  let backdrop = 'checker';
  try { backdrop = localStorage.getItem('chatiffy:previewBackdrop') || backdrop; } catch {}
  if (!backdropChoices.includes(backdrop)) backdrop = 'checker';
  $('previewBackdropInput').value = backdrop;
  $('previewFrame').dataset.backdrop = backdrop;
  $('previewBackdropInput').onchange = () => {
    const value = $('previewBackdropInput').value;
    if (!backdropChoices.includes(value)) return;
    $('previewFrame').dataset.backdrop = value;
    try { localStorage.setItem('chatiffy:previewBackdrop', value); } catch {}
  };
  $('previewZoomInput').onchange = () => {
    updateScale();
    try { localStorage.setItem('chatiffy:previewZoom', $('previewZoomInput').value); } catch {}
  };
  $('exportProfileButton').onclick = async () => {
    if (!profileReady || profileOperation) return;
    profileOperation = true; lockProfileControls(true);
    try {
      if (!await saveProfile()) { $('transferStatus').textContent = 'Сначала сохрани изменения профиля и повтори экспорт.'; return; }
      const data = JSON.stringify(makeProfileBackup(profileName, config), null, 2);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = backupFilename(profileName); document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('transferStatus').textContent = `Профиль «${profileName}» экспортирован. Файл содержит оформление и канал, без ключей Twitch и постоянной ссылки.`;
    } catch { $('transferStatus').textContent = 'Не удалось создать файл экспорта. Повтори попытку.'; }
    finally { profileOperation = false; lockProfileControls(false); }
  };
  $('importProfileButton').onclick = () => $('importProfileInput').click();
  $('importProfileInput').onchange = async () => {
    const file = $('importProfileInput').files?.[0];
    if (!file) return;
    try {
      if (file.size > maxBackupBytes) throw new Error('Файл слишком большой. Максимум — 64 КБ.');
      const backup = parseProfileBackup(await file.text());
      if (!await createProfile(false, backup)) { $('transferStatus').textContent = 'Импорт не завершён. Проверь сохранение текущего профиля и повтори.'; return; }
      $('transferStatus').textContent = `Импортирован новый профиль «${profileName}». Скопируй её ссылку в OBS. Остальные профили сохранены.`;
    } catch (error) { $('transferStatus').textContent = error instanceof Error ? error.message : 'Не удалось импортировать профиль.'; }
    finally { $('importProfileInput').value = ''; }
  };
  $('dismissOnboardingButton').onclick = () => {
    $('onboarding').hidden = true;
    try { localStorage.setItem('chatiffy:onboardingDismissed', '1'); } catch {}
  };
  $('profileSelect').onchange = () => { void selectProfile($('profileSelect').value); };
  $('newProfileButton').onclick = () => { void createProfile(false); };
  $('duplicateProfileButton').onclick = () => { void createProfile(true); };
  $('profileNameInput').addEventListener('input', changed);
  $('overlayUrlOutput').onclick = () => $('overlayUrlOutput').select();
  $('retrySaveButton').onclick = () => { if (profileReady) void saveProfile(); else void initialize(); };
  $('copyButton').onclick = async () => {
    if (profileOperation || !profileReady || !await saveProfile()) return;
    try { await navigator.clipboard.writeText(createOverlayUrl()); $('copyButton').textContent = 'Ссылка скопирована ✓'; }
    catch { prompt('Скопируйте ссылку для OBS:', createOverlayUrl()); }
    $('obsHelp').hidden = false;
    setTimeout(() => { $('copyButton').textContent = 'Скопировать ссылку для OBS'; }, 2000);
  };
  $('channelInput').addEventListener('change', changed);
  const controlIds = ['layoutInput', 'channelInput', 'fontFamilyInput', 'fontWeightInput', 'fontStyleInput', 'lineHeightInput', 'letterSpacingInput', 'fontSizeInput', 'backgroundInput', 'themeInput', 'alignInput', 'textColorInput', 'panelOpacityInput', 'vignetteInput', 'radiusInput', 'maxMessagesInput', 'lifetimeInput', 'hideMessagesInput'] as const;
  for (const id of controlIds) $(id).addEventListener('input', changed);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) button.onclick = () => {
    if (!profileReady || appearanceLocked()) return;
    Object.assign(config, presets[button.dataset.preset || '']); syncUi(); changed();
  };
  $('clearPreviewButton').onclick = () => {
    chat.replaceChildren(); previewMessages.length = 0; livePreviewMessages.length = 0;
    $('previewStatus').textContent = (demoIsPaused || livePreviewPaused)
      ? 'Предпросмотр очищен · нажмите «Продолжить чат», чтобы появились сообщения'
      : $('previewSourceInput').value === 'demo'
      ? 'Предпросмотр очищен · следующие тестовые сообщения появятся автоматически'
      : `Предпросмотр очищен · ожидаем новые сообщения #${config.channel}`;
  };
  $('lockAppearanceButton').onclick = async () => {
    if (!profileReady || profileOperation) return;
    const locked = appearanceLocked();
    if (!locked && !await saveProfile()) return;
    try { localStorage.setItem(`chatiffy:appearanceLock:${profileId}`, locked ? '0' : '1'); }
    catch { $('appearanceLockStatus').textContent = 'Браузер запретил сохранение защиты. Оформление не заблокировано.'; return; }
    updateAppearanceLock();
  };
  $('undoAppearanceButton').onclick = () => {
    if (appearanceLocked() || !profileReady || profileOperation || !readControls()) return;
    const previous = appearanceHistory.pop();
    if (!previous) return;
    const channel = config.channel; const layout = config.layout;
    Object.assign(config, previous, { channel, layout });
    appearanceBaseline = { ...config }; syncUi(); changed();
  };
  $('resetButton').onclick = () => {
    if (!profileReady || appearanceLocked()) return;
    const defaults = readSettings(new URLSearchParams()); defaults.channel = config.channel; defaults.layout = config.layout;
    if (JSON.stringify(config) !== JSON.stringify(defaults) && !confirm('Сбросить оформление? Выбранный канал сохранится.')) return;
    Object.assign(config, defaults); syncUi(); changed();
  };
  $('versionLabel').textContent = `${appVersion}${appVersion.includes('-') ? ' · ТЕСТОВАЯ' : ''}`;
  $('checkUpdatesButton').onclick = async () => {
    $('checkUpdatesButton').disabled = true; $('updateStatus').textContent = 'Проверяем GitHub…';
    $('installUpdateButton').hidden = true; $('releaseLink').hidden = true;
    try {
      const response = await fetchWithTimeout('/api/updates?refresh=1', {}, 12000);
      const data = await response.json() as { error?: string; available: boolean; desktop: boolean; latestVersion: string; releaseUrl: string };
      if (!response.ok) throw new Error(data.error || 'Не удалось проверить обновления');
      $('updateStatus').textContent = appVersion.includes('-') ? 'Тестовая сборка. Автообновление отключено; следующую тестовую версию скачай из GitHub Actions.' : data.available ? `Доступна версия ${data.latestVersion}` : 'Установлена актуальная версия.';
      $('installUpdateButton').hidden = !data.available || !data.desktop || appVersion.includes('-');
      $('releaseLink').href = data.releaseUrl; $('releaseLink').hidden = !data.available;
    } catch (error) { $('updateStatus').textContent = error instanceof Error ? error.message : 'Нет связи с GitHub.'; }
    finally { $('checkUpdatesButton').disabled = false; }
  };
  $('installUpdateButton').onclick = async () => {
    $('installUpdateButton').disabled = true;
    try {
      const response = await fetchWithTimeout('/api/desktop/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 12000);
      if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
      $('updateStatus').textContent = 'Открыто окно обновления Windows. Оно скачает и проверит архив, затем перезапустит Chatiffy. После запуска обнови эту страницу.';
    } catch (error) { $('updateStatus').textContent = error instanceof Error ? error.message : 'Ошибка обновления'; $('installUpdateButton').disabled = false; }
    finally { $('installUpdateButton').disabled = false; }
  };
  $('diagnosticsButton').onclick = async () => {
    try {
      const response = await fetchWithTimeout('/api/health');
      if (!response.ok) throw new Error('Сервер не отвечает');
      const health = await response.json();
      $('diagnosticsOutput').textContent = `Сервер: работает\nВерсия: ${health.version}\nTwitch API: ${health.twitchConfigured ? 'настроен' : 'без ключей (чат работает)'}\nВремя работы: ${health.uptimeSeconds} сек`;
    } catch { $('diagnosticsOutput').textContent = 'Нет связи с локальным сервером. Проверь приложение в трее.'; }
  };
  async function pollProfile() {
    if (stopped) return;
    try {
      const response = await fetchWithTimeout(`/api/profiles/${profileId}`);
      if (response.ok) {
        const profile = await response.json() as { settings: OverlaySettings; revision: string; name?: string };
        if (revision !== profile.revision) {
          const oldChannel = config.channel;
          Object.assign(config, readSettings(serializeSettings(profile.settings, instanceId))); revision = profile.revision;
          syncUi();
          if (oldChannel !== config.channel || !socket) { chat.replaceChildren(); seenMessageIds.clear(); connect(); void refreshAssets(config.channel); }
          while (chat.children.length > config.maxMessages) chat.firstElementChild?.remove();
        }
      } else if (!socket) setStatus('Профиль не найден. Открой редактор и сохрани настройки.', true);
    } catch { if (!socket) setStatus('Нет связи с локальным сервером', true); }
    if (!stopped) setTimeout(() => { void pollProfile(); }, 3000);
  }
  async function initialize() {
    if (isOverlay) {
      if (profileId) await pollProfile(); else { connect(); void refreshAssets(config.channel); }
      return;
    }
    try {
      if (!profileId && [...params.keys()].every(key => ['updates', 'diagnostics'].includes(key))) { try { profileId = localStorage.getItem('chatiffy:lastProfile') || ''; } catch {} }
      if (!/^[a-f0-9]{32}$/.test(profileId)) profileId = crypto.randomUUID().replaceAll('-', '');
      const response = await fetchWithTimeout(`/api/profiles/${profileId}`);
      if (response.ok) {
        const profile = await response.json() as { settings: OverlaySettings; revision: string; name?: string };
        Object.assign(config, readSettings(serializeSettings(profile.settings, instanceId))); revision = profile.revision;
        profileName = profile.name || 'Основной профиль';
        savedSnapshot = snapshotOfProfile();
      } else if (response.status !== 404) throw new Error('Profile unavailable');
      $('profileNameInput').value = profileName;
      profileReady = true; syncUi();
      rememberProfile();
      await saveProfile();
      await loadProfileList(); lockProfileControls(false);
    } catch {
      $('saveStatus').textContent = 'Не удалось загрузить профиль. Проверь сервер и повтори попытку.';
      $('retrySaveButton').hidden = false;
    }
  }
  addEventListener('resize', updateScale);
  if (!isOverlay && typeof ResizeObserver !== 'undefined') new ResizeObserver(updateScale).observe($('previewFrame'));
  addEventListener('offline', () => { if (isOverlay || $('previewSourceInput').value !== 'demo') { clearConnectionTimers(); socket?.close(); setStatus('Нет подключения к интернету', true); } });
  addEventListener('online', () => { if ((isOverlay && (profileId ? revision : true)) || (!isOverlay && profileReady && $('previewSourceInput').value !== 'demo')) connect(); else if (!isOverlay) void saveProfile(); });
  addEventListener('beforeunload', (event) => {
    if (!isOverlay && pendingChanges) { event.preventDefault(); event.returnValue = ''; return; }
    stopped = true; clearTimeout(saveTimer); clearConnectionTimers(); if (socket) { socket.onclose = null; socket.close(); } });
  document.body.classList.add(isOverlay ? 'overlay-mode' : 'editor-mode');
  if (!isOverlay) {
    $('settings').hidden = false; $('previewFrame').append(chat); lockProfileControls(true);
    startSplashes($('splashText'), $('splashDescription'));
    try { $('previewZoomInput').value = localStorage.getItem('chatiffy:previewZoom') === 'actual' ? 'actual' : 'fit'; } catch {}
    try { $('onboarding').hidden = localStorage.getItem('chatiffy:onboardingDismissed') === '1'; } catch {}
  }
  syncUi();
  void initialize();
  if (!isOverlay && params.has('updates')) { selectEditorTab('app'); $('checkUpdatesButton').click(); }
  if (!isOverlay && params.has('diagnostics')) { selectEditorTab('app'); $('diagnosticsButton').click(); }
})();
