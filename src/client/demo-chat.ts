import type { ChatMessage } from '../shared/contracts.js';

export const demoEmotes = new Map([
  // Verified against PWGood's public 7TV set 61c802080bf6300371940381.
  ['kekBomb', 'https://cdn.7tv.app/emote/01FAKB7TWR0002EV4FV333ASYK/2x.webp']
]);

// Fictional conversation with parody nicknames, mixed with short sourced community memes.
// Sources for the quoted fragments are listed in docs/PREVIEW-CONTENT.md.
const conversation: readonly [string, string, string][] = [
  ['MLIT_M', '#1553d7', 'Ку, чат! Кто уже на сервере?'],
  ['Mimiclous', '#00e66b', '@MLIT_M я тут, жду у спавна 👋'],
  ['ModyChot', '#c5b2ff', 'А чего пещеры такие душные?'],
  ['JunGiraf', '#5294d7', 'Какой сервер, такие и пещеры.'],
  ['PWGod', '#fff700', 'kekBomb'],
  ['Zokviel', '#ff8c57', 'Февраль — месяц контента'],
  ['SekBee', '#ff739f', '@Zokviel Стримишь?'],
  ['Nerkeen', '#79dcff', 'И это — всё?'],
  ['Helm0', '#ffac63', 'Это Гельмо!'],
  ['Alcec_m', '#ff5555', 'Кринжуют омежки. Будьте альфами.'],
  ['JunGiraf', '#5294d7', 'Я актёр.. который притворяется пьяным (я не выпил)'],
  ['PWGod', '#fff700', '@JunGiraf kekBomb kekBomb'],
  ['ModyChot', '#c5b2ff', '@Mimiclous подожди меня, я опять забыл еду'],
  ['Mimiclous', '#00e66b', '@ModyChot взял хлеб, только не приводи крипера'],
  ['Alfedof', '#89e87d', 'Чат, кто-нибудь помнит, где я оставил шалкер?'],
  ['Diomkey', '#ef91ff', '@Alfedof тот, который у тебя в руке?'],
  ['PWGod', '#fff700', 'kekBomb'],
  ['KrolikSun', '#e6c9ff', 'Выжженная пустошь'],
  ['Neo_km', '#64d8cb', '@KrolikSun а я только ферму достроил…'],
  ['Jost_S', '#f6a4c5', 'Поплачь!'],
  ['ModyChot', '#c5b2ff', '@Jost_S лучше принеси факелы, тут темно'],
  ['ArloBus', '#99b8ff', 'Чат, этот блок оставить или на один левее?'],
  ['MLIT_M', '#1553d7', '@ArloBus левее. Нет, теперь обратно 😭'],
  ['Mimiclous', '#00e66b', 'Идеально, больше ничего не трогай'],
  ['SekBee', '#ff739f', 'Покупайте мерч'],
  ['Zokviel', '#ff8c57', '@SekBee у нас тут стройка вообще-то'],
  ['Helm0', '#ffac63', 'Я принёс материалы, куда складывать?'],
  ['Diomkey', '#ef91ff', '@Helm0 в левый сундук. Другой левый!'],
  ['PWGod', '#fff700', '@Diomkey kekBomb'],
  ['Alfedof', '#89e87d', 'Спасибо, чат, шалкер найден. Никто ничего не видел'],
  ['Mimiclous', '#00e66b', 'Кто только зашёл — ку! Мы ещё строим ✨'],
  ['JunGiraf', '#5294d7', '@ModyChot я у спавна, ты где потерялся?'],
  ['ModyChot', '#c5b2ff', '@JunGiraf сейчас, ещё один блок и иду'],
  ['MLIT_M', '#1553d7', '«Ещё один блок» — это уже минут десять 😂'],
  ['PWGod', '#fff700', 'kekBomb kekBomb kekBomb']
];

export function startDemoChat(emit: (message: ChatMessage, time: number) => void, advance: (time: number) => void) {
  let index = 0; let serial = 0; let clock = 0; let last = Date.now(); let nextAt = 0; let paused = false;
  function next() {
    const [user, color, text] = conversation[index++ % conversation.length];
    emit({ user, text, tags: { id: `preview-${++serial}`, color } }, clock);
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
  return { togglePause() { paused = !paused; last = Date.now(); return paused; } };
}
