// Helpers for trying a game alone: extra players on the same device.
//
// Normally one browser holds one seat per room: the room's session sits in
// localStorage and the server refuses a second join from the same device id.
// A "test tab" gets its own session and device id kept in sessionStorage
// (which is per tab), so each test tab is a separate player. A tab becomes a
// test tab by opening a room link with ?test=form (the usual join form) or
// ?test=auto (joins at once under a made-up name).
//
// The links are offered in the lobby only to the testing account (see
// isTester in api.js), and the server only lets such tabs into its rooms.

import { isTester } from "./api.js";

const TAB_KEY = "plynger-test-tab";
const TAB_DEVICE_KEY = "plynger-test-device";

function safe(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    return fallback;
  }
}

const params = new URLSearchParams(window.location.search);

const testParam = params.get("test");
if (testParam === "form" || testParam === "auto") safe(() => sessionStorage.setItem(TAB_KEY, "1"));

// How this page load asked to join: "form", "auto" or null.
export function testJoinMode() {
  return testParam === "form" || testParam === "auto" ? testParam : null;
}

export function isTestTab() {
  return safe(() => sessionStorage.getItem(TAB_KEY) === "1", false);
}

// The storage that holds this tab's room sessions and device id.
export function sessionStore() {
  return isTestTab() ? sessionStorage : localStorage;
}

export function testDeviceId() {
  let id = safe(() => sessionStorage.getItem(TAB_DEVICE_KEY));
  if (!id) {
    id = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    safe(() => sessionStorage.setItem(TAB_DEVICE_KEY, id));
  }
  return id;
}

const TEST_EMOJIS = ["🦊", "🐸", "🐼", "🐵", "🐶", "🦁", "🐱", "🤖", "👻", "🦄", "🐻", "🐯"];

// A made-up name and the first free emoji, for ?test=auto.
export function pickTestPlayer(takenEmojis) {
  const taken = new Set(takenEmojis || []);
  const emoji = TEST_EMOJIS.find((e) => !taken.has(e)) || TEST_EMOJIS[0];
  const n = (takenEmojis || []).length + 1;
  return { name: `Тест ${n}`, avatarType: "emoji", avatarValue: emoji };
}

let devOpen = false; // survives the lobby redrawing every poll

// A collapsible block with the two kinds of test links for a room, or null
// when dev tools are off. `roomPath` is the room's own path, e.g. /r/ABCDE.
export function renderTestLinks(roomPath) {
  if (!isTester()) return null;
  const base = `${window.location.origin}${roomPath}`;
  const kinds = [
    {
      key: "form",
      title: "Новый игрок с формой",
      hint: "Откроется обычная форма: имя и аватар вводите сами.",
      url: `${base}?test=form`,
    },
    {
      key: "auto",
      title: "Мгновенный тестовый игрок",
      hint: "Сразу зайдёт в комнату с именем «Тест N». Одно нажатие.",
      url: `${base}?test=auto`,
    },
  ];

  const details = document.createElement("details");
  details.className = "pl-dev";
  details.open = devOpen;
  details.addEventListener("toggle", () => {
    devOpen = details.open;
  });
  details.innerHTML = `<summary>🧪 Для тестирования</summary><p class="pl-dev-note">Игроки с этого же устройства. Каждая вкладка, открытая по такой ссылке, это отдельный игрок.</p>`;
  kinds.forEach((k) => {
    const row = document.createElement("div");
    row.className = "pl-dev-row";
    row.innerHTML = `
      <div class="pl-dev-text"><b>${k.title}</b><small>${k.hint}</small></div>
      <div class="pl-dev-actions">
        <a class="pl-dev-open" href="${k.url}" target="_blank" rel="noopener">Открыть</a>
        <button type="button" class="pl-dev-copy">Копировать</button>
      </div>
    `;
    const copy = row.querySelector(".pl-dev-copy");
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(k.url).catch(() => {});
      copy.textContent = "Скопировано";
      setTimeout(() => (copy.textContent = "Копировать"), 1500);
    });
    details.appendChild(row);
  });
  return details;
}
