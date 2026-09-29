import { api } from "../api.js";
import { saveSession } from "../storage.js";
import { navigate } from "../router.js";
import { createAvatarPicker } from "../avatarPicker.js";

export function renderHome(container) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `
    <h1 class="logo">✏️ Продолжи предложение</h1>
    <p class="tagline">Придумывайте смешные продолжения фраз и голосуйте за лучшие</p>
  `;

  const homeLink = document.createElement("a");
  homeLink.className = "link-btn";
  homeLink.href = "/";
  homeLink.textContent = "← На главную";
  homeLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/");
  });
  wrap.appendChild(homeLink);

  const formHost = document.createElement("div");
  wrap.appendChild(formHost);
  container.appendChild(wrap);

  function showChoiceScreen() {
    formHost.innerHTML = "";

    const cards = document.createElement("div");
    cards.className = "game-cards";
    cards.innerHTML = `
      <button class="game-card" data-choice="create">
        <span class="game-card-emoji">🆕</span>
        <span class="game-card-title">Создать комнату</span>
        <span class="game-card-desc">Начать новую игру</span>
      </button>
      <button class="game-card" data-choice="join">
        <span class="game-card-emoji">🔑</span>
        <span class="game-card-title">У меня есть код</span>
        <span class="game-card-desc">Присоединиться к уже созданной комнате</span>
      </button>
    `;
    cards.querySelector('[data-choice="create"]').addEventListener("click", showCreateForm);
    cards.querySelector('[data-choice="join"]').addEventListener("click", showJoinForm);
    formHost.appendChild(cards);
  }

  function showCreateForm() {
    formHost.innerHTML = "";

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 30;

    const picker = createAvatarPicker();

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Создать комнату";

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    btn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.textContent = "Введите имя";
        return;
      }
      btn.disabled = true;
      errorEl.textContent = "";
      try {
        const avatar = picker.getValue();
        const res = await api.createRoom({ name, ...avatar });
        saveSession(res.code, { token: res.token, playerId: res.playerId });
        navigate(`/r/${res.code}`);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.textContent = "Назад";
    backBtn.addEventListener("click", showChoiceScreen);

    const row = document.createElement("div");
    row.className = "row-actions";
    row.appendChild(backBtn);
    row.appendChild(btn);

    formHost.appendChild(nameInput);
    formHost.appendChild(picker.element);
    formHost.appendChild(errorEl);
    formHost.appendChild(row);
  }

  function showJoinForm() {
    renderJoinCodeStep("");
  }

  function renderJoinCodeStep(prefillCode) {
    formHost.innerHTML = "";

    const stepLabel = document.createElement("p");
    stepLabel.className = "tagline";
    stepLabel.textContent = "Шаг 1 из 2";
    formHost.appendChild(stepLabel);

    const h = document.createElement("h2");
    h.textContent = "Код комнаты";
    formHost.appendChild(h);
    const desc = document.createElement("p");
    desc.className = "tagline";
    desc.textContent = "Введите код, который вам прислал организатор.";
    formHost.appendChild(desc);

    const codeInput = document.createElement("input");
    codeInput.className = "text-input code-input";
    codeInput.placeholder = "КОД КОМНАТЫ";
    codeInput.maxLength = 5;
    codeInput.style.textTransform = "uppercase";
    codeInput.value = prefillCode;

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    const row = document.createElement("div");
    row.className = "row-actions";
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.textContent = "Назад";
    backBtn.addEventListener("click", showChoiceScreen);
    const nextBtn = document.createElement("button");
    nextBtn.className = "btn btn-primary";
    nextBtn.textContent = "Далее";
    row.appendChild(backBtn);
    row.appendChild(nextBtn);

    nextBtn.addEventListener("click", async () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length !== 5) {
        errorEl.textContent = "Введите код комнаты";
        return;
      }
      nextBtn.disabled = true;
      errorEl.textContent = "";
      try {
        const res = await api.getTakenEmojis(code);
        if (res.gameType !== "sentence") {
          throw new Error("Этот код от другой игры");
        }
        if (res.status !== "lobby") {
          throw new Error("Игра уже началась, подключиться нельзя");
        }
        if (res.deviceMode === "local") {
          throw new Error("Эта комната только для локальных игроков — попросите организатора добавить вас");
        }
        renderJoinDetailsStep(code, res);
      } catch (e) {
        errorEl.textContent = e.message;
        nextBtn.disabled = false;
      }
    });

    formHost.appendChild(codeInput);
    formHost.appendChild(errorEl);
    formHost.appendChild(row);
  }

  function renderJoinDetailsStep(code, info) {
    formHost.innerHTML = "";

    const stepLabel = document.createElement("p");
    stepLabel.className = "tagline";
    stepLabel.textContent = "Шаг 2 из 2";
    formHost.appendChild(stepLabel);

    const h = document.createElement("h2");
    h.textContent = `Комната ${code}`;
    formHost.appendChild(h);
    const desc = document.createElement("p");
    desc.className = "tagline";
    desc.textContent = "Представьтесь остальным игрокам.";
    formHost.appendChild(desc);

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 30;

    const picker = createAvatarPicker(null, info.taken || []);

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Присоединиться";

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    btn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.textContent = "Введите имя";
        return;
      }
      btn.disabled = true;
      errorEl.textContent = "";
      try {
        const avatar = picker.getValue();
        const res = await api.joinRoom(code, { name, ...avatar });
        saveSession(res.code, { token: res.token, playerId: res.playerId });
        navigate(`/r/${res.code}`);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.textContent = "Назад";
    backBtn.addEventListener("click", () => renderJoinCodeStep(code));

    const row = document.createElement("div");
    row.className = "row-actions";
    row.appendChild(backBtn);
    row.appendChild(btn);

    formHost.appendChild(nameInput);
    formHost.appendChild(picker.element);
    formHost.appendChild(errorEl);
    formHost.appendChild(row);
  }

  showChoiceScreen();
}
