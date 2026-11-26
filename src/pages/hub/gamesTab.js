import { navigate } from "../../router.js";
import { GAMES } from "../../games.js";
import { deviceLabel, phonesIconHtml } from "./devices.js";
import { renderInstallBanner } from "./install.js";
import { escapeHtml } from "../../utils.js";

function heading(text, description) {
  const wrap = document.createElement("div");
  wrap.className = "hub-title";
  const h = document.createElement("h2");
  h.className = "hub-h";
  h.textContent = text;
  wrap.appendChild(h);
  if (description) {
    const p = document.createElement("p");
    p.className = "hub-desc";
    p.textContent = description;
    wrap.appendChild(p);
  }
  return wrap;
}

export function renderGamesTab(shell) {
  const { body } = shell;

  renderInstallBanner(body);

  const section = document.createElement("div");
  section.className = "hub-section";
  section.appendChild(
    heading("Игры", "Выберите игру для компании. Значок на карточке показывает, играют с одного телефона или у каждого свой.")
  );

  // Filter by how the game is played: one phone for everyone, or each on their own.
  const FILTERS = [
    { id: "all", label: "Все игры" },
    { id: "shared", label: "Один телефон", icon: phonesIconHtml("shared") },
    { id: "own", label: "Свои телефоны", icon: phonesIconHtml("own") },
  ];
  let activeFilter = "all";
  const filterRow = document.createElement("div");
  filterRow.className = "hub-filters";
  filterRow.setAttribute("role", "group");
  filterRow.setAttribute("aria-label", "Как играть");
  const list = document.createElement("div");
  list.className = "hub-games";

  function drawGames() {
    list.innerHTML = "";
    GAMES.filter((g) => activeFilter === "all" || g.devices === activeFilter).forEach((game) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `hub-tile t${((game.tone - 1) % 3) + 1}`;
      tile.innerHTML = `
        <span class="hub-tile-art" aria-hidden="true">${game.emoji}</span>
        <span class="hub-tile-title">${escapeHtml(game.title)}</span>
        <span class="hub-tile-desc">${escapeHtml(game.desc)}</span>
        <span class="hub-tile-meta">от ${game.min} игроков</span>
        <span class="hub-ribbon">${phonesIconHtml(game.devices)}${escapeHtml(deviceLabel(game.devices))}</span>
      `;
      tile.addEventListener("click", () => navigate(game.path));
      list.appendChild(tile);
    });
  }

  FILTERS.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hub-filter";
    btn.setAttribute("aria-pressed", String(f.id === activeFilter));
    btn.innerHTML = `${f.icon || ""}${escapeHtml(f.label)}`;
    btn.addEventListener("click", () => {
      activeFilter = f.id;
      filterRow.querySelectorAll(".hub-filter").forEach((el, i) => el.setAttribute("aria-pressed", String(FILTERS[i].id === activeFilter)));
      drawGames();
    });
    filterRow.appendChild(btn);
  });
  section.appendChild(filterRow);
  drawGames();
  section.appendChild(list);
  const soon = document.createElement("div");
  soon.className = "hub-soon";
  soon.innerHTML = `<span aria-hidden="true">🎲</span><span>Новые игры скоро появятся здесь</span>`;
  section.appendChild(soon);
  body.appendChild(section);
}
