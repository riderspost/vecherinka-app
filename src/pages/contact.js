import { api, authApi } from "../api.js";
import { navigate } from "../router.js";

const MAX_MESSAGE_LEN = 5000;

export function renderContactPage(container) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `
    <h1 class="logo">✉️ Связаться с разработчиком</h1>
    <p class="tagline">Нашли баг или есть идея? Напишите — ответим на почту.</p>
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

  const emailLabel = document.createElement("label");
  emailLabel.textContent = "Ваш email";
  const emailInput = document.createElement("input");
  emailInput.className = "text-input";
  emailInput.type = "email";
  emailInput.placeholder = "you@example.com";
  emailInput.autocomplete = "email";

  const messageLabel = document.createElement("label");
  messageLabel.textContent = "Сообщение";
  const messageArea = document.createElement("textarea");
  messageArea.className = "answer-input";
  messageArea.maxLength = MAX_MESSAGE_LEN;
  messageArea.placeholder = "Опишите проблему или предложение...";

  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Отправить";

  const errorEl = document.createElement("div");
  errorEl.className = "error-msg";
  const successEl = document.createElement("div");
  successEl.className = "success-msg";

  btn.addEventListener("click", async () => {
    errorEl.textContent = "";
    successEl.textContent = "";
    const email = emailInput.value.trim();
    const message = messageArea.value.trim();
    if (!email || !email.includes("@")) {
      errorEl.textContent = "Введите корректный email";
      return;
    }
    if (!message) {
      errorEl.textContent = "Введите сообщение";
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

  wrap.appendChild(emailLabel);
  wrap.appendChild(emailInput);
  wrap.appendChild(messageLabel);
  wrap.appendChild(messageArea);
  wrap.appendChild(errorEl);
  wrap.appendChild(successEl);
  wrap.appendChild(btn);

  container.appendChild(wrap);

  authApi
    .session()
    .then((res) => {
      if (res.authenticated && res.email) emailInput.value = res.email;
    })
    .catch(() => {});
}
