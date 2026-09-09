import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

const EMOJIS = [
  "🙂", "😎", "🥳", "🤡", "👻", "🐱", "🐶", "🦊", "🐼", "🐸",
  "🦁", "🐵", "🍕", "🍔", "🍩", "🚀", "🎮", "⚡", "🌈", "🔥",
  "👑", "🧙", "🧛", "🤖", "👽", "🦄", "🍺", "🎲", "🎧", "⚽",
];

export function createAvatarPicker(initial, takenEmojis) {
  const taken = new Set(takenEmojis || []);
  const fallback = EMOJIS.find((e) => !taken.has(e)) || EMOJIS[0];
  const state = {
    avatarType: (initial && initial.avatarType) || "emoji",
    avatarValue: (initial && initial.avatarValue) || fallback,
  };

  const wrap = document.createElement("div");
  wrap.className = "avatar-picker";

  const preview = document.createElement("div");
  preview.className = "avatar-preview";
  wrap.appendChild(preview);

  const grid = document.createElement("div");
  grid.className = "emoji-grid";
  EMOJIS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-btn";
    btn.textContent = emoji;
    if (taken.has(emoji)) {
      btn.disabled = true;
      btn.className += " emoji-taken";
      btn.title = "Этот эмодзи уже занят другим игроком";
    }
    btn.addEventListener("click", () => {
      state.avatarType = "emoji";
      state.avatarValue = emoji;
      renderPreview();
    });
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);

  const uploadLabel = document.createElement("label");
  uploadLabel.className = "upload-label";
  uploadLabel.textContent = "📷 Загрузить своё фото";
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "image/*";
  uploadInput.style.display = "none";
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files[0];
    if (!file) return;
    uploadLabel.textContent = "Загрузка...";
    try {
      const res = await api.uploadAvatar(file);
      state.avatarType = "photo";
      state.avatarValue = res.filename;
      renderPreview();
    } catch (e) {
      alert("Не удалось загрузить фото: " + e.message);
    } finally {
      uploadLabel.textContent = "📷 Загрузить своё фото";
    }
  });
  uploadLabel.appendChild(uploadInput);
  wrap.appendChild(uploadLabel);

  function renderPreview() {
    if (state.avatarType === "photo") {
      preview.innerHTML = `<img src="/uploads/${state.avatarValue}" alt="avatar" />`;
    } else {
      preview.textContent = state.avatarValue;
    }
  }
  renderPreview();

  return {
    element: wrap,
    getValue: () => ({ avatarType: state.avatarType, avatarValue: state.avatarValue }),
  };
}

export function avatarHtml(player) {
  if (player.avatarType === "photo") {
    return `<img class="avatar-img" src="/uploads/${escapeHtml(player.avatarValue)}" alt="${escapeHtml(
      player.name
    )}" />`;
  }
  return `<span class="avatar-emoji">${escapeHtml(player.avatarValue)}</span>`;
}
