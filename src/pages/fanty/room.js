import { api, fantyApi } from "../../api.js";
import { loadSession, saveSession, clearSession } from "../../storage.js";
import { navigate } from "../../router.js";
import { createAvatarPicker, avatarHtml } from "../../avatarPicker.js";
import { escapeHtml } from "../../utils.js";
import { openLightbox, shareAllImages } from "../../lightbox.js";
import { GAME_MODES, GENDERS, locationLabel, categoryLabel, pickModeLabel } from "./constants.js";

const POLL_MS = 1500;
const SPIN_ANIMATION_MS = 9000;

const BOTTLE_IMG = `<img src="/src/assets/bottle.png" alt="" class="bottle-img" draggable="false" />`;

function genderRadioGroup(defaultValue) {
  const wrap = document.createElement("div");
  wrap.className = "radio-group";
  GENDERS.forEach((opt) => {
    const label = document.createElement("label");
    label.className = "radio-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "gender";
    input.value = opt.value;
    if (opt.value === defaultValue) input.checked = true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + opt.label));
    wrap.appendChild(label);
  });
  return {
    element: wrap,
    getValue: () => wrap.querySelector("input:checked")?.value,
  };
}

export function mountFantyRoomPage(container, code, opts) {
  const asDisplay = Boolean(opts && opts.asDisplay);
  let pollTimer = null;
  let stopped = false;
  let animating = false;
  let lastBottleAngle = 0;
  let timerIntervalId = null;
  let currentAudio = null;

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
    wrap.innerHTML = `<h1 class="logo">🍾 Комната ${escapeHtml(code)}</h1><p class="tagline">Введите имя, чтобы присоединиться</p>`;
    container.appendChild(wrap);

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 30;

    let takenEmojis = [];
    let requireGender = false;
    try {
      const res = await api.getTakenEmojis(code);
      takenEmojis = res.taken || [];
      requireGender = Boolean(res.requireGender);
    } catch (e) {
      takenEmojis = [];
    }
    const picker = createAvatarPicker(null, takenEmojis);

    const genderLabel = document.createElement("label");
    genderLabel.textContent = "Пол";
    const genderGroup = genderRadioGroup(null);

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
      const gender = requireGender ? genderGroup.getValue() : null;
      if (requireGender && !gender) {
        errorEl.textContent = "Выберите пол";
        return;
      }
      btn.disabled = true;
      errorEl.textContent = "";
      try {
        const avatar = picker.getValue();
        const res = await api.joinRoom(code, { name, ...avatar, gender });
        saveSession(code, { token: res.token, playerId: res.playerId });
        startPolling(res.token);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    wrap.appendChild(nameInput);
    wrap.appendChild(picker.element);
    if (requireGender) {
      wrap.appendChild(genderLabel);
      wrap.appendChild(genderGroup.element);
    }
    wrap.appendChild(errorEl);
    wrap.appendChild(btn);
  }

  function startPolling(token) {
    let lastSignature = null;
    async function tick() {
      if (stopped) return;
      if (!animating) {
        try {
          const state = await fantyApi.getState(code, token);
          const signature = JSON.stringify(state);
          if (signature !== lastSignature) {
            lastSignature = signature;
            render(state, token);
          }
        } catch (e) {
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

    function render(state, token) {
      if (timerIntervalId) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
      }
      if (currentAudio && (!state.fanty || state.fanty.phase !== "awaiting_action")) {
        currentAudio.pause();
        currentAudio = null;
      }
      container.innerHTML = "";
      const page = document.createElement("div");
      page.className = "room-page" + (state.me.isDisplay ? " display-page" : "");

      if (!state.me.isDisplay) {
        const meBadge = document.createElement("div");
        meBadge.className = "me-badge";
        meBadge.innerHTML = `${avatarHtml(state.me)}<span>${escapeHtml(state.me.name)}</span>`;
        page.appendChild(meBadge);
      }

      const wrap = document.createElement("div");
      wrap.className = "screen room-screen" + (state.me.isDisplay ? " display-mode" : "");
      page.appendChild(wrap);
      container.appendChild(page);

      const ctrl = {
        setAnimating: (v) => (animating = v),
        rerender: (s) => render(s, token),
        getLastAngle: () => lastBottleAngle,
        setLastAngle: (a) => (lastBottleAngle = a),
        setTimerInterval: (id) => (timerIntervalId = id),
        setAudio: (a) => (currentAudio = a),
        stopAudio: () => {
          if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
          }
        },
      };

      if (state.room.status === "lobby") renderLobby(wrap, state, token, code, switchPlayer);
      else if (state.room.status === "playing") renderPlaying(wrap, state, token, code, ctrl);
      else if (state.room.status === "finished") renderFinished(wrap, state);
    }

    function switchPlayer() {
      if (pollTimer) clearTimeout(pollTimer);
      clearSession(code);
      renderJoinForm();
    }
  }
}

function playersList(players) {
  const list = document.createElement("div");
  list.className = "player-list";
  players.forEach((p) => {
    const item = document.createElement("div");
    item.className = "player-chip";
    item.innerHTML = `${avatarHtml(p)}<span>${escapeHtml(p.name)}</span>${
      p.isHost ? '<span class="host-badge">хост</span>' : ""
    }`;
    list.appendChild(item);
  });
  return list;
}

async function renderLobby(wrap, state, token, code, switchPlayer) {
  const shareUrl = `${window.location.origin}/fanty/r/${code}`;
  const displayUrl = `${window.location.origin}/fanty/r/${code}/display`;
  const players = state.players.filter((p) => !p.isDisplay);
  const modeLabel = GAME_MODES.find((m) => m.value === state.settings.gameMode)?.label || state.settings.gameMode;

  wrap.innerHTML = `
    <h1 class="logo">🍾 Комната ${escapeHtml(code)}</h1>
    <p class="tagline">${escapeHtml(modeLabel)}</p>
    <p class="tagline">${escapeHtml(locationLabel(state.settings.location))} · ${state.settings.categories
    .map(categoryLabel)
    .map(escapeHtml)
    .join(", ")}</p>
    <p class="tagline">Бутылка выбирает: ${escapeHtml(pickModeLabel(state.settings.pickMode))}</p>
    <p class="players-count">Игроков: ${players.length} (минимум ${state.minPlayers})</p>
  `;
  wrap.appendChild(playersList(players));

  if (state.me.isDisplay) return;

  if (state.room.deviceMode === "local" && state.me.isHost) {
    const addCard = document.createElement("div");
    addCard.className = "card-inline";
    const label = document.createElement("p");
    label.className = "tagline";
    label.textContent = "Добавить игрока за этим устройством:";
    addCard.appendChild(label);

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Имя игрока";
    nameInput.maxLength = 30;
    let takenEmojis = [];
    try {
      const res = await api.getTakenEmojis(code);
      takenEmojis = res.taken || [];
    } catch (e) {
      takenEmojis = [];
    }
    const picker = createAvatarPicker(null, takenEmojis);

    const needsGender = state.settings.gameMode === "team" && state.settings.pairMode === "mixed";
    const genderLabel = document.createElement("label");
    genderLabel.textContent = "Пол";
    const genderGroup = genderRadioGroup(null);

    const addBtn = document.createElement("button");
    addBtn.className = "btn";
    addBtn.textContent = "Добавить";
    const addErr = document.createElement("div");
    addErr.className = "error-msg";

    addBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        addErr.textContent = "Введите имя";
        return;
      }
      const gender = needsGender ? genderGroup.getValue() : null;
      if (needsGender && !gender) {
        addErr.textContent = "Выберите пол";
        return;
      }
      addBtn.disabled = true;
      addErr.textContent = "";
      try {
        const avatar = picker.getValue();
        await fantyApi.addLocalPlayer(code, token, name, avatar.avatarType, avatar.avatarValue, gender);
        nameInput.value = "";
      } catch (e) {
        addErr.textContent = e.message;
      } finally {
        addBtn.disabled = false;
      }
    });

    addCard.appendChild(nameInput);
    addCard.appendChild(picker.element);
    if (needsGender) {
      addCard.appendChild(genderLabel);
      addCard.appendChild(genderGroup.element);
    }
    addCard.appendChild(addErr);
    addCard.appendChild(addBtn);
    wrap.appendChild(addCard);
  }

  if (state.room.deviceMode === "remote") {
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn";
    copyBtn.textContent = "Скопировать ссылку";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
      copyBtn.textContent = "Скопировано!";
      setTimeout(() => (copyBtn.textContent = "Скопировать ссылку"), 1500);
    });
    wrap.appendChild(copyBtn);
  }

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
        await fantyApi.start(code, token);
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

  if (state.room.deviceMode === "remote") {
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

function seatAngle(index, total) {
  return (360 / total) * index - 90;
}

function renderBottleCircle(players, fanty, ctrl) {
  const circleWrap = document.createElement("div");
  circleWrap.className = "bottle-circle";
  const radius = 42;

  players.forEach((p, i) => {
    const angleDeg = seatAngle(i, players.length);
    const rad = (angleDeg * Math.PI) / 180;
    const x = 50 + radius * Math.cos(rad);
    const y = 50 + radius * Math.sin(rad);
    const seat = document.createElement("div");
    seat.className =
      "circle-seat" +
      (p.id === fanty.pickedPlayerId ? " circle-seat-picked" : "") +
      (p.id === fanty.partnerPlayerId ? " circle-seat-partner" : "");
    seat.style.left = `${x}%`;
    seat.style.top = `${y}%`;
    seat.innerHTML = `<div class="seat-avatar">${avatarHtml(p)}</div><span>${escapeHtml(p.name)}</span>`;
    circleWrap.appendChild(seat);
  });

  const bottle = document.createElement("div");
  bottle.className = "bottle";
  bottle.innerHTML = BOTTLE_IMG;
  const targetId = fanty.phase === "awaiting_partner_spin" ? fanty.pickedPlayerId : fanty.partnerPlayerId || fanty.pickedPlayerId;
  let staticAngle = ctrl ? ctrl.getLastAngle() : 0;
  if (targetId) {
    const idx = players.findIndex((p) => p.id === targetId);
    if (idx >= 0) {
      staticAngle = seatAngle(idx, players.length) + 90;
      if (ctrl) ctrl.setLastAngle(staticAngle);
    }
  }
  bottle.style.transform = `translate(-50%, -50%) rotate(${staticAngle}deg)`;
  circleWrap.appendChild(bottle);

  return { circleWrap, bottle };
}

async function animateSpinAndRerender(bottle, players, targetPlayerId, ctrl, freshState) {
  const idx = players.findIndex((p) => p.id === targetPlayerId);
  const targetAngle = (idx >= 0 ? seatAngle(idx, players.length) : 0) + 90;
  ctrl.setAnimating(true);
  bottle.style.transition = `transform ${SPIN_ANIMATION_MS}ms cubic-bezier(0.1,0.85,0.15,1)`;
  bottle.style.transform = `translate(-50%, -50%) rotate(${targetAngle + 2160}deg)`;
  await new Promise((resolve) => setTimeout(resolve, SPIN_ANIMATION_MS));
  ctrl.setAnimating(false);
  ctrl.setLastAngle(targetAngle);
  ctrl.rerender(freshState);
}

function renderPlaying(wrap, state, token, code, ctrl) {
  const players = state.players.filter((p) => !p.isDisplay);
  const fanty = state.fanty;

  const displayRound = fanty.phase === "ready_to_spin" ? fanty.roundNumber + 1 : fanty.roundNumber;
  wrap.innerHTML = `<p class="round-label">Раунд ${displayRound}</p>`;

  const { circleWrap, bottle } = renderBottleCircle(players, fanty, ctrl);
  wrap.appendChild(circleWrap);

  const panel = document.createElement("div");
  panel.className = "fanty-panel";

  if (fanty.phase === "ready_to_spin") {
    if (fanty.canSpin) {
      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.textContent = "Крутить бутылку!";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await fantyApi.spin(code, token);
          const fresh = await fantyApi.getState(code, token);
          await animateSpinAndRerender(bottle, players, fresh.fanty.pickedPlayerId, ctrl, fresh);
        } catch (e) {
          alert(e.message);
          btn.disabled = false;
        }
      });
      panel.appendChild(btn);
    } else {
      const spinnerName = players.find((p) => p.id === fanty.nextSpinnerId)?.name || "?";
      const msg = document.createElement("p");
      msg.className = "tagline";
      msg.textContent = `Крутит: ${spinnerName}...`;
      panel.appendChild(msg);
    }
  } else if (fanty.phase === "awaiting_choice") {
    const pickedName = players.find((p) => p.id === fanty.pickedPlayerId)?.name || "?";
    const title = document.createElement("h2");
    title.className = "prompt-text";
    title.textContent = `${pickedName} выбирает: правда или действие?`;
    panel.appendChild(title);
    if (fanty.canAct) {
      const row = document.createElement("div");
      row.className = "row-actions";
      const truthBtn = document.createElement("button");
      truthBtn.className = "btn";
      truthBtn.textContent = "Правда";
      const actionBtn = document.createElement("button");
      actionBtn.className = "btn btn-primary";
      actionBtn.textContent = "Действие";
      async function choose(choice) {
        truthBtn.disabled = true;
        actionBtn.disabled = true;
        try {
          await fantyApi.choose(code, token, choice);
        } catch (e) {
          alert(e.message);
          truthBtn.disabled = false;
          actionBtn.disabled = false;
        }
      }
      truthBtn.addEventListener("click", () => choose("truth"));
      actionBtn.addEventListener("click", () => choose("action"));
      row.appendChild(truthBtn);
      row.appendChild(actionBtn);
      panel.appendChild(row);
    } else {
      const msg = document.createElement("p");
      msg.className = "tagline";
      msg.textContent = "Ждём выбора...";
      panel.appendChild(msg);
    }
  } else if (fanty.phase === "awaiting_partner_spin") {
    const pickedName = players.find((p) => p.id === fanty.pickedPlayerId)?.name || "?";
    const title = document.createElement("h2");
    title.className = "prompt-text";
    title.textContent = `${pickedName} крутит бутылку ещё раз — выбирает напарника!`;
    panel.appendChild(title);
    if (fanty.canSpinPartner) {
      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.textContent = "Крутить на напарника!";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await fantyApi.spinPartner(code, token);
          const fresh = await fantyApi.getState(code, token);
          await animateSpinAndRerender(bottle, players, fresh.fanty.partnerPlayerId, ctrl, fresh);
        } catch (e) {
          alert(e.message);
          btn.disabled = false;
        }
      });
      panel.appendChild(btn);
    } else {
      const msg = document.createElement("p");
      msg.className = "tagline";
      msg.textContent = "Ждём второй спин...";
      panel.appendChild(msg);
    }
  } else if (fanty.phase === "awaiting_action") {
    renderAwaitingAction(panel, state, token, code, players, ctrl);
  }

  wrap.appendChild(panel);

  if (state.me.isHost && fanty.phase === "ready_to_spin") {
    const endBtn = document.createElement("button");
    endBtn.className = "btn danger";
    endBtn.style.marginTop = "16px";
    endBtn.textContent = "Завершить игру";
    endBtn.addEventListener("click", async () => {
      if (!confirm("Завершить игру и показать итоги?")) return;
      endBtn.disabled = true;
      try {
        await fantyApi.end(code, token);
      } catch (e) {
        alert(e.message);
        endBtn.disabled = false;
      }
    });
    wrap.appendChild(endBtn);
  }
}

