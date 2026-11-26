import { api, authApi } from "../api.js";
import { navigate } from "../router.js";
import { mountWizardFrame } from "../wizard.js";

const MAX_MESSAGE_LEN = 5000;

export function renderContactPage(container) {
  const body = mountWizardFrame(container, {
    current: 1,
    total: 0,
    title: "Связаться с разработчиком",
    onBack: () => (window.history.length > 1 ? window.history.back() : navigate("/")),
  });

  const intro = document.createElement("p");
  intro.className = "wz-note wz-note-left";
  intro.textContent = "Нашли ошибку или есть идея? Напишите, и мы ответим на почту.";
  body.appendChild(intro);

  const form = document.createElement("div");
  form.className = "wz-form";
  body.appendChild(form);

  const emailLabel = document.createElement("label");
  emailLabel.className = "wz-field";
  emailLabel.innerHTML = `<span>Ваша почта</span>`;
  const emailInput = document.createElement("input");
  emailInput.className = "text-input";
  emailInput.type = "email";
  emailInput.placeholder = "you@example.com";
  emailInput.autocomplete = "email";
  emailLabel.appendChild(emailInput);

  const messageLabel = document.createElement("label");
  messageLabel.className = "wz-field";
  messageLabel.innerHTML = `<span>Сообщение</span>`;
  const messageArea = document.createElement("textarea");
  messageArea.className = "answer-input wz-textarea";
  messageArea.maxLength = MAX_MESSAGE_LEN;
  messageArea.placeholder = "Опишите проблему или предложение…";
  messageLabel.appendChild(messageArea);

  const errorEl = document.createElement("div");
  errorEl.className = "error-msg";
  const successEl = document.createElement("div");
  successEl.className = "wz-success";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wz-cta";
  btn.textContent = "Отправить";

  btn.addEventListener("click", async () => {
    errorEl.textContent = "";
    successEl.textContent = "";
    const email = emailInput.value.trim();
    const message = messageArea.value.trim();
    if (!email || !email.includes("@")) {
      errorEl.textContent = "Введите корректную почту";
      emailInput.focus();
      return;
    }
    if (!message) {
      errorEl.textContent = "Введите сообщение";
      messageArea.focus();
      return;
    }

    btn.disabled = true;
    try {
      await api.contact(email, message);
      successEl.textContent = "Спасибо! Сообщение отправлено.";
      messageArea.value = "";
    } catch (e) {
      errorEl.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  form.appendChild(emailLabel);
  form.appendChild(messageLabel);
  form.appendChild(errorEl);
  form.appendChild(successEl);
  form.appendChild(btn);

  authApi
    .session()
    .then((res) => {
      if (res.authenticated && res.email) emailInput.value = res.email;
    })
    .catch(() => {});
}
