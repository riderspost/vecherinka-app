import { navigate } from "../router.js";
import { forgetAccountLinkedSessions } from "../storage.js";
import { createAvatarElement } from "../avatarPicker.js";
import { installRow } from "./hub/install.js";
import { shareRow } from "../shareBlock.js";
import { mountWizardFrame } from "../wizard.js";
import { authApi } from "../api.js";

function row(icon, text, onClick, className = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `hub-row ${className}`.trim();
  btn.innerHTML = `<span class="hub-row-icon" aria-hidden="true">${icon}</span><span></span><span class="hub-row-arrow" aria-hidden="true">›</span>`;
  btn.children[1].textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

// Account settings: opened from the gear at the top of the home screen.
export function renderProfileSettings(container) {
  const body = mountWizardFrame(container, {
    current: 1,
    total: 0,
    title: "Настройки",
    onBack: () => navigate("/"),
  });
  body.classList.add("settings-body");

  authApi.session().catch(() => ({ authenticated: false })).then((session) => {
    if (!session.authenticated) {
      const gate = document.createElement("div");
      gate.className = "hub-gate";
      gate.innerHTML = `
        <span class="hub-gate-emoji" aria-hidden="true">🎉</span>
        <b>Играйте под своим именем</b>
        <p>Аккаунт запоминает имя и аватарку и хранит ваши открытые комнаты.</p>
      `;
      const login = document.createElement("button");
      login.type = "button";
      login.className = "hub-login-btn";
      login.textContent = "Войти или создать аккаунт";
      login.addEventListener("click", () => navigate("/account"));
      gate.appendChild(login);
      body.appendChild(gate);
      const list = document.createElement("div");
      list.className = "hub-list";
      list.appendChild(installRow());
      list.appendChild(shareRow());
      list.appendChild(row("✉️", "Связаться с разработчиком", () => navigate("/contact")));
      body.appendChild(list);
      return;
    }

    const head = document.createElement("div");
    head.className = "hub-profile-head";
    const av = document.createElement("span");
    av.className = "hub-profile-avatar";
    av.appendChild(createAvatarElement({ avatarType: session.avatarType, avatarValue: session.avatarValue, name: session.name }));
    const name = document.createElement("b");
    name.textContent = session.name || "Без имени";
    const mail = document.createElement("small");
    mail.textContent = session.email;
    head.appendChild(av);
    head.appendChild(name);
    head.appendChild(mail);
    body.appendChild(head);

    const list = document.createElement("div");
    list.className = "hub-list";
    list.appendChild(row("🖼️", "Имя и аватар", () => navigate("/profile/edit")));
    list.appendChild(installRow());
    list.appendChild(shareRow());
    list.appendChild(row("✉️", "Связаться с разработчиком", () => navigate("/contact")));
    const logout = row("🚪", "Выйти", async () => {
      logout.disabled = true;
      try {
        await forgetAccountLinkedSessions();
        await authApi.logout();
        navigate("/");
      } catch (e) {
        logout.disabled = false;
      }
    }, "danger");
    logout.querySelector(".hub-row-arrow").textContent = "";
    list.appendChild(logout);
    body.appendChild(list);
  });
}
