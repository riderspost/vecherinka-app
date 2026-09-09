import { api } from "../api.js";
import { loadSession, saveSession, clearSession } from "../storage.js";
import { navigate } from "../router.js";
import { createAvatarPicker, avatarHtml } from "../avatarPicker.js";
import { escapeHtml } from "../utils.js";

const POLL_MS = 1500;

export function mountRoomPage(container, code, opts) {
  const asDisplay = Boolean(opts && opts.asDisplay);
  let pollTimer = null;
  let lastAnsweringKey = null;
  let stopped = false;

  function stop() {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
  }
  window.addEventListener("vecherinka:navigate", stop, { once: true });

  const session = loadSession(code);
  if (session) {
    startPolling(session.token);
  } else if (asDisplay) {
    joinAsDisplay();
  } else {
    renderJoinForm();
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
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "screen home-screen";
    wrap.innerHTML = `<h1 class="logo">🎉 Комната ${escapeHtml(code)}</h1><p class="tagline">Введите имя, чтобы присоединиться</p>`;
    container.appendChild(wrap);

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 30;

    let takenEmojis = [];
    try {
      const res = await api.getTakenEmojis(code);
      takenEmojis = res.taken || [];
    } catch (e) {
      takenEmojis = [];
    }
    const picker = createAvatarPicker(null, takenEmojis);

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Присоединиться";

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    btn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.textContent = "Введите имя";
        return;
      }
      btn.disabled = true;
      errorEl.textContent = "";
      try {
        const avatar = picker.getValue();
        const res = await api.joinRoom(code, { name, ...avatar });
        saveSession(code, { token: res.token, playerId: res.playerId });
        startPolling(res.token);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    wrap.appendChild(nameInput);
    wrap.appendChild(picker.element);
    wrap.appendChild(errorEl);
    wrap.appendChild(btn);
  }

  function startPolling(token) {
    async function tick() {
      if (stopped) return;
      try {
        const state = await api.getState(code, token);
        render(state, token);
      } catch (e) {
        clearSession(code);
        container.innerHTML = `<div class="screen center-screen"><p class="error-msg">${e.message}</p><button class="btn" id="back-home">На главную</button></div>`;
        const backBtn = document.getElementById("back-home");
        if (backBtn) backBtn.addEventListener("click", () => navigate("/"));
        return;
      }
      if (!stopped) pollTimer = setTimeout(tick, POLL_MS);
    }
    tick();
  }

  function switchPlayer() {
    if (pollTimer) clearTimeout(pollTimer);
    clearSession(code);
    lastAnsweringKey = null;
    renderJoinForm();
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
    page.className = "room-page" + (state.me.isDisplay ? " display-page" : "");

    if (!state.me.isDisplay) {
      const meBadge = document.createElement("div");
      meBadge.className = "me-badge";
      meBadge.innerHTML = `${avatarHtml(state.me)}<span>${escapeHtml(state.me.name)}</span>`;
      page.appendChild(meBadge);
    } else {
      page.appendChild(renderDisplayHeader(state, code));
    }

    const wrap = document.createElement("div");
    wrap.className = "screen room-screen" + (state.me.isDisplay ? " display-mode" : "");
    page.appendChild(wrap);
    container.appendChild(page);

    if (status === "lobby") renderLobby(wrap, state, token, code, switchPlayer);
    else if (status === "answering") renderAnswering(wrap, state, token, code);
    else if (status === "voting") renderVoting(wrap, state, token, code);
    else if (status === "voting_results") renderVotingResults(wrap, state, token, code);
    else if (status === "round_results") renderRoundResults(wrap, state, token, code);
    else if (status === "overall_results") renderOverallResults(wrap, state, token, code);
    else if (status === "final_results") renderFinalResults(wrap, state);
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

function renderLobby(wrap, state, token, code, switchPlayer) {
  const shareUrl = `${window.location.origin}/r/${code}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`;

  wrap.innerHTML = `
    <h1 class="logo">🎉 Комната ${escapeHtml(code)}</h1>
    ${
      state.me.isDisplay
        ? `<img class="qr-code" src="${qrUrl}" alt="QR код" /><p class="tagline">Отсканируйте, чтобы присоединиться: ${shareUrl}</p>`
        : `<p class="tagline">Позовите друзей: <b>${shareUrl}</b></p>`
    }
    <p class="players-count">Игроков: ${state.players.filter((p) => !p.isDisplay).length} (минимум ${state.minPlayers})</p>
  `;
  wrap.appendChild(playersList(state.players));

  if (!state.me.isDisplay) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn";
    copyBtn.textContent = "Скопировать ссылку";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
      copyBtn.textContent = "Скопировано!";
      setTimeout(() => (copyBtn.textContent = "Скопировать ссылку"), 1500);
    });
    wrap.appendChild(copyBtn);

    const displayUrl = `${window.location.origin}/r/${code}/display`;
    const displayBtn = document.createElement("button");
    displayBtn.className = "btn";
    displayBtn.textContent = "📺 Скопировать ссылку для ТВ-экрана";
    displayBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(displayUrl).catch(() => {});
      displayBtn.textContent = "Скопировано!";
      setTimeout(() => (displayBtn.textContent = "📺 Скопировать ссылку для ТВ-экрана"), 1500);
    });
    wrap.appendChild(displayBtn);

    if (state.me.isHost) {
      const startBtn = document.createElement("button");
      startBtn.className = "btn btn-primary";
      startBtn.textContent = state.canStart ? "Начать игру" : `Нужно ещё игроков (мин. ${state.minPlayers})`;
      startBtn.disabled = !state.canStart;
      startBtn.addEventListener("click", async () => {
        startBtn.disabled = true;
        try {
          await api.startGame(code, token);
        } catch (e) {
          alert(e.message);
          startBtn.disabled = false;
        }
      });
      wrap.appendChild(startBtn);
    } else {
      const waitMsg = document.createElement("p");
      waitMsg.className = "tagline";
      waitMsg.textContent = "Ждём, пока хост начнёт игру...";
      wrap.appendChild(waitMsg);
    }

    const switchBtn = document.createElement("button");
    switchBtn.className = "link-btn";
    switchBtn.textContent = "Это не я — выйти и зайти другим игроком";
    switchBtn.addEventListener("click", () => {
      if (confirm("Выйти из комнаты как " + state.me.name + " и зайти новым игроком?")) {
        switchPlayer();
      }
    });
    wrap.appendChild(switchBtn);
  }
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
    <p class="round-label">Раунд ${state.room.currentRound} из ${state.room.totalRounds} · ${a.answeredCount + 1}/${a.totalCount}</p>
    <h2 class="prompt-text">${escapeHtml(a.currentPrompt.text)}</h2>
  `;
  const textarea = document.createElement("textarea");
  textarea.className = "answer-input";
  textarea.maxLength = 300;
  textarea.placeholder = "Ваше продолжение...";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
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
    <p class="round-label">Раунд ${state.room.currentRound} · Голосование ${v.index}/${v.total}</p>
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
    btn.className = "btn btn-primary";
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
    <p class="round-label">Раунд ${state.room.currentRound} · Результаты ${v.index}/${v.total}</p>
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

function renderFinalResults(wrap, state) {
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
    homeBtn.className = "btn btn-primary";
    homeBtn.textContent = "На главную";
    homeBtn.addEventListener("click", () => navigate("/"));
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
