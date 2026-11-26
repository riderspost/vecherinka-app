import { api, authApi } from "../api.js";
import { loadSession, saveSession, clearSession, getDeviceId } from "../storage.js";
import { navigate } from "../router.js";
import { createAvatarPicker, avatarHtml, parseAvatarValue } from "../avatarPicker.js";
import { escapeHtml } from "../utils.js";
import { mountWizardFrame } from "../wizard.js";
import { pickTestPlayer, testJoinMode } from "../devTools.js";
import { renderSeatClaim } from "../seatClaim.js";
import { renderLobbyView } from "../lobby.js";
import {
  clearClaimRequests,
  closePlayersPanel,
  openPlayersPanel,
  refreshPlayersPanel,
  syncClaimRequests,
} from "../hostTools.js";

const POLL_MS = 1500;

// Shared by the persistent "Выйти из комнаты" button and the final-results
// screen's "На главную". Anonymous play has no account to resume a room
// from, so for the host specifically, leaving really does mean losing it
// for good — hence the confirmation, and the room is discarded right then
// since there's no other way back into it anyway. A logged-in host's room
// stays — that's the whole point of being able to resume it later via
// "Вернуться в комнату" — so no prompt and no discard call for them.
// Returns whether the user actually left (so a caller can re-enable its
// button on cancel).
async function leaveRoom(state, token, code) {
  let authenticated = false;
  try {
    authenticated = Boolean((await authApi.session()).authenticated);
  } catch (e) {
    authenticated = false;
  }
  if (!authenticated) {
    const ok = confirm(
      "Если вы выйдете, комната будет потеряна — сохранить её можно только под аккаунтом. Выйти?"
    );
    if (!ok) return false;
    if (state.me.isHost) {
      try {
        await api.discardRoom(code, token);
      } catch (e) {
        // best-effort cleanup — still leave even if this fails
      }
    }
  }
  clearSession(code);
  navigate("/");
  return true;
}

