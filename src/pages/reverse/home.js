import { api, authApi, reverseApi } from "../../api.js";
import { saveSession, getDeviceId } from "../../storage.js";
import { navigate } from "../../router.js";
import { createAvatarPicker } from "../../avatarPicker.js";

export function renderReverseHome(container) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `
    <h1 class="logo">⏪ Наоборот</h1>
    <p class="tagline">Записывайте фразы, слушайте их задом наперёд и угадывайте, что было загадано</p>
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

  async function showCreateForm() {
    formHost.innerHTML = "";

    let profile = null;
    let authenticated = false;
    try {
      const session = await authApi.session();
      authenticated = Boolean(session.authenticated);
      if (session.authenticated && session.profileComplete) profile = session;
    } catch (e) {
      // not logged in or session check failed — fall back to a blank form
    }

    if (!authenticated) {
      const warning = document.createElement("div");
      warning.className = "guest-warning";
      warning.innerHTML = `⚠️ Вы не вошли в аккаунт — если случайно закроете игру, вернуться в эту комнату будет нельзя. <a href="/account">Войти</a>`;
      warning.querySelector("a").addEventListener("click", (e) => {
        e.preventDefault();
        navigate("/account");
      });
      formHost.appendChild(warning);
    }

    const mic = document.createElement("p");
    mic.className = "tagline";
    mic.textContent = "🎙 Для игры понадобится микрофон на каждом телефоне.";
    formHost.appendChild(mic);

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 20;
    if (profile) nameInput.value = profile.name;

    const picker = createAvatarPicker(
      profile ? { avatarType: profile.avatarType, avatarValue: profile.avatarValue } : undefined
    );

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
      if (picker.isUploading()) {
        errorEl.textContent = "Дождитесь загрузки фото";
        return;
      }
      btn.disabled = true;
      errorEl.textContent = "";
      try {
        const avatar = picker.getValue();
        const res = await reverseApi.createRoom({ name, ...avatar, deviceId: getDeviceId() });
        saveSession(res.code, { token: res.token, playerId: res.playerId });
        navigate(`/reverse/r/${res.code}`);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    const row = document.createElement("div");
    row.className = "row-actions";
    row.appendChild(btn);

    formHost.appendChild(nameInput);
    formHost.appendChild(picker.element);
    formHost.appendChild(errorEl);
    formHost.appendChild(row);
  }

  showCreateForm();
}
