import { authApi } from "../api.js";
import { navigate } from "../router.js";

const RESEND_COOLDOWN_MS = 20000;

function textInput(placeholder, type = "text") {
  const input = document.createElement("input");
  input.className = "text-input";
  input.type = type;
  input.placeholder = placeholder;
  input.autocomplete = type === "password" ? "current-password" : "email";
  return input;
}

function passwordField(placeholder, autocomplete) {
  const wrap = document.createElement("div");
  wrap.className = "password-field";

  const input = document.createElement("input");
  input.className = "text-input";
  input.type = "password";
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "password-toggle";
  toggle.textContent = "👁️";
  toggle.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggle.textContent = showing ? "👁️" : "🙈";
  });

  wrap.appendChild(input);
  wrap.appendChild(toggle);
  return { element: wrap, input };
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

  function showVerifyStep(email) {
    formHost.innerHTML = "";

    const info = document.createElement("p");
    info.className = "tagline";
    info.textContent = `Мы отправили код подтверждения на ${email}`;
    formHost.appendChild(info);

    const codeInput = document.createElement("input");
    codeInput.className = "text-input code-input";
    codeInput.maxLength = 6;
    codeInput.inputMode = "numeric";
    codeInput.placeholder = "000000";

    const btn = primaryBtn("Подтвердить");
    const msgEl = messageDiv();

    btn.addEventListener("click", async () => {
      const code = codeInput.value.trim();
      if (!code) {
        msgEl.className = "error-msg";
        msgEl.textContent = "Введите код из письма";
        return;
      }
      btn.disabled = true;
      msgEl.textContent = "";
      try {
        await authApi.verifyEmail(email, code);
        navigate("/");
      } catch (e) {
        msgEl.className = "error-msg";
        msgEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    const resendBtn = document.createElement("button");
    resendBtn.className = "link-btn";
    resendBtn.textContent = "Отправить код ещё раз";
    resendBtn.addEventListener("click", async () => {
      resendBtn.disabled = true;
      try {
        await authApi.resendCode(email);
        msgEl.className = "success-msg";
        msgEl.textContent = "Код отправлен ещё раз";
      } catch (e) {
        msgEl.className = "error-msg";
        msgEl.textContent = e.message;
      }
      setTimeout(() => {
        resendBtn.disabled = false;
      }, RESEND_COOLDOWN_MS);
    });

    formHost.appendChild(codeInput);
    formHost.appendChild(msgEl);
    formHost.appendChild(btn);
    formHost.appendChild(resendBtn);
  }

  function showLoginForm() {
    setActive(loginTab);
    formHost.innerHTML = "";

    const emailInput = textInput("Email");
    const pf = passwordField("Пароль", "current-password");
    const btn = primaryBtn("Войти");
    const msgEl = messageDiv();

    btn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      const password = pf.input.value;
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
        if (e.needsVerification) {
          showVerifyStep(e.email);
          return;
        }
        msgEl.className = "error-msg";
        msgEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    formHost.appendChild(emailInput);
    formHost.appendChild(pf.element);
    formHost.appendChild(msgEl);
    formHost.appendChild(btn);
  }

  function showRegisterForm() {
    setActive(registerTab);
    formHost.innerHTML = "";

    const emailInput = textInput("Email");
    const pf = passwordField("Пароль (от 8 символов)", "new-password");
    const pfConfirm = passwordField("Повторите пароль", "new-password");
    const btn = primaryBtn("Зарегистрироваться");
    const msgEl = messageDiv();

    btn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      const password = pf.input.value;
      const confirm = pfConfirm.input.value;
      if (!email || !password || !confirm) {
        msgEl.className = "error-msg";
        msgEl.textContent = "Заполните все поля";
        return;
      }
      if (password !== confirm) {
        msgEl.className = "error-msg";
        msgEl.textContent = "Пароли не совпадают";
        return;
      }
      btn.disabled = true;
      msgEl.textContent = "";
      try {
        const res = await authApi.register(email, password);
        if (res.needsVerification) {
          showVerifyStep(res.email);
        } else {
          navigate("/");
        }
      } catch (e) {
        msgEl.className = "error-msg";
        msgEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    formHost.appendChild(emailInput);
    formHost.appendChild(pf.element);
    formHost.appendChild(pfConfirm.element);
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
        msgEl.textContent = "Ссылка для восстановления пароля отправлена на почту";
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

  const pf = passwordField("Новый пароль (от 8 символов)", "new-password");
  const btn = primaryBtn("Сохранить");
  const msgEl = messageDiv();

  btn.addEventListener("click", async () => {
    const password = pf.input.value;
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

  wrap.appendChild(pf.element);
  wrap.appendChild(msgEl);
  wrap.appendChild(btn);
}
