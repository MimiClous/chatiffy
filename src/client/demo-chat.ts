import { demoIdentities } from './demo-identities.js';
import type { DemoNickname } from './demo-roster.js';
import type { ChatMessage } from '../shared/contracts.js';

export const demoEmotes = new Map([
  // Verified against PWGood's public 7TV set 61c802080bf6300371940381.
  ['kekBomb', '/assets/emotes/kekBomb.webp'],
  ['Aware', '/assets/emotes/Aware.webp'],
  ['sus', '/assets/emotes/sus.webp'],
  ['monka', '/assets/emotes/monka.webp'],
  ['Panic', '/assets/emotes/Panic.webp'],
  ['PagMan', '/assets/emotes/PagMan.webp'],
  ['Lovegers', '/assets/emotes/Lovegers.webp'],
  ['BASED', '/assets/emotes/BASED.webp'],
  ['Sadge', '/assets/emotes/Sadge.webp'],
  ['monkaSTEER', '/assets/emotes/monkaSTEER.webp'],
  ['happie', '/assets/emotes/happie.webp']
]);

// Standalone quotes supplied by the user and fictional parody jokes.
const conversation: readonly [DemoNickname, string, string][] = [
  ['Alfedof', '#89e87d', 'Ладно.'],
  ['PWGod', '#fff700', 'kekBomb kekBomb'],
  ['JunGiraf', '#5294d7', 'Я актёр.. который притворяется пьяным (я не выпил)'],
  ['KetrinMist', '#00e66b', '@PWGod я зашла на пять минут, а теперь у меня три шалкера камня, недостроенный дом и ощущение, что завтра опять скажу «один блок поправлю и спать». Lovegers'],
  ['Helm0', '#ffac63', 'Это Гельмо!'],
  ['Zokviel', '#ff8c57', 'Разьебный февраль'],
  ['Zokviel', '#ff8c57', 'Я не террори...'],
  ['Alcec_m', '#ff5555', 'План был хороший. До первого блока. BASED'],
  ['PWGod', '#fff700', 'kekBomb'],
  ['Alfedof', '#89e87d', 'Ладно.'],
  ['Alfedof', '#89e87d', 'Я не потерялся. Проверяю генерацию мира.'],
  ['ArloBus', '#99b8ff', '@ModyChot это архитектурное решение. sus'],
  ['Bez_Less', '#1553d7', 'Один блок поправлю и спать. Последние слова перед шестичасовой стройкой. happie'],
  ['PWGod', '#fff700', 'Aware'],
  ['CapXenomorf', '#86d8bd', 'Алмазы есть. Кирки нет.'],
  ['Diomkey', '#ef91ff', 'Я всё рассчитал. Кроме высоты.'],
  ['Dushinka', '#ffc1df', 'Кровать была здесь. Кажется.'],
  ['PWGod', '#fff700', 'sus'],
  ['DebOf', '#64d8cb', 'Это временно. Уже третий сезон.'],
  ['JoyPokerman', '#e8b669', 'В инвентаре порядок. Вы просто не понимаете.'],
  ['Alfedof', '#89e87d', 'Ладно.'],
  ['Jost_S', '#f6a4c5', 'Дом почти готов. Нужен только дом.'],
  ['PWGod', '#fff700', 'PagMan'],
  ['KetrinMist', '#00e66b', 'Я пришёл за деревом. Почему у меня лодка?'],
  ['KleshRaik', '#f07c7c', 'Не трогайте рычаг. Особенно этот.'],
  ['Lord_Sandros', '#ded08e', 'Красиво? Да. Работает? Следующий вопрос.'],
  ['PWGod', '#fff700', 'kekBomb'],
  ['ModyChot', '#c5b2ff', 'Я не упал. Проверил гравитацию.'],
  ['Molvain', '#e6c9ff', 'Сундук подписан. Внутри всё наоборот.\nЗемля — в «ценностях». Алмазы — где-то.'],
  ['NikiWrite', '#b6abff', 'ААААААААААААААААААААААААААААААААААААААААААААААААААААААААА Panic'],
  ['PWGod', '#fff700', 'Aware'],
  ['ObsidianTim', '#b4a1d9', 'Координаты: −1200 / 64 / 850. Принести: 64 факела, 2 кирки и уверенность в завтрашнем дне.'],
  ['Alfedof', '#89e87d', 'Ладно.'],
  ['PWGod', '#fff700', 'monkaSTEER monka Panic'],
  ['SekBee', '#ff739f', 'Один блок поправлю и спать.'],
  ['PWGod', '#fff700', 'sus'],
  ['SirPiligram', '#b5c993', 'Маршрут простой: прямо, налево, через портал, обратно через другой портал. Если оказались дома — поздравляю, экскурсия окончена. Aware'],
  ['JunGiraf', '#5294d7', 'Я всё рассчитал. Кроме высоты.'],
  ['TheKlayd', '#f098bd', 'Кровать была здесь. Кажется.'],
  ['PWGod', '#fff700', 'PagMan'],
  ['Venazavr', '#d3ab76', 'Это временно. Уже третий сезон.'],
  ['Zokviel', '#ff8c57', 'В инвентаре порядок. Вы просто не понимаете.'],
  ['Nerkeen', '#79dcff', 'Дом почти готов. Нужен только дом. Sadge'],
  ['PWGod', '#fff700', 'kekBomb'],
  ['Alfedof', '#89e87d', 'Ладно.'],
  ['BarsiCold', '#ffcc70', 'Урааа! PagMan Lovegers happie'],
  ['Helm0', '#ffac63', 'Не трогайте рычаг. Особенно этот.'],
  ['Sonhez', '#e9b57a', 'Красиво? Да. Работает? Следующий вопрос.'],
  ['PWGod', '#fff700', 'Aware'],
  ['PyHok', '#9cd877', 'Я не упал. Проверил гравитацию.'],
  ['Leoshka', '#86b8ff', 'Чат, оценка стройке от 1 до 10? Только без дробей, отрицательных чисел и предложения снести всё целиком.'],
];

export function startDemoChat(emit: (message: ChatMessage, time: number) => void, advance: (time: number) => void) {
  let index = 0; let serial = 0; let clock = 0; let last = Date.now(); let nextAt = 0; let paused = false;
  function next() {
    const [user, color, text] = conversation[index++ % conversation.length];
    const identity = demoIdentities[user];
    emit({ user: identity.login, text, tags: { id: `preview-${++serial}`, color,
      'display-name': user, 'user-id': identity.userId } }, clock);
    nextAt = clock + 1400 + Math.random() * 1700;
  }
  // A few messages make the initial preview useful, then new lines arrive naturally.
  for (let i = 0; i < 5; i++) next();
  const timer = setInterval(() => {
    const now = Date.now(); const elapsed = Math.min(now - last, 1000); last = now;
    if (paused || document.hidden) return;
    clock += elapsed; advance(clock);
    if (clock >= nextAt) next();
  }, 250);
  addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return {
    togglePause() { paused = !paused; last = Date.now(); return paused; },
    restart() { index = 0; clock = 0; last = Date.now(); for (let i = 0; i < 5; i++) next(); }
  };
}
