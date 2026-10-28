import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { assertVersion } from './version.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const pkg = () => JSON.parse(readFileSync('package.json', 'utf8'));
function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command}: команда завершилась с ошибкой (${result.status}).`);
}
function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Ошибка Git');
  return result.stdout.trim();
}
function pnpm(...args) {
  // Windows .cmd launchers need cmd.exe; all arguments here are fixed menu actions.
  run('pnpm', args, { shell: process.platform === 'win32' });
}
function checks() { pnpm('run', 'check'); pnpm('test'); }
async function commitChanges() {
  const files = [...new Set([
    ...git('diff', 'HEAD', '--name-only', '--no-renames', '-z').split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')
  ].filter(Boolean))];
  if (!files.length) { console.log('Нет изменений для коммита.'); return; }
  run('git', ['status', '--short']);
  files.forEach((file, index) => console.log(`${index + 1}. ${file}`));
  const selection = (await terminal.question('Номера файлов через пробел, all — все, Enter — отмена: ')).trim();
  if (!selection) return;
  const numbers = selection.split(/\s+/).map(Number);
  if (selection !== 'all' && numbers.some(n => !Number.isInteger(n) || n < 1 || n > files.length)) throw new Error('Неверные номера файлов.');
  const selected = selection === 'all' ? files : [...new Set(numbers)].map(n => files[n - 1]);
  run('git', ['add', '--', ...selected]);
  console.log('В коммит войдут следующие изменения, включая ранее добавленные в Git:');
  run('git', ['diff', '--cached', '--stat']);
  if (await terminal.question('Показать полный diff? (y/N): ') === 'y') run('git', ['--no-pager', 'diff', '--cached']);
  const message = (await terminal.question('Сообщение коммита (Enter — отмена): ')).trim();
  if (!message) { console.log('Коммит отменён. Выбранные файлы остаются подготовленными в Git.'); return; }
  run('git', ['commit', '-m', message]);
  if ((await terminal.question('Отправить текущую ветку в origin? (y/N): ')).trim().toLowerCase() === 'y') {
    const branch = git('branch', '--show-current');
    if (!branch) throw new Error('Нет текущей ветки для отправки.');
    run('git', ['push', '-u', 'origin', branch]);
  }
}
async function release() {
  const version = assertVersion(pkg().version, { stableOnly: true });
  if (git('branch', '--show-current') !== 'main') throw new Error('Для релиза переключись на main.');
  if (git('status', '--porcelain')) throw new Error('Сначала проверь и закоммить изменения. Меню не добавляет файлы автоматически.');
  if (!readFileSync('windows/RELEASE.md', 'utf8').includes(`### Chatiffy ${version}`)) throw new Error('Добавь описание этой версии в windows/RELEASE.md.');
  if (git('tag', '--list', `v${version}`) || git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)) throw new Error('Этот тег уже существует. Выбери новую версию.');
  checks();
  const answer = await terminal.question(`Опубликовать main, beta и релиз ${version}? Введи ${version}: `);
  if (answer.trim() !== version) { console.log('Публикация отменена.'); return; }
  run('git', ['tag', `v${version}`]);
  run('git', ['push', '--atomic', 'origin', 'HEAD:main', 'HEAD:beta', `refs/tags/v${version}`]);
  console.log('GitHub Actions соберёт Setup и portable и опубликует релиз после успешных проверок.');
  console.log('https://github.com/MimiClous/chatiffy/actions/workflows/windows-release.yml');
}
try {
  let choice;
  do {
    console.log(`\nChatiffy ${pkg().version} — меню разработчика\n1. Установить зависимости\n2. Собрать и запустить приложение\n3. Проверки и тесты\n4. Собрать клиент и сервер\n5. Собрать Setup и portable локально (Windows)\n6. Изменить номер версии\n7. Выпустить текущую версию через GitHub Actions\n8. Показать состояние Git\n9. Создать коммит и отправить в GitHub\n0. Выход`);
    choice = (await terminal.question('Выбор: ')).trim();
    try {
      switch (choice) {
        case '1': pnpm('install', '--frozen-lockfile'); break;
        case '2':
          pnpm('run', 'build');
          console.log('Редактор: http://127.0.0.1:17845 — Ctrl+C завершает сервер.');
          run(process.execPath, ['server.mjs'], { env: { ...process.env, HOST: '127.0.0.1', ALLOWED_HOSTS: '127.0.0.1,localhost' } }); break;
        case '3': checks(); break;
        case '4': pnpm('run', 'build'); break;
        case '5':
          if (process.platform !== 'win32') throw new Error('На macOS используй выпуск через GitHub Actions (пункт 7). Локальная Windows-сборка требует Windows и Inno Setup 6.');
          checks();
          for (const name of ['build-windows', 'test-windows', 'test-updater', 'build-setup', 'test-setup']) run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `scripts/${name}.ps1`]);
          console.log('Готовые файлы: dist/'); break;
        case '6': {
          const version = assertVersion((await terminal.question('Новая версия (например 1.7.2): ')).trim(), { stableOnly: true });
          const data = pkg(); data.version = version;
          writeFileSync('package.json', JSON.stringify(data, null, 2) + '\n');
          console.log('Версия записана. Обнови README.md и windows/RELEASE.md, проверь изменения и создай коммит перед выпуском.'); break;
        }
        case '7': await release(); break;
        case '8': run('git', ['status', '--short', '--branch']); break;
        case '9': await commitChanges(); break;
        case '0': break;
        default: console.log('Выбери пункт от 0 до 9.');
      }
    } catch (error) { console.error(`\n${error.message}`); }
  } while (choice !== '0');
} finally { terminal.close(); }
