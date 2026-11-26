import { authApi } from "../api.js";
import { navigate } from "../router.js";
import { createAvatarPicker } from "../avatarPicker.js";
import { forgetAccountLinkedSessions } from "../storage.js";
import { mountWizardFrame } from "../wizard.js";

export function renderProfilePage(container) {
  // A new account has to set its name once before anything else; later the
  // page is the "Имя и аватар" setting and has a way back.
  const body = mountWizardFrame(container, {
    current: 1,
    total: 0,
    title: "Имя и аватар",
    onBack: () => navigate("/profile"),
  });
  const backBtn = container.querySelector(".wz-back");
  backBtn.hidden = true;

  const intro = document.createElement("p");
  intro.className = "wz-note wz-note-left";
  intro.textContent = "Имя и аватар будут предложены при создании игры и при входе в комнату.";
  body.appendChild(intro);

  const formHost = document.createElement("div");
  formHost.className = "wz-form";
  body.appendChild(formHost);

  authApi
    .session()
    .then((session) => {
      if (!session.authenticated) {
        navigate("/account");
        return;
      }
      backBtn.hidden = !session.profileComplete;
      renderForm(session);
    })
    .catch(() => {
      navigate("/account");
    });

  function renderForm(session) {
    const isEditing = session.profileComplete;
    formHost.innerHTML = "";

    const nameLabel = document.createElement("label");
    nameLabel.className = "wz-field";
    nameLabel.innerHTML = `<span>Имя</span>`;
    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Как вас зовут?";
    nameInput.maxLength = 20;
    nameInput.autocomplete = "nickname";
    if (session.name) nameInput.value = session.name;
    nameLabel.appendChild(nameInput);

    const avatarField = document.createElement("div");
    avatarField.className = "wz-field";
    avatarField.innerHTML = `<span>Аватар</span>`;
    const picker = createAvatarPicker(
      session.avatarValue ? { avatarType: session.avatarType, avatarValue: session.avatarValue } : undefined
    );
    avatarField.appendChild(picker.element);

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wz-cta";
    btn.textContent = isEditing ? "Сохранить" : "Сохранить и продолжить";

    btn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.textContent = "Введите имя";
        nameInput.focus();
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
        navigate(isEditing ? "/profile" : "/");
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    formHost.appendChild(nameLabel);
    formHost.appendChild(avatarField);
    formHost.appendChild(errorEl);
    formHost.appendChild(btn);

    if (!isEditing) {
      const logoutLink = document.createElement("button");
      logoutLink.type = "button";
      logoutLink.className = "wz-link";
      logoutLink.textContent = "Выйти из аккаунта";
      logoutLink.addEventListener("click", async () => {
        logoutLink.disabled = true;
        try {
          await forgetAccountLinkedSessions();
          await authApi.logout();
          navigate("/account");
        } catch (e) {
          logoutLink.disabled = false;
        }
      });
      formHost.appendChild(logoutLink);
    }
  }
}
