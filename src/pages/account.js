import { authApi } from "../api.js";
import { navigate } from "../router.js";

function textInput(placeholder, type = "text") {
  const input = document.createElement("input");
  input.className = "text-input";
  input.type = type;
  input.placeholder = placeholder;
  input.autocomplete = type === "password" ? "current-password" : "email";
  return input;
}

function primaryBtn(text) {
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = text;
  return btn;
}

function messageDiv() {
  const div = document.createElement("div");
  div.className = "error-msg";
  return div;
}

export function renderAccountPage(container) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";

  const resetToken = new URLSearchParams(window.location.search).get("token");
  if (resetToken) {
    renderResetForm(wrap, resetToken);
    container.appendChild(wrap);
    return;
  }

  wrap.innerHTML = `
    <h1 class="logo">👤 Аккаунт</h1>
    <p class="tagline">Войдите, чтобы видеть историю игр и управлять своими фантами</p>
  `;

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  const loginTab = document.createElement("button");
  loginTab.className = "tab active";
  loginTab.textContent = "Войти";
  const registerTab = document.createElement("button");
  registerTab.className = "tab";
  registerTab.textContent = "Регистрация";
  const forgotTab = document.createElement("button");
  forgotTab.className = "tab";
  forgotTab.textContent = "Забыли пароль";
  tabs.appendChild(loginTab);
  tabs.appendChild(registerTab);
  tabs.appendChild(forgotTab);
  wrap.appendChild(tabs);

  const formHost = document.createElement("div");
  wrap.appendChild(formHost);
  container.appendChild(wrap);

  const allTabs = [loginTab, registerTab, forgotTab];
  function setActive(tab) {
    allTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
  }

  function showLoginForm() {
    setActive(loginTab);
    formHost.innerHTML = "";

    const emailInput = textInput("Email");
    const passwordInput = textInput("Пароль", "password");
    const btn = primaryBtn("Войти");
    const msgEl = messageDiv();

    btn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) {
        msgEl.className = "error-msg";
        msgEl.textContent = "Заполните email и пароль";
        return;
      }
      btn.disabled = true;
      msgEl.textContent = "";
      try {
        await authApi.login(email, password);
        navigate("/");
      } catch (e) {
        msgEl.className = "error-msg";
        msgEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    formHost.appendChild(emailInput);
    formHost.appendChild(passwordInput);
    formHost.appendChild(msgEl);
    formHost.appendChild(btn);
  }

  function showRegisterForm() {
    setActive(registerTab);
    formHost.innerHTML = "";

    const emailInput = textInput("Email");
    const passwordInput = textInput("Пароль (от 8 символов)", "password");
    passwordInput.autocomplete = "new-password";
    const btn = primaryBtn("Зарегистрироваться");
    const msgEl = messageDiv();

    btn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) {
        msgEl.className = "error-msg";
        msgEl.textContent = "Заполните email и пароль";
        return;
      }
      btn.disabled = true;
      msgEl.textContent = "";
      try {
        await authApi.register(email, password);
        navigate("/");
      } catch (e) {
        msgEl.className = "error-msg";
        msgEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    formHost.appendChild(emailInput);
    formHost.appendChild(passwordInput);
    formHost.appendChild(msgEl);
    formHost.appendChild(btn);
  }

  function showForgotForm() {
    setActive(forgotTab);
    formHost.innerHTML = "";

    const emailInput = textInput("Email");
    const btn = primaryBtn("Отправить ссылку");
    const msgEl = messageDiv();

    btn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      if (!email) {
        msgEl.className = "error-msg";
        msgEl.textContent = "Введите email";
        return;
      }
      btn.disabled = true;
      msgEl.textContent = "";
      try {
        await authApi.forgotPassword(email);
        msgEl.className = "success-msg";
        msgEl.textContent = "Если такой email зарегистрирован, на него отправлена ссылка для восстановления пароля";
      } catch (e) {
        msgEl.className = "error-msg";
        msgEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    formHost.appendChild(emailInput);
    formHost.appendChild(msgEl);
    formHost.appendChild(btn);
  }

  loginTab.addEventListener("click", showLoginForm);
  registerTab.addEventListener("click", showRegisterForm);
  forgotTab.addEventListener("click", showForgotForm);
  showLoginForm();
}

function renderResetForm(wrap, token) {
  wrap.innerHTML = `
    <h1 class="logo">🔑 Новый пароль</h1>
    <p class="tagline">Придумайте новый пароль для входа</p>
  `;

  const passwordInput = textInput("Новый пароль (от 8 символов)", "password");
  passwordInput.autocomplete = "new-password";
  const btn = primaryBtn("Сохранить");
  const msgEl = messageDiv();

  btn.addEventListener("click", async () => {
    const password = passwordInput.value;
    if (!password) {
      msgEl.className = "error-msg";
      msgEl.textContent = "Введите новый пароль";
      return;
    }
    btn.disabled = true;
    msgEl.textContent = "";
    try {
      await authApi.resetPassword(token, password);
      navigate("/");
    } catch (e) {
      msgEl.className = "error-msg";
      msgEl.textContent = e.message;
      btn.disabled = false;
    }
  });

  wrap.appendChild(passwordInput);
  wrap.appendChild(msgEl);
  wrap.appendChild(btn);
}
