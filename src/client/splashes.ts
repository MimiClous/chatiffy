interface Splash { title: string; description: string }

const splashes: readonly Splash[] = [
  { title: 'Твой чат. Твои правила!', description: 'Выбирай стиль — изменения сами появятся в OBS.' },
  { title: 'Теперь с автосохранением!', description: 'Настрой один раз. Меняй когда захочешь.' },
  { title: 'Осторожно: слишком уютно!', description: 'Подбери шрифт, цвет и фон под настроение стрима.' },
  { title: 'Построено из пикселей!', description: 'И немного заботы о твоём чате.' },
  { title: 'Одна ссылка — много магии!', description: 'Вставь ссылку в OBS один раз и меняй оформление здесь.' },
  { title: 'Криперы не требуются!', description: 'Для чтения чата не нужен ни бот, ни вход в Twitch.' },
  { title: 'Ещё один блок уюта!', description: 'Создай отдельный профиль для каждой сцены OBS.' },
  { title: 'Не забудь про чат!', description: 'Проверь оформление на тестовых сообщениях до начала стрима.' },
  { title: 'Крафтим красивый стрим!', description: 'Готовый стиль — хорошее начало. Остальное подстрой под себя.' },
  { title: 'Чат тоже любит наряжаться!', description: 'Шрифт, интервалы и цвета меняются прямо в редакторе.' },
  { title: 'Без верстака и команд!', description: 'Выбери канал, настрой вид и скопируй ссылку для OBS.' },
  { title: 'Сохраняется само!', description: 'Оформление обновляется в OBS без замены ссылки профиля.' }
];

/** Pick once per page load; the selected splash stays until the next reload. */
export function startSplashes(title: HTMLElement, description: HTMLElement): void {
  const splash = splashes[Math.floor(Math.random() * splashes.length)];
  title.textContent = splash.title;
  description.textContent = splash.description;
}
