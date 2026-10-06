import { navigate } from "../router.js";
import { authApi } from "../api.js";
import { pwaInstallSectionHtml, wirePwaInstallButton } from "../pwaInstall.js";

function renderAccountCorner() {
  const corner = document.createElement("div");
  corner.className = "account-corner";
  corner.innerHTML = `<button class="account-btn" disabled>...</button>`;

  authApi
    .session()
    .then((res) => {
      corner.innerHTML = "";
      if (res.authenticated) {
        const label = document.createElement("span");
        label.className = "account-email";
        label.textContent = res.email;
        const logoutBtn = document.createElement("button");
        logoutBtn.className = "account-btn";
        logoutBtn.textContent = "Выйти";
        logoutBtn.addEventListener("click", async () => {
          logoutBtn.disabled = true;
          try {
            await authApi.logout();
            navigate("/");
          } catch (e) {
            logoutBtn.disabled = false;
          }
        });
        corner.appendChild(label);
        corner.appendChild(logoutBtn);
      } else {
        const loginBtn = document.createElement("button");
        loginBtn.className = "account-btn";
        loginBtn.textContent = "Войти";
        loginBtn.addEventListener("click", () => navigate("/account"));
        corner.appendChild(loginBtn);
      }
    })
    .catch(() => {
      corner.innerHTML = "";
    });

  return corner;
}

export function renderGamePicker(container) {
  container.innerHTML = "";
  container.appendChild(renderAccountCorner());

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
      <span class="game-card-players">От 4 игроков</span>
    </button>
    <button class="game-card" data-path="/fanty">
      <span class="game-card-emoji">🍾</span>
      <span class="game-card-title">Фанты</span>
      <span class="game-card-desc">Крутите бутылочку — правда, действие или командные фанты</span>
      <span class="game-card-players">От 2 игроков</span>
    </button>
  `;
  cards.querySelectorAll(".game-card").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.path));
  });
  wrap.appendChild(cards);

  const pwaSection = document.createElement("div");
  pwaSection.className = "pwa-section";
  pwaSection.innerHTML = `
    <div class="hint" style="margin-top:14px;margin-bottom:6px">📲 Установить на телефон</div>
    <div id="pwa-install-section">${pwaInstallSectionHtml()}</div>
  `;
  wrap.appendChild(pwaSection);
  wirePwaInstallButton(pwaSection);

  const contactLink = document.createElement("a");
  contactLink.className = "link-btn";
  contactLink.href = "/contact";
  contactLink.textContent = "✉️ Связаться с разработчиком";
  contactLink.style.marginTop = "14px";
  contactLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/contact");
  });
  wrap.appendChild(contactLink);

  container.appendChild(wrap);
}
