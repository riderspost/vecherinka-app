import { authApi, reverseApi } from "../../api.js";
import { saveSession, getDeviceId } from "../../storage.js";
import { navigate } from "../../router.js";
import { createAvatarPicker } from "../../avatarPicker.js";
import { mountWizardFrame } from "../../wizard.js";
import { escapeHtml } from "../../utils.js";

// The same three steps as "Продолжи предложение": rules, who you are, then
// the room (its lobby is the third step).
const TOTAL_STEPS = 3;
const SLIDES = [
  {
    emoji: "🎙",
    title: "Загадайте фразу",
    text: "Один игрок записывает на микрофон короткую фразу. Пока идёт запись, остальные её не слышат.",
  },
  {
    emoji: "⏪",
    title: "Послушайте наоборот",
    text: "Запись переворачивают задом наперёд. Другой игрок слушает её по частям и повторяет услышанное: звуки, а не смысл.",
    demo: { q: "Загадали: «мы идём гулять»", a: "слышно: «ьтялуг мёди ыМ»" },
  },
  {
    emoji: "🎯",
    title: "Угадайте, что загадали",
    text: "Повтор переворачивают обратно, и получается похоже на оригинал. Угадал — +1 очко, а тому, кто загадывал, — по очку за каждого угадавшего.",
  },
];

export function renderReverseHome(container) {
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
        showWhoStep();
      }
    });

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "wz-link";
    skip.textContent = "Пропустить правила";
    skip.addEventListener("click", showWhoStep);

    body.appendChild(track);
    body.appendChild(dots);
    body.appendChild(next);
    body.appendChild(skip);
    setIndex(0);
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
        const res = await reverseApi.createRoom({ name, ...avatar, deviceId: getDeviceId() });
        saveSession(res.code, { token: res.token, playerId: res.playerId });
        navigate(`/reverse/r/${res.code}`);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    form.appendChild(nameLabel);
    form.appendChild(avatarField);
    form.appendChild(errorEl);
    form.appendChild(btn);

    const mic = document.createElement("p");
    mic.className = "wz-note";
    mic.textContent = "🎙 Каждому игроку понадобится микрофон на своём телефоне.";
    form.appendChild(mic);

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
