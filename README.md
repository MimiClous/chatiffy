# Chatiffy

Отказоустойчивый Twitch-чат для OBS с нативными Twitch-эмоутами, глобальными и
канальными 7TV-эмоутами (включая анимированные), а также полным каталогом Twitch-бейджей.

## Как пользоваться

1. Откройте `http://IP_СЕРВЕРА:8080` в браузере или пользовательской док-панели OBS.
2. Выберите канал и оформление.
3. Нажмите «Применить и подключиться».
4. Нажмите «Скопировать ссылку для OBS» или скопируйте её из поля ниже.
5. В OBS добавьте источник **Браузер**, вставьте URL и задайте размер 600 × 900.

Маршрут `/` показывает только редактор и готовую ссылку — чат и соединение Twitch в
док-панели не запускаются. Готовая ссылка использует маршрут `/overlay`; там, наоборот,
показывается только чат без элементов редактора.
Каждая ссылка содержит независимый `instance`, поэтому настройки разных пользователей
и источников OBS не смешиваются.

Сообщения по умолчанию не исчезают по таймеру (`lifetime=0`). После достижения
лимита самое старое сообщение уходит вверх. По умолчанию на экране остаются 9 сообщений.

## Развёртывание через Docker Compose

Требуется Docker Engine и Docker Compose. Клонируйте репозиторий:

```bash
git clone git@github.com:MimiClous/chatiffy.git
cd chatiffy
cp .env.example .env
nano .env
```

Заполните `.env`:

```dotenv
TWITCH_CLIENT_ID=ваш_client_id
TWITCH_CLIENT_SECRET=ваш_client_secret
ALLOWED_HOSTS=chat.example.com,www.chat.example.com,127.0.0.1,localhost
APP_PORT=8080
```

Client ID и Client Secret создаются в [Twitch Developer Console](https://dev.twitch.tv/console/apps).
Секрет остаётся на сервере: `.env` исключён из Git и Docker build context.

Для современного Compose:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

Для Compose 1.29 из Debian используйте дефис:

```bash
docker-compose up -d --build
docker-compose ps
docker-compose logs --tail=100
```

Проверка:

```bash
curl http://127.0.0.1:8080/api/health
```

Ожидается `"ok":true` и `"twitchConfigured":true`. Без Twitch API-ключей чат и
7TV продолжат работать, но будут доступны только основные встроенные бейджи.

## Обновление

```bash
cd /root/chatiffy
git pull
docker-compose up -d --build
```

После обновления нажмите в OBS «Обновить кэш текущей страницы» у Browser Source.

## Параметры ссылки

Пример:

```text
http://SERVER:8080/overlay?instance=chat-abc123&channel=mimiclous&size=28&lifetime=0&max=9&background=0&theme=glass&align=left&text=%23ffffff&panel=32&vignette=55&radius=24
```

- `channel` — Twitch-логин канала;
- `size` — размер текста, 16–48 px;
- `lifetime` — время жизни сообщения, `0` означает «всегда»;
- `max` — количество сообщений, 5–30;
- `background` — отдельные подложки сообщений (`0`/`1`);
- `theme` — `glass`, `clean` или `neon`;
- `align` — `left` или `right`;
- `panel`, `vignette`, `radius` — оформление общей панели.

## Надёжность и безопасность

- Twitch-чат подключается сразу; сбой 7TV или Helix его не блокирует.
- WebSocket автоматически отвечает на PING, обрабатывает RECONNECT и восстанавливается
  с экспоненциальной задержкой и jitter.
- Внешние HTTP-запросы имеют таймауты; каталоги кешируются и используют stale-if-error.
- Повторные Twitch-сообщения фильтруются; удаления модераторов обрабатываются.
- Сервер отдаёт только `index.html`, `app.js` и `style.css`. `.env` и исходники сервера
  нельзя скачать по HTTP.
- Контейнер работает от непривилегированного пользователя, с read-only filesystem,
  ограниченными логами и healthcheck.

## Локальные проверки

Нужен Node.js 20 или новее. Внешних npm-зависимостей нет.

```bash
npm run check
npm test
```

## Структура

- `index.html`, `style.css`, `app.js` — редактор и OBS-оверлей;
- `server.mjs` — HTTP/API-сервер;
- `compose.yaml`, `Dockerfile` — production-развёртывание;
- `test.mjs` — интеграционные проверки сервера.
