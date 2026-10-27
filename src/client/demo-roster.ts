/** Parody display names based on https://mineshield.gg/members (2026-10-27). */
export const demoRoster = [
  ['Alcest_M', 'Alcec_m'], ['Alfedov', 'Alfedof'], ['Arlabus', 'ArloBus'],
  ['Bez_LS', 'Bez_Less'], ['CapXenomorph', 'CapXenomorf'], ['Diamkey', 'Diomkey'],
  ['Dushenka', 'Dushinka'], ['Deb_Off', 'DebOf'], ['Jay Pokerman', 'JoyPokerman'],
  ['Just_S', 'Jost_S'], ['KetrinCyst', 'KetrinMist'], ['KlashRaick', 'KleshRaik'],
  ['Lord_Santos', 'Lord_Sandros'], ['MoDDyChat', 'ModyChot'], ['Molvine', 'Molvain'],
  ['NikiWright', 'NikiWrite'], ['ObsidianTime', 'ObsidianTim'], ['PWGood', 'PWGod'],
  ['SecB', 'SekBee'], ['SirPiligrim', 'SirPiligram'], ['SnrGiraffe', 'JunGiraf'],
  ['TheKlyde', 'TheKlayd'], ['Venazar', 'Venazavr'], ['Zakviel', 'Zokviel'],
  ['Nerkin', 'Nerkeen'], ['BarsiGold', 'BarsiCold'], ['Gelmo', 'Helm0'],
  ['Sanhez', 'Sonhez'], ['PyHeK', 'PyHok'], ['Леоша', 'Leoshka']
] as const;
export type DemoNickname = typeof demoRoster[number][1];
