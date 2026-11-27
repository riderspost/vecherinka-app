// "Поделиться": a field with the link and a copy button, and buttons for
// Telegram and WhatsApp. The same block is used in the room lobbies of all
// games and in the "Поделиться приложением" sheet of the settings.

import { openBottomSheet } from "./swipeSheet.js";
import { shareLinks } from "./wizard.js";

const APP_TEXT = "Играем в PLYNGER: «Продолжи предложение», «Фанты» и «Наоборот». Заходи:";

// Plain glyphs in the services' colours (no smileys, no external pictures).
const TELEGRAM_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#2aabee" d="M18.6 5.6 4.9 10.9c-.9.4-.9.9-.2 1.1l3.5 1.1 1.4 4.3c.2.5.3.7.7.7.4 0 .6-.2.9-.4l1.9-1.8 3.7 2.7c.7.4 1.2.2 1.4-.6l2.4-11.3c.3-1.1-.4-1.6-1.3-1.2zM9.4 13.2l7.3-4.6c.3-.2.6 0 .4.2l-6 5.4-.2 2.4z"/></svg>`;
const WHATSAPP_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#25d366" d="M12 3.2a8.7 8.7 0 0 0-7.5 13.1L3.3 20.7l4.5-1.2A8.7 8.7 0 1 0 12 3.2zm0 1.6a7.1 7.1 0 1 1-3.7 13.2l-.3-.2-2.2.6.6-2.1-.2-.3A7.1 7.1 0 0 1 12 4.8zM9 8.2c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.2.2 1.8 2.8 4.4 3.8 2.1.8 2.5.7 3 .6.5 0 1.4-.6 1.6-1.1.2-.6.2-1.1.2-1.2l-.4-.2-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.9-.4-2.2-1.1-3.2-2.6-.1-.2 0-.3.1-.4l.4-.5.2-.4v-.4l-.7-1.7c-.2-.4-.3-.4-.5-.4z"/></svg>`;

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  legacyCopy(text);
  return Promise.resolve();
}

// For old browsers and pages without clipboard access.
function legacyCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
  } catch (e) {
    // nothing more to try
  }
  area.remove();
}

// { url, text } -> the block's element.
export function createShareBlock({ url, text }) {
  const links = shareLinks(url, text);
  const wrap = document.createElement("div");
  wrap.className = "share3";

  const field = document.createElement("div");
  field.className = "share3-field";
  const shown = document.createElement("span");
  shown.textContent = url.replace(/^https?:\/\//, "");
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "share3-copy";
  copy.textContent = "Копировать";
  copy.addEventListener("click", async () => {
    await copyText(url);
    copy.textContent = "Скопировано";
    copy.classList.add("done");
    setTimeout(() => {
      copy.textContent = "Копировать";
      copy.classList.remove("done");
    }, 1600);
  });
  field.append(shown, copy);
  wrap.appendChild(field);

  const row = document.createElement("div");
  row.className = "share3-row";
  row.innerHTML = `
    <a class="share3-btn tg" href="${links.telegram}" target="_blank" rel="noopener">${TELEGRAM_ICON}Telegram</a>
    <a class="share3-btn wa" href="${links.whatsapp}" target="_blank" rel="noopener">${WHATSAPP_ICON}WhatsApp</a>
  `;
  wrap.appendChild(row);

  // Phones can also offer everything else they have installed.
  if (navigator.share) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "share3-more";
    more.textContent = "Другие приложения";
    more.addEventListener("click", () => {
      navigator.share({ title: "PLYNGER", text, url }).catch(() => {});
    });
    wrap.appendChild(more);
  }
  return wrap;
}

// The "Поделиться приложением" sheet: a link to the app itself.
export function openShareSheet() {
  openBottomSheet({
    title: "Поделиться PLYNGER",
    build: (content) => {
      const note = document.createElement("p");
      note.className = "share3-note";
      note.textContent = "Отправьте друзьям ссылку на игру. Откроется в браузере, установка не нужна.";
      content.appendChild(note);
      content.appendChild(createShareBlock({ url: window.location.origin, text: APP_TEXT }));
    },
  });
}

// A row for a settings list.
export function shareRow() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hub-row";
  btn.innerHTML = `<span class="hub-row-icon" aria-hidden="true">📣</span>
    <span class="hub-row-text">Поделиться приложением<small>Отправить ссылку друзьям</small></span>
    <span class="hub-row-arrow" aria-hidden="true">›</span>`;
  btn.addEventListener("click", openShareSheet);
  return btn;
}