function renderAwaitingAction(panel, state, token, code, players, ctrl) {
  const fanty = state.fanty;
  const pickedName = players.find((p) => p.id === fanty.pickedPlayerId)?.name || "?";
  const partnerName = fanty.partnerPlayerId
    ? players.find((p) => p.id === fanty.partnerPlayerId)?.name || "?"
    : null;

  const who = document.createElement("p");
  who.className = "round-label";
  who.textContent = partnerName ? `${pickedName} и ${partnerName}` : pickedName;
  panel.appendChild(who);

  if (fanty.choice) {
    const badge = document.createElement("p");
    badge.className = "tagline";
    badge.textContent = fanty.choice === "truth" ? "Выбрано: Правда" : "Выбрано: Действие";
    panel.appendChild(badge);
  }

  const text = document.createElement("h2");
  text.className = "prompt-text";
  text.textContent = fanty.contentText || "…";
  panel.appendChild(text);

  const needsStart = Boolean(fanty.hasTimer || fanty.musicUrl);
  const started = !needsStart || Boolean(fanty.performanceStartedAt);

  if (!started) {
    if (fanty.canAct) {
      const goBtn = document.createElement("button");
      goBtn.className = "btn btn-primary";
      goBtn.textContent = "Поехали!";
      goBtn.addEventListener("click", async () => {
        goBtn.disabled = true;
        if (fanty.musicUrl) {
          const audio = new Audio(fanty.musicUrl);
          audio.play().catch(() => {});
          if (ctrl) ctrl.setAudio(audio);
        }
        try {
          await fantyApi.startPerformance(code, token);
          const fresh = await fantyApi.getState(code, token);
          if (ctrl) ctrl.rerender(fresh);
        } catch (e) {
          alert(e.message);
          goBtn.disabled = false;
        }
      });
      panel.appendChild(goBtn);
    } else {
      const msg = document.createElement("p");
      msg.className = "tagline";
      msg.textContent = "Ждём, когда начнут...";
      panel.appendChild(msg);
    }
    return;
  }

  if (needsStart) {
    if (fanty.hasTimer) {
      const timerEl = document.createElement("div");
      timerEl.className = "big-timer";
      panel.appendChild(timerEl);

      const startedAt = new Date(fanty.performanceStartedAt).getTime();
      const totalMs = fanty.timerSeconds * 1000;

      function tick() {
        const remaining = startedAt + totalMs - Date.now();
        if (remaining <= 0) {
          timerEl.textContent = "Стооооп!";
          timerEl.classList.add("big-timer-stop");
          if (ctrl) ctrl.stopAudio();
        } else {
          timerEl.textContent = `${Math.ceil(remaining / 1000)}`;
        }
      }
      tick();
      if (ctrl) ctrl.setTimerInterval(setInterval(tick, 250));
    }
    if (fanty.musicUrl) {
      const musicMsg = document.createElement("p");
      musicMsg.className = "tagline";
      musicMsg.textContent = "🎵 Играет музыка";
      panel.appendChild(musicMsg);
    }
  }

  if (fanty.canResolve) {
    const photosState = { files: [] };

    if (fanty.contentType === "dare") {
      const uploadLabel = document.createElement("label");
      uploadLabel.className = "upload-label";
      const uploadLabelText = document.createElement("span");
      uploadLabelText.textContent = "📷 Добавить фото (0/5)";
      const uploadInput = document.createElement("input");
      uploadInput.type = "file";
      uploadInput.accept = "image/*";
      uploadInput.multiple = true;
      uploadInput.style.display = "none";
      uploadInput.addEventListener("change", async () => {
        const remaining = 5 - photosState.files.length;
        const files = Array.from(uploadInput.files || []).slice(0, remaining);
        for (const file of files) {
          try {
            const res = await fantyApi.uploadPhoto(code, file);
            photosState.files.push(res.filename);
          } catch (e) {
            alert(e.message);
          }
        }
        uploadLabelText.textContent = `📷 Добавить фото (${photosState.files.length}/5)`;
        uploadInput.value = "";
      });
      uploadLabel.appendChild(uploadLabelText);
      uploadLabel.appendChild(uploadInput);
      panel.appendChild(uploadLabel);
    }

    const row = document.createElement("div");
    row.className = "row-actions";
    const countedBtn = document.createElement("button");
    countedBtn.className = "btn btn-primary";
    countedBtn.textContent = "Засчитано!";
    const notCountedBtn = document.createElement("button");
    notCountedBtn.className = "btn danger";
    notCountedBtn.textContent = "Не засчитано!";

    async function resolve(counted) {
      countedBtn.disabled = true;
      notCountedBtn.disabled = true;
      if (ctrl) ctrl.stopAudio();
      try {
        await fantyApi.resolve(code, token, counted, photosState.files);
      } catch (e) {
        alert(e.message);
        countedBtn.disabled = false;
        notCountedBtn.disabled = false;
      }
    }
    countedBtn.addEventListener("click", () => resolve(true));
    notCountedBtn.addEventListener("click", () => resolve(false));
    row.appendChild(countedBtn);
    row.appendChild(notCountedBtn);
    panel.appendChild(row);
  } else {
    const msg = document.createElement("p");
    msg.className = "tagline";
    msg.textContent = "Ждём, пока организатор подтвердит выполнение...";
    panel.appendChild(msg);
  }
}

