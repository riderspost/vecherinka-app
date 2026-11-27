// What only the host sees while a game runs: requests from players who want
// their seat back, and the player list with "remove" buttons.

import { api } from "./api.js";
import { avatarHtml } from "./avatarPicker.js";
import { escapeHtml } from "./utils.js";
import { playersWord } from "./games.js";
import { enableSwipeDown } from "./swipeSheet.js";

// ---- requests to take a seat back ----

let claimsEl = null;
let claimsKey = "";

export function clearClaimRequests() {
  if (claimsEl) claimsEl.remove();
  claimsEl = null;
  claimsKey = "";
}

// Shows a banner for every open request. Drawn only when the set of requests
// changes, so tapping a button isn't interrupted by the next poll.
export function syncClaimRequests({ code, token, claims, afterAnswer }) {
  const key = (claims || []).map((c) => c.id).join(",");
  if (key === claimsKey) return;
  claimsKey = key;
  if (!claims || !claims.length) {
    if (claimsEl) claimsEl.remove();
    claimsEl = null;
    return;
  }
  if (!claimsEl) {
    claimsEl = document.createElement("div");
    claimsEl.className = "host-claims";
    document.body.appendChild(claimsEl);
  }
  claimsEl.innerHTML = "";
  claims.forEach((c) => {
    const card = document.createElement("div");
    card.className = "host-claim";
    card.innerHTML = `
      <span class="host-claim-avatar">${avatarHtml(c)}</span>
      <span class="host-claim-text"><b>${escapeHtml(c.name)}</b> просит вернуться в игру</span>
      <span class="host-claim-actions">
        <button type="button" class="host-claim-yes">Это он</button>
        <button type="button" class="host-claim-no">Нет</button>
      </span>
    `;
    const answer = async (approve) => {
      card.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await api.resolveClaim(code, token, c.id, approve);
      } catch (e) {
        // already handled elsewhere or the player is gone: the next poll clears it
      }
      card.remove();
      if (afterAnswer) afterAnswer();
    };
    card.querySelector(".host-claim-yes").addEventListener("click", () => answer(true));
    card.querySelector(".host-claim-no").addEventListener("click", () => answer(false));
    claimsEl.appendChild(card);
  });
}

// ---- the player list ----

let panelEl = null;
let panelCtx = null;

export function closePlayersPanel() {
  if (panelEl) panelEl.remove();
  panelEl = null;
  panelCtx = null;
}

// getState() returns the latest room state; onChanged() is called after a removal.
export function openPlayersPanel({ code, token, getState, onChanged }) {
  closePlayersPanel();
  panelCtx = { code, token, getState, onChanged, armed: null };
  panelEl = document.createElement("div");
  panelEl.className = "players-panel-bg";
  panelEl.addEventListener("click", (e) => {
    if (e.target === panelEl) closePlayersPanel();
  });
  document.body.appendChild(panelEl);
  drawPanel();
}

export function refreshPlayersPanel() {
  // not while it is being dragged away: redrawing would drop the sheet from under the finger
  if (panelEl && !panelEl.querySelector(".players-panel")?.__dragging) drawPanel();
}

function drawPanel() {
  const { code, token, getState, onChanged } = panelCtx;
  const state = getState();
  const players = state.players.filter((p) => !p.isDisplay);
  const inGame = state.room.status !== "lobby";
  const canRemove = !inGame || players.length - 1 >= state.minPlayers;

  panelEl.innerHTML = "";
  const sheet = document.createElement("div");
  sheet.className = "players-panel";
  sheet.innerHTML = `
    <div class="players-panel-grab sheet-handle"></div>
    <div class="players-panel-head"><b>Игроки · ${players.length}</b><button type="button" class="players-panel-close" aria-label="Закрыть">✕</button></div>
    ${
      canRemove
        ? `<p class="players-panel-note">Исключённый игрок не мешает игре. Его место можно потом не возвращать.</p>`
        : `<p class="players-panel-note">Исключить нельзя: для игры нужно минимум ${playersWord(state.minPlayers)}.</p>`
    }
  `;
  sheet.querySelector(".players-panel-close").addEventListener("click", closePlayersPanel);
  enableSwipeDown(sheet, closePlayersPanel);

  const list = document.createElement("div");
  list.className = "players-panel-list";
  players.forEach((p) => {
    const isMe = p.id === state.me.id;
    const row = document.createElement("div");
    row.className = "players-panel-row";
    row.innerHTML = `
      <span class="players-dot ${p.online ? "on" : ""}" title="${p.online ? "в сети" : "не в сети"}"></span>
      <span class="players-panel-avatar">${avatarHtml(p)}</span>
      <span class="players-panel-name">${escapeHtml(p.name)}<small>${p.isHost ? "хост" : p.online ? "в сети" : "не в сети"}${isMe ? " · это вы" : ""}</small></span>
    `;
    if (!p.isHost && !isMe) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "players-panel-kick";
      const armed = panelCtx.armed === p.id;
      btn.textContent = armed ? "Точно?" : "Исключить";
      btn.disabled = !canRemove;
      btn.classList.toggle("armed", armed);
      btn.addEventListener("click", async () => {
        if (panelCtx.armed !== p.id) {
          panelCtx.armed = p.id;
          drawPanel();
          return;
        }
        btn.disabled = true;
        try {
          await api.kickPlayer(code, token, p.id);
          panelCtx.armed = null;
          if (onChanged) await onChanged();
        } catch (e) {
          panelCtx.armed = null;
          alert(e.message);
        }
        if (panelEl) drawPanel();
      });
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
  sheet.appendChild(list);
  panelEl.appendChild(sheet);
}
