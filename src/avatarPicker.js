import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

// An emoji avatar sits on a coloured circle. The colour travels inside the
// avatar value as "emoji|#rrggbb" (the server only accepts these colours).
export const AVATAR_COLORS = ["#ff5da2", "#ff9a3c", "#36d1dc", "#8a5cff", "#5dffa7", "#ffd23f"];

const CATEGORIES = [
  { id: "animals", label: "Звери", emojis: ["🦊", "🐸", "🐼", "🐵", "🐶", "🐱", "🦁", "🐯", "🐨", "🐰", "🐻", "🦄"] },
  { id: "food", label: "Еда", emojis: ["🍕", "🍔", "🍩", "🍉", "🌮", "🍪", "🍣", "🥑", "🍿", "🍒", "🥐", "🧁"] },
  { id: "faces", label: "Лица", emojis: ["🙂", "😎", "🥳", "🤡", "👻", "🤖", "👽", "🧙", "🧛", "😈", "🥸", "🤠"] },
  { id: "things", label: "Вещи", emojis: ["🚀", "🎮", "⚡", "🌈", "🔥", "👑", "🍺", "🎲", "🎧", "⚽", "🎸", "🏆"] },
];

// "🦊|#ff9a3c" -> { emoji: "🦊", color: "#ff9a3c" }
export function parseAvatarValue(value) {
  const text = value == null ? "" : String(value);
  const i = text.indexOf("|");
  if (i < 0) return { emoji: text, color: null };
  return { emoji: text.slice(0, i), color: text.slice(i + 1) || null };
}

function safeColor(color) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

