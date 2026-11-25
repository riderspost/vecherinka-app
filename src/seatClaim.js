// For someone whose browser lost the room session: pick yourself from the
// players list, ask for the seat, and wait for the host to say yes.

import { api } from "./api.js";
import { saveSession, getDeviceId } from "./storage.js";
import { avatarHtml } from "./avatarPicker.js";
import { escapeHtml } from "./utils.js";

const POLL_MS = 1500;

export function renderSeatClaim(body, { code, seats: initialSeats, onApproved, onBack }) {
  let seats = initialSeats;
  let timer = null;
  let listTimer = null;
  let stopped = false;
  window.addEventListener(
    "vecherinka:navigate",
    () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (listTimer) clearTimeout(listTimer);
    },
    { once: true }
  );

  function showList(message) {
    stopped = false;
    if (timer) clearTimeout(timer);
    if (listTimer) clearTimeout(listTimer);
    body.innerHTML = "";
    const intro = document.createElement("div");
    intro.className = "wz-intro";
    intro.innerHTML = `<h2>Вы уже играете в этой комнате?</h2><p>Нажмите своё имя: хост подтвердит, что это вы, и вы вернётесь в игру.</p>`;
    body.appendChild(intro);
    if (message) {
      const msg = document.createElement("p");
      msg.className = "error-msg";
      msg.textContent = message;
      body.appendChild(msg);
    }

    const list = document.createElement("div");
    list.className = "wz-seats wz-seat-picker";
    body.appendChild(list);
    drawSeats(list);
    refreshSeats(list);

    if (!seats.length) {
      const empty = document.createElement("p");
      empty.className = "wz-note";
      empty.textContent = "В комнате сейчас нет игроков.";
      body.appendChild(empty);
    }

    const back = document.createElement("button");
    back.type = "button";
    back.className = "wz-link";
    back.textContent = "← На главную";
    back.addEventListener("click", onBack);
    body.appendChild(back);
  }

  // Only someone who is offline can be taken back: a player who is still
  // connected has their seat already.
  function drawSeats(list) {
    list.innerHTML = "";
    seats.forEach((seat) => {
      const free = !seat.online && !seat.isHost;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wz-seat wz-seat-btn" + (free ? "" : " locked");
      btn.disabled = !free;
      const why = seat.isHost ? "хост" : seat.online ? "в сети" : "это я";
      btn.innerHTML = `<span class="wz-seat-avatar">${avatarHtml(seat)}</span><span class="wz-seat-name">${escapeHtml(seat.name)}</span><span class="wz-seat-tag">${why}</span>`;
      if (free) btn.addEventListener("click", () => ask(seat));
      list.appendChild(btn);
    });
    if (seats.length && seats.every((s) => s.online || s.isHost)) {
      const hint = document.createElement("p");
      hint.className = "wz-note";
      hint.textContent = "Все игроки сейчас в сети. Если вы потеряли вход, подождите минуту: ваше место станет доступно.";
      list.appendChild(hint);
    }
  }

  // The list is live: a player who just dropped out becomes available.
  function refreshSeats(list) {
    async function tick() {
      if (stopped || !list.isConnected) return;
      try {
        seats = (await api.getSeats(code)).seats;
        if (list.isConnected && !stopped) drawSeats(list);
      } catch (e) {
        // keep what we have
      }
      if (!stopped && list.isConnected) listTimer = setTimeout(tick, 3000);
    }
    listTimer = setTimeout(tick, 3000);
  }

  async function ask(seat) {
    body.innerHTML = `
      <div class="wz-waiting">
        <div class="wz-waiting-avatar">${avatarHtml(seat)}</div>
        <h2>Ждём подтверждения</h2>
        <p>Хост видит запрос «${escapeHtml(seat.name)}» и должен нажать «Это он». Попросите его подтвердить.</p>
        <div class="spinner"></div>
      </div>
    `;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "wz-link";
    cancel.textContent = "Отменить";
    cancel.addEventListener("click", () => showList());
    body.appendChild(cancel);

    let claim;
    try {
      claim = await api.createClaim(code, seat.id, getDeviceId());
    } catch (e) {
      showList(e.message);
      return;
    }

    async function poll() {
      if (stopped) return;
      try {
        const res = await api.getClaim(code, claim.claimId, claim.secret);
        if (res.status === "approved") {
          saveSession(code, { token: res.token, playerId: res.playerId });
          onApproved(res.token);
          return;
        }
        if (res.status === "denied") {
          showList("Хост отклонил запрос. Если это вы, попробуйте ещё раз.");
          return;
        }
      } catch (e) {
        if (e.status === 404) {
          showList("Запрос не найден. Попробуйте ещё раз.");
          return;
        }
        // a dropped connection: just try again
      }
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
  }

  showList();
}
