import { api } from "./api.js";
import { avatarHtml } from "./avatarPicker.js";
import { escapeHtml } from "./utils.js";
import { renderTestLinks } from "./devTools.js";
import { shareLinks, stepsBarHtml } from "./wizard.js";

// The lobby of a game where everyone plays on their own phone: invite (QR,
// code, share buttons), how many players are in and whether that is enough,
// the player list with remove buttons for the host, and the start button.
// The same for every such game; each passes what differs.
//   roomPath   the room's own path, e.g. /r/ABCDE
//   gameTitle  used in the text that is shared
//   showSteps  show the "step 3 of 3" bar (the game's setup is a 3-step wizard)
//   startGame  async function the host's start button calls
//   notes      extra lines of text above the start button

// The lobby is redrawn on every poll, so a half-done "remove this player?"
// has to live outside the redrawn buttons.
let armedKick = { id: null, until: 0 };


export function renderLobbyView(wrap, state, token, code, opts) {
  const { roomPath, gameTitle, showSteps, startGame, notes } = opts;
  const shareUrl = `${window.location.origin}${roomPath}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=0&data=${encodeURIComponent(shareUrl)}`;
  const isDisplay = state.me.isDisplay;
  const isHost = state.me.isHost;
  const players = state.players.filter((p) => !p.isDisplay);
  const needed = state.minPlayers;

  wrap.innerHTML = "";
  const root = document.createElement("div");
  root.className = "wz wz-inline";
  root.innerHTML = `
    ${showSteps && isHost && !isDisplay ? stepsBarHtml(3, 3) : ""}
    <div class="wz-nav wz-nav-static">
      <b class="wz-title">${isDisplay ? "Присоединяйтесь" : isHost ? "Зовите друзей" : "Комната"}</b>
      ${showSteps && isHost && !isDisplay ? '<span class="wz-count">шаг 3 из 3</span>' : ""}
    </div>
    <div class="wz-invite">
      <img class="wz-qr" src="${qrUrl}" alt="QR-код для входа в комнату" />
      <div class="wz-code-label">Код комнаты</div>
      <div class="wz-code">${escapeHtml(code)}</div>
      ${isDisplay ? `<p class="wz-note">Отсканируйте QR или откройте ${escapeHtml(shareUrl)}</p>` : ""}
    </div>
  `;
  wrap.appendChild(root);

  if (!isDisplay) {
    const text = `Играем в «${gameTitle}», код комнаты ${code}.`;
    const links = shareLinks(shareUrl, text);
    const share = document.createElement("div");
    share.className = "wz-share";
    share.innerHTML = `
      <a class="wz-share-btn" href="${links.telegram}" target="_blank" rel="noopener"><span aria-hidden="true">✈️</span>Telegram</a>
      <a class="wz-share-btn" href="${links.whatsapp}" target="_blank" rel="noopener"><span aria-hidden="true">💬</span>WhatsApp</a>
      <button type="button" class="wz-share-btn"><span aria-hidden="true">🔗</span><b>Ссылка</b></button>
    `;
    const copyBtn = share.querySelector("button");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
      copyBtn.querySelector("b").textContent = "Скопировано";
      setTimeout(() => (copyBtn.querySelector("b").textContent = "Ссылка"), 1500);
    });
    root.appendChild(share);
  }

  // who is here, and how many more are needed
  const progress = document.createElement("div");
  progress.className = "wz-progress";
  // The bar fills up to the minimum; there is no upper limit, so past it the
  // bar stays full and the text says the game can start.
  const enough = players.length >= needed;
  const pct = Math.min(100, Math.round((players.length / needed) * 100));
  progress.className = "wz-progress" + (enough ? " ready" : "");
  progress.innerHTML = `
    <div class="wz-bar"><i style="width:${pct}%"></i></div>
    <small>${
      enough
        ? `<b>Можно начинать.</b> Игроков: ${players.length}. Присоединиться могут и другие`
        : `Игроков: ${players.length}. Для старта нужно минимум ${needed}`
    }</small>
  `;
  root.appendChild(progress);

  const seats = document.createElement("div");
  seats.className = "wz-seats";
  players.forEach((p) => {
    const seat = document.createElement("div");
    seat.className = "wz-seat" + (p.online ? "" : " offline");
    const isMe = p.id === state.me.id;
    const tag = isMe ? (p.isHost ? "вы · хост" : "вы") : p.isHost ? "хост" : "";
    seat.innerHTML = `
      <span class="wz-seat-avatar">${avatarHtml(p)}</span>
      <span class="wz-seat-who"><span class="wz-seat-name">${escapeHtml(p.name)}</span>${
        p.online ? "" : '<small class="wz-seat-offline">не в сети</small>'
      }</span>
      <span class="players-dot ${p.online ? "on" : ""}" title="${p.online ? "в сети" : "не в сети"}"></span>
      ${tag ? `<span class="wz-seat-tag${isMe ? " me" : ""}">${tag}</span>` : ""}
    `;
    // the host can remove anyone who is not coming (two taps, so it isn't an accident)
    if (isHost && !isDisplay && !p.isHost && !isMe) {
      const kickBtn = document.createElement("button");
      kickBtn.type = "button";
      kickBtn.className = "wz-seat-kick";
      const armed = armedKick.id === p.id && Date.now() < armedKick.until;
      kickBtn.textContent = armed ? "Точно?" : "Убрать";
      kickBtn.classList.toggle("armed", armed);
      kickBtn.addEventListener("click", async () => {
        if (!(armedKick.id === p.id && Date.now() < armedKick.until)) {
          armedKick = { id: p.id, until: Date.now() + 6000 };
          kickBtn.textContent = "Точно?";
          kickBtn.classList.add("armed");
          return;
        }
        kickBtn.disabled = true;
        armedKick = { id: null, until: 0 };
        try {
          await api.kickPlayer(code, token, p.id);
          seat.remove();
        } catch (e) {
          alert(e.message);
          kickBtn.disabled = false;
        }
      });
      seat.appendChild(kickBtn);
    }
    seats.appendChild(seat);
  });
  // one placeholder is enough: more players can always join
  const empty = document.createElement("div");
  empty.className = "wz-seat empty";
  empty.innerHTML = `<span class="wz-seat-avatar">＋</span><span class="wz-seat-name">ждём игрока…</span>`;
  seats.appendChild(empty);
  root.appendChild(seats);

  if (!isDisplay) {
    const testLinks = renderTestLinks(roomPath);
    if (testLinks) root.appendChild(testLinks);
    (notes || []).forEach((text) => {
      const note = document.createElement("p");
      note.className = "wz-note";
      note.textContent = text;
      root.appendChild(note);
    });
    if (isHost) {
      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "wz-cta";
      startBtn.textContent = state.canStart ? "Начать игру" : "Ждём игроков";
      startBtn.disabled = !state.canStart;
      startBtn.addEventListener("click", async () => {
        startBtn.disabled = true;
        try {
          await startGame();
        } catch (e) {
          alert(e.message);
          startBtn.disabled = false;
        }
      });
      root.appendChild(startBtn);
    } else {
      const waitMsg = document.createElement("p");
      waitMsg.className = "wz-note";
      waitMsg.textContent = "Ждём, пока хост начнёт игру…";
      root.appendChild(waitMsg);
    }
  }
}
