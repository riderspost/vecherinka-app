import { authApi } from "../api.js";
import { navigate } from "../router.js";
import { mountWizardFrame } from "../wizard.js";

const RESEND_COOLDOWN_MS = 20000;

async function navigateAfterAuth() {
  try {
    const session = await authApi.session();
    if (session.authenticated && !session.profileComplete) {
      navigate("/profile/edit");
      return;
    }
  } catch (e) {
    // ignore and fall through to the normal destination
  }
  navigate("/");
}

function field(label, input) {
  const wrap = document.createElement("label");
  wrap.className = "wz-field";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(input);
  return wrap;
}

function textInput(placeholder, type = "text", autocomplete = "email") {
  const input = document.createElement("input");
  input.className = "text-input";
  input.type = type;
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  return input;
}

// A password box with a show/hide eye.
function passwordField(label, autocomplete) {
  const box = document.createElement("div");
  box.className = "password-field";
  const input = document.createElement("input");
  input.className = "text-input";
  input.type = "password";
  input.autocomplete = autocomplete;
  input.placeholder = "••••••••";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "password-toggle";
  toggle.setAttribute("aria-label", "Показать пароль");
  toggle.textContent = "👁️";
  toggle.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggle.textContent = showing ? "👁️" : "🙈";
    toggle.setAttribute("aria-label", showing ? "Показать пароль" : "Скрыть пароль");
  });
  box.appendChild(input);
  box.appendChild(toggle);
  return { element: field(label, box), input };
}

function submitButton(text) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wz-cta";
  btn.textContent = text;
  return btn;
}

// One line under the form: an error, or (for good news) a green message.
function messageLine() {
  const el = document.createElement("div");
  el.className = "error-msg";
  return {
    element: el,
    error(text) {
      el.className = "error-msg";
      el.textContent = text;
    },
    ok(text) {
      el.className = "wz-success";
      el.textContent = text;
    },
    clear() {
      el.textContent = "";
    },
  };
}

function textLink(text, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wz-link";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function intro(emoji, title, text) {
  const el = document.createElement("div");
  el.className = "acc-intro";
  el.innerHTML = `<span class="acc-intro-emoji" aria-hidden="true">${emoji}</span><b></b><p></p>`;
  el.querySelector("b").textContent = title;
  el.querySelector("p").textContent = text;
  return el;
}