export function createAvatarPicker(initial, takenEmojis) {
  const taken = new Set(takenEmojis || []);
  const allEmojis = CATEGORIES.flatMap((c) => c.emojis);
  const fallback = allEmojis.find((e) => !taken.has(e)) || allEmojis[0];

  const initialIsPhoto = initial && initial.avatarType === "photo";
  const initialParts = initialIsPhoto ? { emoji: "", color: null } : parseAvatarValue(initial && initial.avatarValue);
  const state = {
    avatarType: initialIsPhoto ? "photo" : "emoji",
    photo: initialIsPhoto ? initial.avatarValue : null,
    emoji: initialParts.emoji || fallback,
    color: safeColor(initialParts.color) || AVATAR_COLORS[0],
    uploading: false,
  };
  let category = Math.max(
    0,
    CATEGORIES.findIndex((c) => c.emojis.includes(state.emoji))
  );

  const wrap = document.createElement("div");
  wrap.className = "avatar-picker";

  // preview with a camera badge for an own photo
  const previewRow = document.createElement("div");
  previewRow.className = "avatar-preview-row";
  const preview = document.createElement("div");
  preview.className = "avatar-preview";
  const cam = document.createElement("label");
  cam.className = "avatar-cam";
  cam.title = "Своё фото";
  cam.innerHTML = `<span aria-hidden="true">📷</span>`;
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "image/*";
  uploadInput.style.display = "none";
  cam.appendChild(uploadInput);
  previewRow.appendChild(preview);
  previewRow.appendChild(cam);
  wrap.appendChild(previewRow);

  const tabs = document.createElement("div");
  tabs.className = "avatar-tabs";
  tabs.setAttribute("role", "tablist");
  wrap.appendChild(tabs);

  const grid = document.createElement("div");
  grid.className = "emoji-grid";
  wrap.appendChild(grid);

  const colors = document.createElement("div");
  colors.className = "avatar-colors";
  wrap.appendChild(colors);

  const photoNote = document.createElement("button");
  photoNote.type = "button";
  photoNote.className = "avatar-photo-note";
  photoNote.textContent = "Вернуться к эмодзи";
  photoNote.addEventListener("click", () => {
    state.avatarType = "emoji";
    renderAll();
  });
  wrap.appendChild(photoNote);

  function renderPreview() {
    if (state.avatarType === "photo" && state.photo) {
      preview.style.background = "";
      preview.innerHTML = `<img src="/uploads/${escapeHtml(state.photo)}" alt="avatar" />`;
    } else {
      preview.style.background = state.color;
      preview.textContent = state.emoji;
    }
  }

  function renderTabs() {
    tabs.innerHTML = "";
    CATEGORIES.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "avatar-tab";
      btn.textContent = c.label;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(i === category));
      btn.addEventListener("click", () => {
        category = i;
        renderTabs();
        renderGrid();
      });
      tabs.appendChild(btn);
    });
  }

  function renderGrid() {
    grid.innerHTML = "";
    CATEGORIES[category].emojis.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-btn";
      btn.textContent = emoji;
      const isTaken = taken.has(emoji);
      if (isTaken) {
        btn.disabled = true;
        btn.classList.add("emoji-taken");
        btn.title = "Этот эмодзи уже занят другим игроком";
      }
      if (state.avatarType === "emoji" && emoji === state.emoji) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        state.avatarType = "emoji";
        state.emoji = emoji;
        renderAll();
      });
      grid.appendChild(btn);
    });
  }

  function renderColors() {
    colors.innerHTML = "";
    AVATAR_COLORS.forEach((color) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "avatar-color";
      btn.style.background = color;
      btn.setAttribute("aria-label", "Цвет фона");
      btn.setAttribute("aria-pressed", String(color === state.color));
      btn.addEventListener("click", () => {
        state.color = color;
        state.avatarType = "emoji";
        renderAll();
      });
      colors.appendChild(btn);
    });
  }

  function renderAll() {
    renderPreview();
    renderGrid();
    renderColors();
    photoNote.hidden = state.avatarType !== "photo";
  }

  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files[0];
    if (!file) return;
    state.uploading = true;
    cam.classList.add("uploading");
    try {
      const res = await api.uploadAvatar(file);
      state.avatarType = "photo";
      state.photo = res.filename;
      renderAll();
    } catch (e) {
      alert("Не удалось загрузить фото: " + e.message);
    } finally {
      state.uploading = false;
      cam.classList.remove("uploading");
      uploadInput.value = "";
    }
  });

  renderTabs();
  renderAll();

  return {
    element: wrap,
    getValue: () =>
      state.avatarType === "photo" && state.photo
        ? { avatarType: "photo", avatarValue: state.photo }
        : { avatarType: "emoji", avatarValue: `${state.emoji}|${state.color}` },
    isUploading: () => state.uploading,
  };
}

function coloredEmojiHtml(emoji, color) {
  return `<span class="avatar-emoji avatar-colored" style="background:${color}">${escapeHtml(emoji)}</span>`;
}

export function avatarHtml(player) {
  if (player.avatarType === "photo") {
    return `<img class="avatar-img" src="/uploads/${escapeHtml(player.avatarValue)}" alt="${escapeHtml(
      player.name
    )}" />`;
  }
  const { emoji, color } = parseAvatarValue(player.avatarValue);
  const c = safeColor(color);
  return c ? coloredEmojiHtml(emoji, c) : `<span class="avatar-emoji">${escapeHtml(emoji)}</span>`;
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
  const { emoji, color } = parseAvatarValue(player.avatarValue);
  const span = document.createElement("span");
  span.className = "avatar-emoji";
  span.textContent = emoji;
  span.dataset.avatar = String(player.avatarValue);
  const c = safeColor(color);
  if (c) {
    span.classList.add("avatar-colored");
    span.style.background = c;
  }
  return span;
}

function avatarElementMatches(el, player) {
  if (!el) return false;
  if (player.avatarType === "photo") {
    return el.tagName === "IMG" && el.getAttribute("src") === `/uploads/${player.avatarValue}`;
  }
  return el.tagName === "SPAN" && el.dataset.avatar === String(player.avatarValue);
}

export function reuseOrCreateAvatarElement(existingEl, player) {
  return avatarElementMatches(existingEl, player) ? existingEl : createAvatarElement(player);
}