export function mountRoomPage(container, code, opts) {
  const asDisplay = Boolean(opts && opts.asDisplay);
  let pollTimer = null;
  let lastAnsweringKey = null;
  let stopped = false;
  let menuOpen = false;
  let closeArmedUntil = 0; // "close the room for everyone" needs a second tap
  let lastState = null;
  let lastView = null; // { state, token } of the latest render, for redrawing the top bar

  // A tap anywhere outside the open menu closes it.
  function closeMenuOnOutsideTap(e) {
    if (!menuOpen) return;
    if (e.target.closest(".pl-menu") || e.target.closest(".pl-menu-btn")) return;
    menuOpen = false;
    const host = document.querySelector(".pl-top-host");
    if (host && lastView) drawTopBar(host);
  }
  document.addEventListener("click", closeMenuOnOutsideTap);

  function stop() {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    document.removeEventListener("click", closeMenuOnOutsideTap);
    clearClaimRequests();
    closePlayersPanel();
  }
  window.addEventListener("vecherinka:navigate", stop, { once: true });

  const session = loadSession(code);
  if (session) {
    startPolling(session.token);
  } else if (asDisplay) {
    joinAsDisplay();
  } else if (testJoinMode() === "auto") {
    joinAsTestPlayer();
  } else {
    renderJoinForm();
  }

  // ?test=auto: a throwaway player for trying the game alone (see devTools.js).
  async function joinAsTestPlayer() {
    container.innerHTML = `<div class="screen center-screen"><p>Заходим тестовым игроком...</p></div>`;
    try {
      const info = await api.getTakenEmojis(code);
      const me = pickTestPlayer(info.taken);
      const res = await api.joinRoom(code, { ...me, deviceId: getDeviceId() });
      saveSession(code, { token: res.token, playerId: res.playerId });
      startPolling(res.token);
    } catch (e) {
      renderJoinForm();
    }
  }

  async function joinAsDisplay() {
    container.innerHTML = `<div class="screen center-screen"><p>Подключаем экран...</p></div>`;
    try {
      const res = await api.joinRoom(code, { name: "Экран", isDisplay: true });
      saveSession(code, { token: res.token, playerId: res.playerId });
      startPolling(res.token);
    } catch (e) {
      container.innerHTML = `<div class="screen center-screen"><p class="error-msg">${e.message}</p></div>`;
    }
  }

  async function renderJoinForm() {
    const body = mountWizardFrame(container, {
      current: 1,
      total: 0,
      title: `Комната ${code}`,
      onBack: () => navigate("/"),
    });
    const form = document.createElement("div");
    form.className = "wz-form";
    body.appendChild(form);

    let takenEmojis = [];
    let roomStatus = "lobby";
    try {
      const res = await api.getTakenEmojis(code);
      takenEmojis = res.taken || [];
      roomStatus = res.status;
    } catch (e) {
      takenEmojis = [];
    }

    // The game is already on: new players can't join, but someone who lost
    // their session can ask the host for their old seat back.
    if (roomStatus !== "lobby") {
      body.innerHTML = "";
      if (roomStatus === "final_results" || roomStatus === "finished") {
        const done = document.createElement("p");
        done.className = "wz-note";
        done.textContent = "Эта игра уже завершена.";
        body.appendChild(done);
        return;
      }
      let seats = [];
      try {
        seats = (await api.getSeats(code)).seats;
      } catch (e) {
        // fall through with an empty list
      }
      renderSeatClaim(body, {
        code,
        seats,
        onApproved: (token) => startPolling(token),
        onBack: () => navigate("/"),
      });
      return;
    }

    let profile = null;
    try {
      const session = await authApi.session();
      if (session.authenticated && session.profileComplete) profile = session;
    } catch (e) {
      // guest — a blank form
    }

    const nameLabel = document.createElement("label");
    nameLabel.className = "wz-field";
    nameLabel.innerHTML = `<span>Как вас зовут?</span>`;
    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 20;
    nameInput.autocomplete = "nickname";
    if (profile) nameInput.value = profile.name;
    nameLabel.appendChild(nameInput);

    const avatarField = document.createElement("div");
    avatarField.className = "wz-field";
    avatarField.innerHTML = `<span>Аватар</span>`;
    const initial =
      profile && !takenEmojis.includes(parseAvatarValue(profile.avatarValue).emoji)
        ? { avatarType: profile.avatarType, avatarValue: profile.avatarValue }
        : null;
    const picker = createAvatarPicker(initial, takenEmojis);
    avatarField.appendChild(picker.element);

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wz-cta";
    btn.textContent = "Присоединиться";
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
        const res = await api.joinRoom(code, { name, ...avatar, deviceId: getDeviceId() });
        saveSession(code, { token: res.token, playerId: res.playerId });
        startPolling(res.token);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    form.appendChild(nameLabel);
    form.appendChild(avatarField);
    form.appendChild(errorEl);
    form.appendChild(btn);
  }

  function startPolling(token) {
    async function tick() {
      if (stopped) return;
      try {
        const state = await api.getState(code, token);
        lastState = state;
        if (state.me.isHost) {
          syncClaimRequests({ code, token, claims: state.pendingClaims });
          refreshPlayersPanel();
        }
        render(state, token);
      } catch (e) {
        // Only a definitive "you're not in this room" response from the
        // server ends the session here — a dropped connection or a
        // momentary server hiccup throws too, but with no e.status (fetch
        // never got a response), and should just retry next tick instead
        // of wiping a perfectly fine session.
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          clearSession(code);
          container.innerHTML = `<div class="screen center-screen"><p class="error-msg">${e.message}</p><button class="btn" id="back-home">На главную</button></div>`;
          const backBtn = document.getElementById("back-home");
          if (backBtn) backBtn.addEventListener("click", () => navigate("/"));
          return;
        }
      }
      if (!stopped) pollTimer = setTimeout(tick, POLL_MS);
    }
    tick();
  }

  // Who I am, plus a menu with the rarely needed actions (the TV screen link
  // and leaving). It lives in its own host so opening the menu redraws only
  // this bar, not the screen below it (which may hold a half-typed answer).
  function drawTopBar(host) {
    const { state, token } = lastView;
    host.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "pl-top";

    const me = document.createElement("div");
    me.className = "pl-me";
    me.innerHTML = `<span class="pl-me-avatar">${avatarHtml(state.me)}</span><span class="pl-me-name">${escapeHtml(state.me.name)}</span>`;
    bar.appendChild(me);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pl-menu-btn";
    toggle.setAttribute("aria-label", "Меню комнаты");
    toggle.setAttribute("aria-expanded", String(menuOpen));
    toggle.textContent = "⚙️";
    toggle.addEventListener("click", () => {
      menuOpen = !menuOpen;
      drawTopBar(host);
    });
    bar.appendChild(toggle);
    host.appendChild(bar);

    if (!menuOpen) return;
    const menu = document.createElement("div");
    menu.className = "pl-menu";

    const displayUrl = `${window.location.origin}/r/${code}/display`;
    const tvBtn = document.createElement("button");
    tvBtn.type = "button";
    tvBtn.textContent = "📺 Скопировать ссылку для ТВ-экрана";
    tvBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(displayUrl).catch(() => {});
      tvBtn.textContent = "✅ Ссылка скопирована";
      setTimeout(() => {
        menuOpen = false;
        drawTopBar(host);
      }, 900);
    });

    // Closing the tab already abandoned a room just fine; this makes leaving
    // an explicit, intentional action instead of giving up silently.
    const leaveBtn = document.createElement("button");
    leaveBtn.type = "button";
    leaveBtn.className = "danger";
    leaveBtn.textContent = "🚪 Выйти из комнаты";
    leaveBtn.addEventListener("click", async () => {
      leaveBtn.disabled = true;
      const left = await leaveRoom(state, token, code);
      if (!left) leaveBtn.disabled = false;
    });

    // In the lobby the player list on the screen already does this.
    if (state.me.isHost && state.room.status !== "lobby") {
      const playersBtn = document.createElement("button");
      playersBtn.type = "button";
      playersBtn.textContent = "👥 Игроки";
      playersBtn.addEventListener("click", () => {
        menuOpen = false;
        drawTopBar(host);
        openPlayersPanel({
          code,
          token,
          getState: () => lastState,
          onChanged: async () => {
            lastState = await api.getState(code, token);
            render(lastState, token);
          },
        });
      });
      menu.appendChild(playersBtn);
    }
    menu.appendChild(tvBtn);
    menu.appendChild(leaveBtn);
    // the most drastic action goes last
    if (state.me.isHost) menu.appendChild(closeRoomButton(host, state, token));
    host.appendChild(menu);
  }

  // The host can end the room for everybody, from inside the game.
  function closeRoomButton(host, state, token) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "danger";
    const armed = Date.now() < closeArmedUntil;
    btn.textContent = armed ? "⚠️ Точно закрыть для всех?" : "🗑 Закрыть комнату";
    btn.addEventListener("click", async () => {
      if (Date.now() >= closeArmedUntil) {
        closeArmedUntil = Date.now() + 6000;
        drawTopBar(host);
        return;
      }
      btn.disabled = true;
      try {
        await api.discardRoom(code, token);
        clearSession(code);
        navigate("/");
      } catch (e) {
        closeArmedUntil = 0;
        alert(e.message);
        btn.disabled = false;
      }
    });
    return btn;
  }

  function render(state, token) {
    const status = state.room.status;

    if (status === "answering" && !state.me.isDisplay && state.answering && !state.answering.waiting) {
      const key = "answering:" + state.answering.currentPrompt.id;
      if (key === lastAnsweringKey) return;
      lastAnsweringKey = key;
    } else {
      lastAnsweringKey = null;
    }

    container.innerHTML = "";
    const page = document.createElement("div");
    page.className = "room-page" + (state.me.isDisplay ? " display-page" : " pl-room");
    lastView = { state, token };

    if (!state.me.isDisplay) {
      const barHost = document.createElement("div");
      barHost.className = "pl-top-host";
      page.appendChild(barHost);
      drawTopBar(barHost);
    } else {
      page.appendChild(renderDisplayHeader(state, code));
    }

    const wrap = document.createElement("div");
    wrap.className = "screen room-screen" + (state.me.isDisplay ? " display-mode" : "");
    page.appendChild(wrap);
    container.appendChild(page);

    if (status === "lobby") renderLobby(wrap, state, token, code);
    else if (status === "answering") renderAnswering(wrap, state, token, code);
    else if (status === "voting") renderVoting(wrap, state, token, code);
    else if (status === "voting_results") renderVotingResults(wrap, state, token, code);
    else if (status === "round_results") renderRoundResults(wrap, state, token, code);
    else if (status === "overall_results") renderOverallResults(wrap, state, token, code);
    else if (status === "final_results") renderFinalResults(wrap, state, token, code);
  }
}

