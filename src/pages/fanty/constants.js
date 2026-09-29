export const LOCATIONS = [
  { value: "apartment", label: "Квартира" },
  { value: "bar", label: "Бар" },
  { value: "street", label: "Улица" },
  { value: "country_house", label: "Загородный дом" },
];

export const MOOD_CATEGORIES = [
  { value: "basic", label: "Базовые" },
  { value: "flirt", label: "Флирт" },
  { value: "flirt_plus", label: "Флирт+" },
];

export const ATTRIBUTES = [
  { value: "alcohol", label: "Алкоголь" },
  { value: "food", label: "Еда" },
];

export const CATEGORIES = [...MOOD_CATEGORIES, ...ATTRIBUTES];

export const GAME_MODES = [
  { value: "truth_or_dare", label: "Правда или действие" },
  { value: "solo", label: "Просто фанты (один игрок)" },
  { value: "team", label: "Командные фанты" },
];

export const PICK_MODES = [
  { value: "random", label: "Полный рандом" },
  { value: "fair", label: "Поровну для всех" },
];

export const MIN_PLAYERS_BY_MODE = {
  truth_or_dare: 2,
  solo: 2,
  team: 3,
};

export function locationLabel(value) {
  return LOCATIONS.find((l) => l.value === value)?.label || value;
}

export function categoryLabel(value) {
  return CATEGORIES.find((c) => c.value === value)?.label || value;
}

export function pickModeLabel(value) {
  return PICK_MODES.find((p) => p.value === value)?.label || value;
}
