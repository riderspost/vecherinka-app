import { navigate } from "../router.js";
import { api, authApi } from "../api.js";
import { pwaInstallSectionHtml, wirePwaInstallButton } from "../pwaInstall.js";
import { listSessionCodes, clearSession } from "../storage.js";
import { escapeHtml } from "../utils.js";

// Covers both games' status vocabularies — fanty's is just
// lobby/playing/finished, the sentence game's tracks every round phase
// directly in room.status instead of a separate sub-phase field.
const ROOM_STATUS_LABEL = {
  lobby: "в лобби, ждём игроков",
  playing: "игра идёт",
  finished: "игра завершена",
  answering: "игра идёт",
  voting: "игра идёт",
  voting_results: "игра идёт",
  round_results: "игра идёт",
  overall_results: "игра идёт",
  final_results: "игра завершена",
};

function renderReturnSection(section) {
  const codes = listSessionCodes();
  codes.forEach(async (code) => {
    let res;
    try {
      res = await api.getTakenEmojis(code);
    } catch (e) {
      clearSession(code);
      return;
    }
    const path = res.gameType === "fanty" ? `/fanty/r/${code}` : `/r/${code}`;
    const card = document.createElement("button");
    card.className = "return-session-card";
    card.innerHTML = `
      <span class="return-session-emoji">${res.gameType === "fanty" ? "🍾" : "✏️"}</span>
      <span>
        <span class="return-session-title">Вернуться в комнату ${escapeHtml(code)}</span><br/>
        <span class="return-session-sub">${escapeHtml(ROOM_STATUS_LABEL[res.status] || res.status)}</span>
      </span>
    `;
    card.addEventListener("click", () => navigate(path));
    section.appendChild(card);
  });
}

function renderAccountCorner(sessionPromise) {
  const corner = document.createElement("div");
  corner.className = "account-corner";
  corner.innerHTML = `<button class="account-btn" disabled>...</button>`;

  sessionPromise
    .then((res) => {
      if (res.authenticated && !res.profileComplete) {
        navigate("/profile");
        return;
      }
      corner.innerHTML = "";
      if (res.authenticated) {
        const label = document.createElement("span");
        label.className = "account-email";
        label.textContent = res.email;
        const profileBtn = document.createElement("button");
        profileBtn.className = "account-btn";
        profileBtn.textContent = "Профиль";
        profileBtn.addEventListener("click", () => navigate("/profile"));
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
        corner.appendChild(profileBtn);
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
  container.appendChild(renderAccountCorner(authApi.session()));

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `
    <h1 class="logo">🎉 Вечеринка</h1>
    <p class="tagline">Выберите игру для компании</p>
  `;

  const returnSection = document.createElement("div");
  returnSection.className = "return-sessions";
  wrap.appendChild(returnSection);
  renderReturnSection(returnSection);

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
