import { authApi } from "../api.js";
import { navigate } from "../router.js";
import { createAvatarPicker } from "../avatarPicker.js";

export function renderProfilePage(container) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `
    <h1 class="logo">👤 Профиль</h1>
    <p class="tagline">Укажите имя и аватарку — они будут предложены при создании или входе в игру</p>
  `;

  const formHost = document.createElement("div");
  wrap.appendChild(formHost);
  container.appendChild(wrap);

  authApi
    .session()
    .then((session) => {
      if (!session.authenticated) {
        navigate("/account");
        return;
      }
      renderForm(session);
    })
    .catch(() => {
      navigate("/account");
    });

  function renderForm(session) {
    formHost.innerHTML = "";

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 30;
    if (session.name) nameInput.value = session.name;

    const picker = createAvatarPicker(
      session.avatarValue ? { avatarType: session.avatarType, avatarValue: session.avatarValue } : undefined
    );

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Сохранить и продолжить";

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
        await authApi.updateProfile(name, avatar.avatarType, avatar.avatarValue);
        navigate("/");
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    const logoutLink = document.createElement("button");
    logoutLink.className = "link-btn";
    logoutLink.textContent = "Выйти из аккаунта";
    logoutLink.addEventListener("click", async () => {
      logoutLink.disabled = true;
      try {
        await authApi.logout();
        navigate("/account");
      } catch (e) {
        logoutLink.disabled = false;
      }
    });

    formHost.appendChild(nameInput);
    formHost.appendChild(picker.element);
    formHost.appendChild(errorEl);
    formHost.appendChild(btn);
    formHost.appendChild(logoutLink);
  }
}