function renderDisplayHeader(state, code) {
  const header = document.createElement("div");
  header.className = "display-header";

  const title = document.createElement("div");
  title.className = "display-header-title";
  title.textContent = `Комната ${code}`;
  header.appendChild(title);

  const scores = state.players
    .filter((p) => !p.isDisplay)
    .slice()
    .sort((a, b) => b.totalScore - a.totalScore);

  const strip = document.createElement("div");
  strip.className = "display-leaderboard";
  withRanks(scores).forEach(({ player: p, rank }) => {
    const medal = RANK_MEDALS[rank];
    const chip = document.createElement("div");
    chip.className = "display-score-chip" + (medal ? " display-score-top" : "");
    chip.innerHTML = `<span class="display-rank">${medal || rank}</span>${avatarHtml(p)}<span>${escapeHtml(
      p.name
    )}</span><span class="display-points">${p.totalScore.toFixed(2)}</span>`;
    strip.appendChild(chip);
  });
  header.appendChild(strip);

  return header;
}

function playersList(players) {
  const list = document.createElement("div");
  list.className = "player-list";
  players
    .filter((p) => !p.isDisplay)
    .forEach((p) => {
      const item = document.createElement("div");
      item.className = "player-chip";
      item.innerHTML = `${avatarHtml(p)}<span>${escapeHtml(p.name)}</span>${
        p.isHost ? '<span class="host-badge">хост</span>' : ""
      }`;
      list.appendChild(item);
    });
  return list;
}

