# Разработка, проверки и выпуск

## Подготовка

Используйте Node.js 22+ и pnpm из `packageManager` в `package.json` (11.25.0).
Компилируемый runtime-код рассчитан на Node.js 20+, но рабочее окружение и CI
используют более новые версии. На машине с Corepack выполните `corepack enable`,
затем установите/активируйте указанную версию pnpm. Если Corepack отсутствует,
установите эту версию pnpm средствами вашего окружения.

```sh
git clone https://github.com/MimiClous/chatiffy.git
cd chatiffy
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

`pnpm-lock.yaml` фиксирует версии; `pnpm-workspace.yaml` разрешает установочный
скрипт только esbuild. Необходимые зависимости разработки: TypeScript, esbuild,
`@types/node`. Runtime npm-зависимостей нет.

## Команды

| Команда | Результат |
| --- | --- |
| `pnpm run typecheck` | Строгая проверка всего `src/**/*.ts` без генерации файлов |
| `pnpm run check` | Typecheck и синтаксис совместимой серверной точки входа |
| `pnpm run build` | Bundle клиента, сервера и модулей для тестов в build/ |
| `pnpm test` | Автоматическая сборка (pretest), затем все Node-тесты |
| `pnpm start` | Запуск уже собранного сервера |
| `pnpm run build:windows` | PowerShell-сборка portable Windows ZIP |
| `pnpm run test:windows` | Проверка собранного Windows-приложения |

`pnpm start`, `start.sh` и `start.bat` требуют предварительную сборку. При изменении
TypeScript повторите build и перезапустите сервер. Встроенного watch/HMR сейчас нет.

## Запуск на macOS / Linux

```sh
pnpm run build
HOST=127.0.0.1 PORT=17845 ALLOWED_HOSTS=127.0.0.1,localhost pnpm start
```

Откройте `http://127.0.0.1:17845`. Ключи Twitch необязательны. При пустом ALLOWED_HOSTS
сервер специально возвращает 403. Переменные из `.env` автоматически читает Docker
Compose; для ручного запуска экспортируйте их или используйте `node --env-file=.env server.mjs`.
При Node-запуске файл `.env` должен существовать. Не публикуйте секреты.

## Запуск на Windows из исходников

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
$env:HOST = '127.0.0.1'
$env:ALLOWED_HOSTS = '127.0.0.1,localhost'
pnpm start
```

Это запуск сервера в консоли. Для трея нужна отдельная Windows-сборка ниже.

## Тесты

- `test.mjs`: HTTP/HEAD, Host allowlist, методы, ввод API, статический allowlist,
  недоступность секретов/исходников, контракт DOM и shutdown desktop-сервера.
- `typography.test.mjs`: исполнение реального browser bundle в VM с DOM-заглушкой;
  настройки, live-обновление, storage, приоритеты, ссылки и граничные значения.
- `tests/modules.test.mjs`: схема настроек, IRC, TTL и stale cache с управляемыми часами,
  провайдеры с подменой fetch, сбои/коллизии и фильтрация URL.
- `scripts/test-windows.ps1`: запуск реального WinForms EXE и вложенного Node.

Серверные тесты используют случайный localhost-порт. В sandbox может потребоваться
разрешение на listen; ошибка запуска сервера при таком запрете не означает ошибку HTTP-логики.
VM-тесты не заменяют визуальную проверку браузера и OBS; они не проверяют загрузку реального
системного шрифта. Тесты модулей не требуют Twitch-сети или секретов.

Ручная проверка: измените типографику, сохраните ссылку, откройте `/overlay` в OBS,
проверьте кириллицу/эмоуты, затем перезапустите источник. На macOS системные шрифты
могут отличаться от Windows. Финальный вид проверяйте на компьютере с OBS.

## Portable Windows ZIP

Собирать WinForms-лаунчер нужно на Windows с .NET Framework и официальным Node.js 24
LTS x64. В распакованной дистрибуции Node рядом с node.exe должен находиться LICENSE.

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -NodePath C:\node\node.exe
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows.ps1
```

Build script дополнительно создаёт bundle через `scripts/build.mjs`, компилирует C#,
копирует ресурсы и Node runtime, формирует ZIP и SHA-256. Если папка сборки уже есть,
скрипт останавливается: переместите старую сборку перед повторным запуском.

Полный архив должен сохранять структуру app/build. Не запускайте только извлечённый EXE.
Тест требует свободного 17845 и закрытого Chatiffy. Он пишет настройки/журнал в обычную
пользовательскую папку, сохраняя уже существующие настройки.

## GitHub Actions и релиз

Linux CI устанавливает зависимости по lockfile, выполняет strict check, все тесты
и Docker build. Windows workflow устанавливает проверенный SHA-256 Node runtime,
зависимости, запускает check/test, собирает и проверяет ZIP, сохраняет artifacts.

Для выпуска: обновите `package.json`, `windows/RELEASE.md` и примеры версии в README,
проверьте изменения и создайте тег `v<версия package.json>` на коммите выпуска.
Отправка тега `v*` запускает публикацию GitHub Release после успешных проверок.
В релиз прикладываются ZIP и SHA-256. Тег с несовпадающей версией отклоняется.
Не объявляйте релиз готовым до завершения Windows job.

Пример для подготовленного коммита 1.5.0:

```sh
git tag v1.5.0
git push --atomic origin main v1.5.0
```

Если тег/релиз уже существует, выберите следующую версию. Не переписывайте опубликованные
теги. Эти команды публикуют изменения в удалённом репозитории; выполняйте их только
в рамках согласованного выпуска.

## Docker

```sh
cp .env.example .env
# заполните разрешённые хосты и, при необходимости, Twitch-ключи
docker compose up -d --build
```

Dockerfile использует два этапа: builder с pnpm/TypeScript и runtime с Node, build,
HTML/CSS и assets. Исходники, зависимости разработки и документация не попадают
в runtime-образ. `.dockerignore` исключает секреты и локальную сборку; build создаётся
внутри образа. Build-сценарий scripts/build.mjs должен входить в build context.

## Совместимость и обслуживание

Публичные `/app.js`, `server.mjs`, `/overlay` и параметры ссылки сохранены. Корневой app.js
больше не исходник: редактируйте `src/client/main.ts`. Трей остаётся C#, миграция TS не
добавляет встроенный браузер и не меняет протокол запуска Node. При обновлении обновляйте
весь комплект файлов; смешение старого HTML с новым bundle не поддерживается.

При добавлении зависимости оцените, нужна ли она в runtime или только при сборке.
Обновляйте lockfile вместе с package.json. Для модулей проверяйте типы, ошибки внешних
данных, совместимость URL и поведение при сбоях. Инструкция добавления возможностей —
в [EXTENDING.md](EXTENDING.md), нормативные параметры — в [SPECIFICATION.md](SPECIFICATION.md).

## Профили и обновления в 1.5.0

Новые URL используют profile, редактор сохраняет изменения автоматически. Docker Compose
подключает volume profiles к /data. Для локального запуска можно задать CHATIFFY_DATA_DIR.
Тестовые Windows ZIP и разработка в beta: [UPDATES-AND-TESTING.md](UPDATES-AND-TESTING.md).
