// Every game the home screen offers. Adding a game means adding one entry
// here (plus its own pages and routes): the games list, the "my rooms" tab
// and the status labels all read from this table.
//   id        value of rooms.game_type on the server
//   path      the game's own start page
//   roomPath  where an existing room of this game lives
//   devices   "own": everyone plays on their own phone; "shared": one phone for all
//   min       the fewest players the game needs
//   tone      which gradient the tile wears (t1..t3 in styles.css); tones
//             repeat when there are more games than gradients
export const GAMES = [
  {
    id: "sentence",
    path: "/sentence",
    roomPath: (code) => `/r/${code}`,
    emoji: "✏️",
    title: "Продолжи предложение",
    desc: "Придумывайте смешные продолжения фраз и голосуйте за лучшие",
    devices: "own",
    min: 4,
    tone: 1,
  },
  {
    id: "fanty",
    path: "/fanty",
    roomPath: (code) => `/fanty/r/${code}`,
    emoji: "🍾",
    title: "Фанты",
    desc: "Крутите бутылочку: правда, действие или командные фанты",
    devices: "shared",
    min: 2,
    tone: 2,
  },
  {
    id: "reverse",
    path: "/reverse",
    roomPath: (code) => `/reverse/r/${code}`,
    emoji: "⏪",
    title: "Наоборот",
    desc: "Фраза звучит задом наперёд. Повторите на слух и узнайте, что загадано",
    devices: "own",
    min: 2,
    tone: 3,
  },
];

export const DEVICE_LABEL = {
  own: "Свои телефоны",
  shared: "Один телефон",
};

export function gameById(id) {
  return GAMES.find((g) => g.id === id) || GAMES[0];
}

export function playersWord(n) {
  const last = n % 10;
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return `${n} игроков`;
  if (last === 1) return `${n} игрок`;
  if (last >= 2 && last <= 4) return `${n} игрока`;
  return `${n} игроков`;
}

// The sentence game keeps every round phase in room.status, the other games
// only use lobby/playing/finished.
const ROOM_STATUS = {
  lobby: { text: "в лобби, ждём игроков", live: false },
  playing: { text: "игра идёт", live: true },
  finished: { text: "игра завершена", live: false },
  answering: { text: "игра идёт", live: true },
  voting: { text: "игра идёт", live: true },
  voting_results: { text: "игра идёт", live: true },
  round_results: { text: "игра идёт", live: true },
  overall_results: { text: "игра идёт", live: true },
  final_results: { text: "игра завершена", live: false },
};

export function roomStatus(status) {
  return ROOM_STATUS[status] || { text: status, live: false };
}