function renderLobby(wrap, state, token, code) {
  renderLobbyView(wrap, state, token, code, {
    roomPath: `/r/${code}`,
    gameTitle: "Продолжи предложение",
    showSteps: true,
    startGame: () => api.startGame(code, token),
  });
}

// "Раунд 2 из 5", a row of dots for the rounds, and what part of the round this is.
function roundHeaderHtml(state, partLabel) {
  const total = state.room.totalRounds;
  const current = state.room.currentRound;
  let dots = "";
  for (let i = 1; i <= total; i++) dots += `<i class="${i < current ? "done" : i === current ? "now" : ""}"></i>`;
  return `
    <div class="pl-round">
      <div class="pl-round-row"><b>Раунд ${current} из ${total}</b><span>${escapeHtml(partLabel)}</span></div>
      <div class="pl-round-dots">${dots}</div>
    </div>
  `;
}

function renderAnswering(wrap, state, token, code) {
  const a = state.answering;
  if (state.me.isDisplay) {
    wrap.innerHTML = `
      <h2>Раунд ${state.room.currentRound} из ${state.room.totalRounds}</h2>
      <p class="tagline">Игроки придумывают продолжения фраз...</p>
      <div class="big-progress">${a.answered} / ${a.total}</div>
    `;
    const list = document.createElement("div");
    list.className = "player-progress-list";
    a.players
      .slice()
      .sort((x, y) => x.total - x.answered - (y.total - y.answered))
      .forEach((p) => {
        const done = p.answered >= p.total;
        const row = document.createElement("div");
        row.className = "player-progress-row" + (done ? " player-progress-done" : "");
        row.innerHTML = `${avatarHtml(p)}<span>${escapeHtml(p.name)}</span><span class="progress-count">${
          done ? "✅ готово" : `осталось ${p.total - p.answered}`
        }</span>`;
        list.appendChild(row);
      });
    wrap.appendChild(list);
    return;
  }
  if (a.waiting) {
    wrap.innerHTML = `
      <h2>Готово!</h2>
      <p class="tagline">Ждём остальных игроков (${a.answeredCount}/${a.totalCount})...</p>
      <div class="spinner"></div>
    `;
    return;
  }
  wrap.innerHTML = `
    ${roundHeaderHtml(state, `Фраза ${a.answeredCount + 1} из ${a.totalCount}`)}
    <h2 class="prompt-text">${escapeHtml(a.currentPrompt.text)}</h2>
  `;
  const textarea = document.createElement("textarea");
  textarea.className = "answer-input";
  textarea.maxLength = 300;
  textarea.placeholder = "Ваше продолжение...";
  const btn = document.createElement("button");
  btn.className = "wz-cta";
  btn.textContent = "Ответить";
  const errorEl = document.createElement("div");
  errorEl.className = "error-msg";

  async function submit() {
    const text = textarea.value.trim();
    if (!text) {
      errorEl.textContent = "Введите продолжение фразы";
      return;
    }
    btn.disabled = true;
    textarea.disabled = true;
    try {
      await api.submitAnswer(code, token, a.currentPrompt.id, text);
    } catch (e) {
      errorEl.textContent = e.message;
      btn.disabled = false;
      textarea.disabled = false;
    }
  }
  btn.addEventListener("click", submit);
  textarea.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) submit();
  });

  wrap.appendChild(textarea);
  wrap.appendChild(errorEl);
  wrap.appendChild(btn);
  textarea.focus();
}

