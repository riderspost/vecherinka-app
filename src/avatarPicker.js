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
    uploading: false,
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
      uploadLabelText.textContent = DEFAULT_UPLOAD_TEXT;
    });
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);

  const uploadLabel = document.createElement("label");
  uploadLabel.className = "upload-label";
  const uploadLabelText = document.createElement("span");
  const DEFAULT_UPLOAD_TEXT = "📷 Загрузить своё фото";
  const CHANGE_UPLOAD_TEXT = "📷 Изменить фото";
  uploadLabelText.textContent = state.avatarType === "photo" ? CHANGE_UPLOAD_TEXT : DEFAULT_UPLOAD_TEXT;
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "image/*";
  uploadInput.style.display = "none";
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files[0];
    if (!file) return;
    state.uploading = true;
    uploadLabelText.textContent = "Загрузка...";
    try {
      const res = await api.uploadAvatar(file);
      state.avatarType = "photo";
      state.avatarValue = res.filename;
      renderPreview();
    } catch (e) {
      alert("Не удалось загрузить фото: " + e.message);
    } finally {
      state.uploading = false;
      uploadLabelText.textContent = state.avatarType === "photo" ? CHANGE_UPLOAD_TEXT : DEFAULT_UPLOAD_TEXT;
      uploadInput.value = "";
    }
  });
  uploadLabel.appendChild(uploadLabelText);
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
    isUploading: () => state.uploading,
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

// DOM-element (not string) version, for call sites that re-render on a poll
// loop. Rebuilding an avatar from an HTML string on every tick forces the
// browser to load a fresh <img> each time — invisible for the bundled emoji
// spans, but a visible flicker for uploaded photo avatars, since those are
// never cached by the service worker. reuseOrCreateAvatarElement lets a
// caller keep handing back the same node across renders when the avatar
// itself hasn't actually changed.
export function createAvatarElement(player) {
  if (player.avatarType === "photo") {
    const img = document.createElement("img");
    img.className = "avatar-img";
    img.src = `/uploads/${player.avatarValue}`;
    img.alt = player.name;
    return img;
  }
  const span = document.createElement("span");
  span.className = "avatar-emoji";
  span.textContent = player.avatarValue;
  return span;
}

function avatarElementMatches(el, player) {
  if (!el) return false;
  if (player.avatarType === "photo") {
    return el.tagName === "IMG" && el.getAttribute("src") === `/uploads/${player.avatarValue}`;
  }
  return el.tagName === "SPAN" && el.textContent === player.avatarValue;
}

export function reuseOrCreateAvatarElement(existingEl, player) {
  return avatarElementMatches(existingEl, player) ? existingEl : createAvatarElement(player);
}
