import { api } from "../api.js";
import { saveSession } from "../storage.js";
import { navigate } from "../router.js";
import { createAvatarPicker } from "../avatarPicker.js";

export function renderHome(container) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `
    <h1 class="logo">🎉 Вечеринка</h1>
    <p class="tagline">Простые игры для весёлой компании</p>
  `;

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  const createTab = document.createElement("button");
  createTab.className = "tab active";
  createTab.textContent = "Создать комнату";
  const joinTab = document.createElement("button");
  joinTab.className = "tab";
  joinTab.textContent = "У меня есть код";
  tabs.appendChild(createTab);
  tabs.appendChild(joinTab);
  wrap.appendChild(tabs);

  const formHost = document.createElement("div");
  wrap.appendChild(formHost);
  container.appendChild(wrap);

  function showCreateForm() {
    createTab.classList.add("active");
    joinTab.classList.remove("active");
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

    formHost.appendChild(nameInput);
    formHost.appendChild(picker.element);
    formHost.appendChild(errorEl);
    formHost.appendChild(btn);
  }

  function showJoinForm() {
    joinTab.classList.add("active");
    createTab.classList.remove("active");
    formHost.innerHTML = "";

    const codeInput = document.createElement("input");
    codeInput.className = "text-input code-input";
    codeInput.placeholder = "КОД КОМНАТЫ";
    codeInput.maxLength = 5;
    codeInput.style.textTransform = "uppercase";

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 30;

    const picker = createAvatarPicker();

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Присоединиться";

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    btn.addEventListener("click", async () => {
      const code = codeInput.value.trim().toUpperCase();
      const name = nameInput.value.trim();
      if (!code || !name) {
        errorEl.textContent = "Заполните код и имя";
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

    formHost.appendChild(codeInput);
    formHost.appendChild(nameInput);
    formHost.appendChild(picker.element);
    formHost.appendChild(errorEl);
    formHost.appendChild(btn);
  }

  createTab.addEventListener("click", showCreateForm);
  joinTab.addEventListener("click", showJoinForm);
  showCreateForm();
}
