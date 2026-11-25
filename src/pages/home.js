import { api, authApi } from "../api.js";
import { saveSession, getDeviceId } from "../storage.js";
import { navigate } from "../router.js";
import { createAvatarPicker } from "../avatarPicker.js";
import { mountWizardFrame } from "../wizard.js";
import { escapeHtml } from "../utils.js";

const TOTAL_STEPS = 3;
const SLIDES = [
  {
    emoji: "✍️",
    title: "Допишите фразу",
    text: "Каждому показывают начало фразы. Придумайте самое смешное продолжение.",
    demo: { q: "Мой тайный талант на вечеринках это…", a: "угадывать пароли от чужого вайфая" },
  },
  {
    emoji: "🗳️",
    title: "Голосуйте за лучшее",
    text: "Ответы показывают всем, а голосуют за самый смешной. За свою фразу голосовать нельзя.",
  },
  {
    emoji: "🏆",
    title: "Набирайте очки",
    text: "Чем больше голосов, тем больше очков. Через 5 раундов узнаем победителя.",
  },
];

export function renderHome(container) {
  // The setup always opens on the first step, however it was left last time.
  showRulesStep();

  function showRulesStep() {
    const body = mountWizardFrame(container, {
      current: 1,
      total: TOTAL_STEPS,
      title: "Как играем",
      onBack: () => navigate("/"),
    });

    const track = document.createElement("div");
    track.className = "wz-slides";
    SLIDES.forEach((s) => {
      const slide = document.createElement("section");
      slide.className = "wz-slide";
      slide.innerHTML = `
        <div class="wz-slide-art" aria-hidden="true">${s.emoji}</div>
        <h2>${escapeHtml(s.title)}</h2>
        <p>${escapeHtml(s.text)}</p>
        ${
          s.demo
            ? `<div class="wz-demo"><span class="wz-demo-q">${escapeHtml(s.demo.q)}</span><span class="wz-demo-a"><em>${escapeHtml(s.demo.a)}</em></span></div>`
            : ""
        }
      `;
      track.appendChild(slide);
    });

    const dots = document.createElement("div");
    dots.className = "wz-dots";
    SLIDES.forEach(() => dots.appendChild(document.createElement("i")));

    let index = 0;
    function setIndex(i) {
      index = i;
      [...dots.children].forEach((d, n) => d.classList.toggle("on", n === i));
      next.textContent = i === SLIDES.length - 1 ? "Понятно, дальше" : "Дальше";
    }
    track.addEventListener("scroll", () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (i !== index) setIndex(Math.max(0, Math.min(SLIDES.length - 1, i)));
    });

    const next = document.createElement("button");
    next.type = "button";
    next.className = "wz-cta";
    next.addEventListener("click", () => {
      if (index < SLIDES.length - 1) {
        const target = index + 1;
        setIndex(target);
        track.scrollTo({ left: track.clientWidth * target, behavior: "smooth" });
      } else {
        finishRules();
      }
    });

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "wz-link";
    skip.textContent = "Пропустить правила";
    skip.addEventListener("click", finishRules);

    body.appendChild(track);
    body.appendChild(dots);
    body.appendChild(next);
    body.appendChild(skip);
    setIndex(0);
  }

  function finishRules() {
    showWhoStep();
  }

  async function showWhoStep() {
    const body = mountWizardFrame(container, {
      current: 2,
      total: TOTAL_STEPS,
      title: "Кто вы",
      onBack: showRulesStep,
    });
    const form = document.createElement("div");
    form.className = "wz-form";
    body.appendChild(form);

    let profile = null;
    let authenticated = false;
    try {
      const session = await authApi.session();
      authenticated = Boolean(session.authenticated);
      if (session.authenticated && session.profileComplete) profile = session;
    } catch (e) {
      // not logged in or session check failed — fall back to a blank form
    }

    const nameLabel = document.createElement("label");
    nameLabel.className = "wz-field";
    nameLabel.innerHTML = `<span>Имя</span>`;
    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Как вас зовут?";
    nameInput.maxLength = 20;
    nameInput.autocomplete = "nickname";
    if (profile) nameInput.value = profile.name;
    nameLabel.appendChild(nameInput);

    const avatarField = document.createElement("div");
    avatarField.className = "wz-field";
    avatarField.innerHTML = `<span>Аватар</span>`;
    const picker = createAvatarPicker(
      profile ? { avatarType: profile.avatarType, avatarValue: profile.avatarValue } : undefined
    );
    avatarField.appendChild(picker.element);

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wz-cta";
    btn.textContent = "Создать комнату";
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
        const res = await api.createRoom({ name, ...avatar, deviceId: getDeviceId() });
        saveSession(res.code, { token: res.token, playerId: res.playerId });
        navigate(`/r/${res.code}`);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    form.appendChild(nameLabel);
    form.appendChild(avatarField);
    form.appendChild(errorEl);
    form.appendChild(btn);

    if (!authenticated) {
      const note = document.createElement("p");
      note.className = "wz-note";
      note.innerHTML = `<a href="/account">Войдите в аккаунт</a>, и вернуться в комнату можно будет с любого телефона`;
      note.querySelector("a").addEventListener("click", (e) => {
        e.preventDefault();
        navigate("/account");
      });
      form.appendChild(note);
    }
  }
}
