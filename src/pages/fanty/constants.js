export const LOCATIONS = [
  {
    value: "apartment",
    label: "Квартира",
    hint: "Фанты, которые легко выполнить в обычной квартирной обстановке.",
  },
  {
    value: "bar",
    label: "Бар",
    hint: "Фанты, уместные в баре или на шумной вечеринке вне дома.",
  },
  {
    value: "street",
    label: "Улица",
    hint: "Фанты, которые можно выполнить на улице или в другом общественном месте.",
  },
  {
    value: "country_house",
    label: "Загородный дом",
    hint: "Фанты для загородного дома — с простором и возможностью пошуметь.",
  },
];

export const MOOD_CATEGORIES = [
  {
    value: "basic",
    label: "Базовые",
    hint: "Простые и безобидные задания и вопросы — подходят любой компании.",
  },
  {
    value: "flirt",
    label: "Флирт",
    hint: "Задания и вопросы с лёгким флиртом и намёками.",
  },
  {
    value: "flirt_plus",
    label: "Флирт+",
    hint: "Более смелые и откровенные задания и вопросы — для раскрепощённой компании.",
  },
];

export const ATTRIBUTES = [
  {
    value: "alcohol",
    label: "Алкоголь",
    hint: "Включит фанты, где нужно выпить или упомянуть алкоголь. Отмечайте, только если он реально есть на вечеринке.",
  },
  {
    value: "food",
    label: "Еда",
    hint: "Включит фанты, связанные с едой. Отмечайте, только если еда есть под рукой.",
  },
];

export const CATEGORIES = [...MOOD_CATEGORIES, ...ATTRIBUTES];

export const GAME_MODES = [
  {
    value: "truth_or_dare",
    label: "Правда или действие",
    hint: "Игроки крутят бутылку, и тот, на кого она покажет, выбирает — выполнить действие или ответить на каверзный вопрос о себе. Минимум 2 игрока.",
  },
  {
    value: "solo",
    label: "Просто фанты (один игрок)",
    hint: "Бутылка сразу даёт выпавшему игроку задание — без выбора между правдой и действием. Минимум 2 игрока.",
  },
  {
    value: "team",
    label: "Командные фанты",
    hint: "Бутылка крутится дважды: сначала выбирает первого игрока, затем — его напарника. Задание они выполняют вместе. Минимум 3 игрока.",
  },
];

export const PICK_MODES = [
  {
    value: "random",
    label: "Полный рандом",
    hint: "Каждый раз бутылка выбирает полностью случайного игрока — кто-то может выпадать чаще других.",
  },
  {
    value: "fair",
    label: "Поровну для всех",
    hint: "Бутылка выбирает из тех, кто ещё не выпадал в этом круге. Когда все получат по разу, круг начинается заново.",
  },
];

export const MIN_PLAYERS_BY_MODE = {
  truth_or_dare: 2,
  solo: 2,
  team: 3,
};

export const PAIR_MODES = [
  {
    value: "any",
    label: "Любые",
    hint: "Бутылка выбирает пару полностью случайно, без учёта пола.",
  },
  {
    value: "mixed",
    label: "Мужчина + женщина",
    hint: "Бутылка составит пару только из мужчины и женщины — второй спин ограничен по полу партнёра.",
  },
];

export const GENDERS = [
  { value: "m", label: "Мужской" },
  { value: "f", label: "Женский" },
];

export function locationLabel(value) {
  return LOCATIONS.find((l) => l.value === value)?.label || value;
}

export function categoryLabel(value) {
  return CATEGORIES.find((c) => c.value === value)?.label || value;
}

export function pickModeLabel(value) {
  return PICK_MODES.find((p) => p.value === value)?.label || value;
}