export function renderAccountPage(container) {
  const resetToken = new URLSearchParams(window.location.search).get("token");
  if (resetToken) {
    showReset(resetToken);
    return;
  }
  showEntry("login");

  function frame(title, onBack) {
    const body = mountWizardFrame(container, { current: 1, total: 0, title, onBack: onBack || (() => navigate("/")) });
    body.classList.add("wz-form");
    return body;
  }

  // login and registration are two sides of one screen
  function showEntry(mode) {
    const body = frame(mode === "login" ? "Вход" : "Регистрация");
    body.appendChild(
      intro("🎉", "Играйте под своим именем", "Аккаунт запоминает имя и аватар, хранит ваши открытые комнаты и даёт предлагать свои фанты.")
    );

    const seg = document.createElement("div");
    seg.className = "idea-seg";
    [
      ["login", "Войти"],
      ["register", "Регистрация"],
    ].forEach(([id, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.setAttribute("aria-pressed", String(mode === id));
      btn.addEventListener("click", () => mode !== id && showEntry(id));
      seg.appendChild(btn);
    });
    body.appendChild(seg);

    if (mode === "login") drawLogin(body);
    else drawRegister(body);
  }

  function drawLogin(body) {
    const email = textInput("you@example.com", "email", "email");
    const pf = passwordField("Пароль", "current-password");
    const msg = messageLine();
    const btn = submitButton("Войти");

    async function submit() {
      const emailValue = email.value.trim();
      const password = pf.input.value;
      if (!emailValue || !password) {
        msg.error("Заполните почту и пароль");
        return;
      }
      btn.disabled = true;
      msg.clear();
      try {
        await authApi.login(emailValue, password);
        await navigateAfterAuth();
      } catch (e) {
        if (e.needsVerification) {
          showVerify(e.email);
          return;
        }
        msg.error(e.message);
        btn.disabled = false;
      }
    }
    btn.addEventListener("click", submit);
    pf.input.addEventListener("keydown", (e) => e.key === "Enter" && submit());

    body.appendChild(field("Почта", email));
    body.appendChild(pf.element);
    body.appendChild(msg.element);
    body.appendChild(btn);
    body.appendChild(textLink("Забыли пароль?", showForgot));
  }

  function drawRegister(body) {
    const email = textInput("you@example.com", "email", "email");
    const pf = passwordField("Пароль (от 8 символов)", "new-password");
    const pfConfirm = passwordField("Повторите пароль", "new-password");
    const msg = messageLine();
    const btn = submitButton("Зарегистрироваться");

    btn.addEventListener("click", async () => {
      const emailValue = email.value.trim();
      const password = pf.input.value;
      const confirm = pfConfirm.input.value;
      if (!emailValue || !password || !confirm) {
        msg.error("Заполните все поля");
        return;
      }
      if (password !== confirm) {
        msg.error("Пароли не совпадают");
        return;
      }
      btn.disabled = true;
      msg.clear();
      try {
        const res = await authApi.register(emailValue, password);
        if (res.needsVerification) showVerify(res.email);
        else await navigateAfterAuth();
      } catch (e) {
        msg.error(e.message);
        btn.disabled = false;
      }
    });

    body.appendChild(field("Почта", email));
    body.appendChild(pf.element);
    body.appendChild(pfConfirm.element);
    body.appendChild(msg.element);
    body.appendChild(btn);
  }

  function showVerify(email) {
    const body = frame("Подтверждение почты", () => showEntry("register"));
    body.appendChild(intro("✉️", "Проверьте почту", `Мы отправили шестизначный код на ${email}. Введите его ниже.`));

    const code = document.createElement("input");
    code.className = "text-input code-input";
    code.maxLength = 6;
    code.inputMode = "numeric";
    code.autocomplete = "one-time-code";
    code.placeholder = "000000";
    const msg = messageLine();
    const btn = submitButton("Подтвердить");

    async function submit() {
      const value = code.value.trim();
      if (!value) {
        msg.error("Введите код из письма");
        return;
      }
      btn.disabled = true;
      msg.clear();
      try {
        await authApi.verifyEmail(email, value);
        await navigateAfterAuth();
      } catch (e) {
        msg.error(e.message);
        btn.disabled = false;
      }
    }
    btn.addEventListener("click", submit);
    code.addEventListener("keydown", (e) => e.key === "Enter" && submit());

    const resend = textLink("Отправить код ещё раз", async () => {
      resend.disabled = true;
      try {
        await authApi.resendCode(email);
        msg.ok("Код отправлен ещё раз");
      } catch (e) {
        msg.error(e.message);
      }
      setTimeout(() => {
        resend.disabled = false;
      }, RESEND_COOLDOWN_MS);
    });

    body.appendChild(code);
    body.appendChild(msg.element);
    body.appendChild(btn);
    body.appendChild(resend);
  }

  function showForgot() {
    const body = frame("Восстановление пароля", () => showEntry("login"));
    body.appendChild(intro("🔑", "Забыли пароль?", "Укажите почту, и мы пришлём ссылку для нового пароля."));

    const email = textInput("you@example.com", "email", "email");
    const msg = messageLine();
    const btn = submitButton("Отправить ссылку");
    btn.addEventListener("click", async () => {
      const value = email.value.trim();
      if (!value) {
        msg.error("Введите почту");
        return;
      }
      btn.disabled = true;
      msg.clear();
      try {
        await authApi.forgotPassword(value);
        msg.ok("Ссылка для восстановления пароля отправлена на почту");
      } catch (e) {
        msg.error(e.message);
        btn.disabled = false;
      }
    });

    body.appendChild(field("Почта", email));
    body.appendChild(msg.element);
    body.appendChild(btn);
  }

  function showReset(token) {
    const body = frame("Новый пароль", () => navigate("/account"));
    body.appendChild(intro("🔑", "Придумайте новый пароль", "Он понадобится для входа. Минимум 8 символов."));

    const pf = passwordField("Новый пароль", "new-password");
    const pfConfirm = passwordField("Повторите пароль", "new-password");
    const msg = messageLine();
    const btn = submitButton("Сохранить");
    btn.addEventListener("click", async () => {
      const password = pf.input.value;
      const confirm = pfConfirm.input.value;
      if (!password || !confirm) {
        msg.error("Заполните оба поля");
        return;
      }
      if (password !== confirm) {
        msg.error("Пароли не совпадают");
        return;
      }
      btn.disabled = true;
      msg.clear();
      try {
        await authApi.resetPassword(token, password);
        await navigateAfterAuth();
      } catch (e) {
        msg.error(e.message);
        btn.disabled = false;
      }
    });

    body.appendChild(pf.element);
    body.appendChild(pfConfirm.element);
    body.appendChild(msg.element);
    body.appendChild(btn);
  }
}