function renderVoting(wrap, state, token, code) {
  const v = state.voting;
  if (!v) {
    wrap.innerHTML = `<p class="tagline">Голосование завершается...</p>`;
    return;
  }
  wrap.innerHTML = `
    ${roundHeaderHtml(state, `Голосование ${v.index} из ${v.total}`)}
    <h2 class="prompt-text">${escapeHtml(v.promptText)}</h2>
  `;

  if (state.me.isDisplay) {
    wrap.appendChild(optionsWithCounts(v.submissions));
    return;
  }

  if (!v.iCanVote) {
    const msg = document.createElement("p");
    msg.className = "tagline";
    msg.textContent = "Это ваша фраза — просто наблюдайте, как голосуют остальные.";
    wrap.appendChild(msg);
    wrap.appendChild(optionsWithCounts(v.submissions));
    return;
  }

  if (v.alreadyVoted) {
    const msg = document.createElement("p");
    msg.className = "tagline";
    msg.textContent = "Голос учтён! Ждём остальных...";
    wrap.appendChild(msg);
    wrap.appendChild(optionsWithCounts(v.submissions));
    return;
  }

  const list = document.createElement("div");
  list.className = "options-list";
  v.submissions.forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "option-card option-btn";
    btn.textContent = s.text;
    btn.addEventListener("click", async () => {
      list.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await api.vote(code, token, s.id);
      } catch (e) {
        alert(e.message);
        list.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    });
    list.appendChild(btn);
  });
  wrap.appendChild(list);
}

function optionsWithCounts(submissions) {
  const list = document.createElement("div");
  list.className = "options-list display-only";
  submissions
    .slice()
    .sort((a, b) => b.votesCount - a.votesCount)
    .forEach((s) => {
      const item = document.createElement("div");
      item.className = "option-card option-with-count";
      item.innerHTML = `<span>${escapeHtml(s.text)}</span><span class="vote-count">🗳 ${s.votesCount}</span>`;
      list.appendChild(item);
    });
  return list;
}

function renderHostNextButton(wrap, state, token, code, label) {
  if (state.me.isDisplay) return;
  if (state.me.isHost) {
    const btn = document.createElement("button");
    btn.className = "wz-cta";
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api.next(code, token);
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    });
    wrap.appendChild(btn);
  } else {
    const msg = document.createElement("p");
    msg.className = "tagline";
    msg.textContent = "Ждём, пока хост продолжит игру...";
    wrap.appendChild(msg);
  }
}

