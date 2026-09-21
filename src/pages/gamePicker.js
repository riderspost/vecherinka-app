import { navigate } from "../router.js";

export function renderGamePicker(container) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `
    <h1 class="logo">🎉 Вечеринка</h1>
    <p class="tagline">Выберите игру для компании</p>
  `;

  const cards = document.createElement("div");
  cards.className = "game-cards";
  cards.innerHTML = `
    <button class="game-card" data-path="/sentence">
      <span class="game-card-emoji">✏️</span>
      <span class="game-card-title">Продолжи предложение</span>
      <span class="game-card-desc">Придумывайте смешные продолжения фраз и голосуйте за лучшие</span>
    </button>
    <button class="game-card" data-path="/fanty">
      <span class="game-card-emoji">🍾</span>
      <span class="game-card-title">Фанты</span>
      <span class="game-card-desc">Крутите бутылочку — правда, действие или командные фанты</span>
    </button>
  `;
  cards.querySelectorAll(".game-card").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.path));
  });
  wrap.appendChild(cards);

  const submitLink = document.createElement("a");
  submitLink.className = "link-btn";
  submitLink.href = "/fanty/submit";
  submitLink.textContent = "Предложить свой фант или вопрос";
  submitLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/fanty/submit");
  });
  wrap.appendChild(submitLink);

  container.appendChild(wrap);
}
