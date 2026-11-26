import { api } from "../../api.js";
import { navigate } from "../../router.js";
import { GAMES, gameById, playersWord, roomStatus } from "../../games.js";
import { saveSession, clearSession } from "../../storage.js";
import { escapeHtml } from "../../utils.js";

function gate(emoji, title, text, withLogin) {
  const el = document.createElement("div");
  el.className = "hub-gate";
  el.innerHTML = `<span class="hub-gate-emoji" aria-hidden="true">${emoji}</span><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p>`;
  if (withLogin) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hub-login-btn";
    btn.textContent = "Войти";
    btn.addEventListener("click", () => navigate("/account"));
    el.appendChild(btn);
  }
  return el;
}

function roomCard(room, onClosed) {
  const game = gameById(room.gameType);
  const status = roomStatus(room.status);
  const card = document.createElement("div");
  card.className = "hub-room";
  card.innerHTML = `
    <div class="hub-room-head">
      <span class="hub-room-emoji">${game.emoji}</span>
      <span class="hub-room-text">
        <b>${escapeHtml(game.title)}</b>
        <small>${status.live ? '<i class="hub-live"></i>' : ""}${escapeHtml(status.text)}</small>
      </span>
      <span class="hub-room-code">${escapeHtml(room.code)}</span>
    </div>
    <div class="hub-room-actions"></div>
    <div class="error-msg hub-room-error"></div>
  `;
  const actions = card.querySelector(".hub-room-actions");
  const errorEl = card.querySelector(".hub-room-error");

  const enter = document.createElement("button");
  enter.type = "button";
  enter.className = "hub-btn primary";
  enter.textContent = "Вернуться";
  enter.addEventListener("click", async () => {
    enter.disabled = true;
    errorEl.textContent = "";
    try {
      const res = await api.resumeRoom(room.code);
      saveSession(room.code, { token: res.token, playerId: res.playerId });
      navigate(game.roomPath(room.code));
    } catch (e) {
      errorEl.textContent = e.message;
      enter.disabled = false;
    }
  });
  actions.appendChild(enter);

  // Only the host can end a room for everyone (the server enforces it too).
  if (room.isHost) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "hub-btn ghost";
    close.textContent = "Закрыть";
    let armed = false;
    close.addEventListener("click", async () => {
      if (!armed) {
        // two taps: closing deletes the room for every player
        armed = true;
        close.textContent = "Точно закрыть?";
        close.classList.add("danger");
        setTimeout(() => {
          if (!close.disabled) {
            armed = false;
            close.textContent = "Закрыть";
            close.classList.remove("danger");
          }
        }, 4000);
        return;
      }
      close.disabled = true;
      enter.disabled = true;
      errorEl.textContent = "";
      try {
        const res = await api.resumeRoom(room.code);
        await api.discardRoom(room.code, res.token);
        clearSession(room.code);
        onClosed(room);
      } catch (e) {
        errorEl.textContent = e.message;
        close.disabled = false;
        enter.disabled = false;
      }
    });
    actions.appendChild(close);
  }

  const meta = document.createElement("span");
  meta.className = "hub-room-meta";
  meta.textContent = `${playersWord(room.playerCount)}${room.isHost ? " · вы хост" : ""}`;
  actions.appendChild(meta);
  return card;
}

// Joining by code is open to everyone, signed in or not. The code belongs to
// one game, and every game's room page already knows how to ask a newcomer
// for a name and an avatar, so this only finds the game and hands over.
function joinByCodeForm() {
  const form = document.createElement("form");
  form.className = "hub-join";
  form.innerHTML = `
    <label class="hub-join-label" for="hub-join-code">Есть код комнаты?</label>
    <div class="hub-join-row">
      <input id="hub-join-code" class="hub-join-input" inputmode="text" autocomplete="off" autocapitalize="characters"
             spellcheck="false" maxlength="5" placeholder="КОД" />
      <button type="submit" class="hub-join-btn">Присоединиться</button>
    </div>
    <div class="error-msg hub-join-error"></div>
  `;
  const input = form.querySelector("input");
  const button = form.querySelector("button");
  const errorEl = form.querySelector(".hub-join-error");

  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    errorEl.textContent = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (code.length !== 5) {
      errorEl.textContent = "Код состоит из 5 символов";
      return;
    }
    button.disabled = true;
    errorEl.textContent = "";
    try {
      const info = await api.getTakenEmojis(code);
      const game = GAMES.find((g) => g.id === info.gameType);
      if (!game) throw new Error("Не удалось определить игру по этому коду");
      if (info.status === "finished" || info.status === "final_results") throw new Error("Эта игра уже завершена");
      if (info.deviceMode === "local") {
        throw new Error("Эта комната только для локальных игроков — попросите организатора добавить вас");
      }
      navigate(game.roomPath(code));
    } catch (err) {
      errorEl.textContent = err.message;
      button.disabled = false;
    }
  });
  return form;
}

export function renderRoomsTab(shell) {
  const { body } = shell;
  const title = document.createElement("div");
  title.className = "hub-title";
  title.innerHTML = `
    <h2 class="hub-h">Комнаты</h2>
    <p class="hub-desc">Войдите в игру друга по коду или вернитесь в свои открытые комнаты. Свою комнату можно закрыть.</p>
  `;
  body.appendChild(title);
  body.appendChild(joinByCodeForm());

  const h = document.createElement("h2");
  h.className = "hub-h";
  h.textContent = "Открытые комнаты";
  body.appendChild(h);

  const list = document.createElement("div");
  list.className = "hub-section";
  body.appendChild(list);

  shell.sessionPromise.then(async (session) => {
    if (!session.authenticated) {
      list.appendChild(gate("🔑", "Ваши комнаты", "Войдите, и открытые комнаты будут ждать вас на любом устройстве.", true));
      return;
    }
    let rooms = await shell.roomsPromise;

    function draw() {
      list.innerHTML = "";
      shell.setRoomCount(rooms.length);
      if (!rooms.length) {
        list.appendChild(gate("🛋️", "Открытых комнат нет", "Создайте игру, и она появится здесь.", false));
        return;
      }
      rooms.forEach((room) =>
        list.appendChild(
          roomCard(room, (closed) => {
            rooms = rooms.filter((r) => r.code !== closed.code);
            draw();
          })
        )
      );
    }
    draw();
  });
}