function renderFinished(wrap, state) {
  wrap.innerHTML = `<h1 class="logo">🏁 Игра окончена!</h1>`;
  const summary = state.summary || [];
  if (summary.length === 0) {
    const p = document.createElement("p");
    p.className = "tagline";
    p.textContent = "Раундов не было.";
    wrap.appendChild(p);
  }

  const allPhotos = summary.flatMap((r) => r.photos || []);

  if (allPhotos.length > 1) {
    const shareAllBtn = document.createElement("button");
    shareAllBtn.className = "btn";
    shareAllBtn.textContent = `📤 Поделиться всеми фото (${allPhotos.length})`;
    shareAllBtn.addEventListener("click", () => shareAllImages(allPhotos));
    wrap.appendChild(shareAllBtn);
  }

  summary.forEach((r) => {
    const card = document.createElement("div");
    card.className = "fanty-summary-card";
    const who = r.partnerName
      ? `${escapeHtml(r.pickedName)} и ${escapeHtml(r.partnerName)}`
      : escapeHtml(r.pickedName);
    const choiceLabel = r.choice ? (r.choice === "truth" ? " · Правда" : " · Действие") : "";
    card.innerHTML = `
      <p class="round-label">Раунд ${r.roundNumber} · ${who}${choiceLabel} ${r.counted ? "✅" : "❌"}</p>
      <p class="prompt-text" style="font-size:16px">${escapeHtml(r.text || "")}</p>
    `;
    if (r.photos && r.photos.length) {
      const photoRow = document.createElement("div");
      photoRow.className = "photo-row";
      r.photos.forEach((src) => {
        const img = document.createElement("img");
        img.src = src;
        img.className = "summary-photo";
        img.addEventListener("click", () => openLightbox(allPhotos, allPhotos.indexOf(src)));
        photoRow.appendChild(img);
      });
      card.appendChild(photoRow);
    }
    wrap.appendChild(card);
  });

  if (!state.me.isDisplay) {
    const homeBtn = document.createElement("button");
    homeBtn.className = "btn btn-primary";
    homeBtn.textContent = "На главную";
    homeBtn.addEventListener("click", () => navigate("/"));
    wrap.appendChild(homeBtn);
  }
}