function renderVotingResults(wrap, state, token, code) {
  const v = state.votingResults;
  if (!v) {
    wrap.innerHTML = `<p class="tagline">Считаем баллы...</p>`;
    return;
  }
  wrap.innerHTML = `
    ${roundHeaderHtml(state, `Результаты ${v.index} из ${v.total}`)}
    <h2 class="prompt-text">${escapeHtml(v.promptText)}</h2>
  `;
  const list = document.createElement("div");
  list.className = "score-list";
  v.submissions.forEach((s) => {
    const row = document.createElement("div");
    row.className = "score-row";
    row.innerHTML = `<span>${escapeHtml(s.text)}</span><span class="score-points">${s.points.toFixed(2)}</span>`;
    list.appendChild(row);
  });
  wrap.appendChild(list);

  renderHostNextButton(
    wrap,
    state,
    token,
    code,
    v.index >= v.total ? "К итогам раунда" : "Следующая фраза"
  );
}

function renderRoundResults(wrap, state, token, code) {
  const r = state.roundResults;
  wrap.innerHTML = `<h2>Итоги раунда ${r.roundNumber}</h2>`;

  const roundList = document.createElement("div");
  roundList.className = "score-list";
  r.roundScores
    .slice()
    .sort((a, b) => b.points - a.points)
    .forEach((s) => {
      const row = document.createElement("div");
      row.className = "score-row";
      row.innerHTML = `${avatarHtml(s)}<span>${escapeHtml(s.name)}</span><span class="score-points">+${s.points.toFixed(2)}</span>`;
      roundList.appendChild(row);
    });
  wrap.appendChild(roundList);

  renderHostNextButton(wrap, state, token, code, "Общий рейтинг");
}

function renderOverallResults(wrap, state, token, code) {
  const r = state.overallResults;
  wrap.innerHTML = `<h2>Общий рейтинг после раунда ${r.roundNumber}</h2>`;
  wrap.appendChild(leaderboardEl(r.leaderboard));

  const isLastRound = r.roundNumber >= state.room.totalRounds;
  renderHostNextButton(wrap, state, token, code, isLastRound ? "Показать победителя" : "Следующий раунд");
}

function renderFinalResults(wrap, state, token, code) {
  const r = state.finalResults;
  const winner = r.leaderboard[0];
  wrap.innerHTML = `<h1 class="logo">🏆 Игра окончена!</h1>`;
  if (winner) {
    const win = document.createElement("div");
    win.className = "winner-banner";
    win.innerHTML = `${avatarHtml(winner)}<div>Победитель: <b>${escapeHtml(winner.name)}</b></div>`;
    wrap.appendChild(win);
  }
  wrap.appendChild(leaderboardEl(r.leaderboard));

  if (!state.me.isDisplay) {
    const homeBtn = document.createElement("button");
    homeBtn.className = "wz-cta";
    homeBtn.textContent = "На главную";
    homeBtn.addEventListener("click", async () => {
      homeBtn.disabled = true;
      const left = await leaveRoom(state, token, code);
      if (!left) homeBtn.disabled = false;
    });
    wrap.appendChild(homeBtn);
  }
}

const RANK_MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

function withRanks(sortedPlayers) {
  let rank = 0;
  let prevScore = null;
  return sortedPlayers.map((p, idx) => {
    if (prevScore === null || p.totalScore !== prevScore) {
      rank = idx + 1;
      prevScore = p.totalScore;
    }
    return { player: p, rank };
  });
}

function leaderboardEl(leaderboard) {
  const list = document.createElement("div");
  list.className = "score-list";
  withRanks(leaderboard).forEach(({ player: p, rank }) => {
    const medal = RANK_MEDALS[rank];
    const row = document.createElement("div");
    row.className = "score-row" + (medal ? ` score-row-top rank-${rank}` : "");
    row.innerHTML = `<span class="rank">${medal || rank}</span>${avatarHtml(p)}<span>${escapeHtml(
      p.name
    )}</span><span class="score-points">${p.totalScore.toFixed(2)}</span>`;
    list.appendChild(row);
  });
  return list;
}
