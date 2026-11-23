import { api, authApi, reverseApi } from "../../api.js";
import { loadSession, saveSession, clearSession, getDeviceId } from "../../storage.js";
import { navigate } from "../../router.js";
import { createAvatarPicker, avatarHtml } from "../../avatarPicker.js";
import { escapeHtml } from "../../utils.js";
import { createPlayButton, stopAllAudio, MAX_CHUNK_SECONDS } from "../../audioTools.js";
import { createRecorderPanel } from "./recorderPanel.js";

const POLL_MS = 1500;
const RANK_MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

// Same rules as the other games' leave button: a guest's room can't be
// found again once they're gone, so the host gets a warning and the room is
// discarded; a logged-in host's room stays resumable.
async function leaveRoom(state, token, code) {
  let authenticated = false;
  try {
    authenticated = Boolean((await authApi.session()).authenticated);
  } catch (e) {
    authenticated = false;
  }
  if (!authenticated) {
    const ok = confirm("Если вы выйдете, комната будет потеряна — сохранить её можно только под аккаунтом. Выйти?");
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

function leaderboardEl(players) {
  const sorted = players
    .filter((p) => !p.isDisplay)
    .slice()
    .sort((a, b) => b.totalScore - a.totalScore);
  const list = document.createElement("div");
  list.className = "score-list";
  withRanks(sorted).forEach(({ player: p, rank }) => {
    const medal = RANK_MEDALS[rank];
    const row = document.createElement("div");
    row.className = "score-row" + (medal ? ` score-row-top rank-${rank}` : "");
    row.innerHTML = `<span class="rank">${medal || rank}</span>${avatarHtml(p)}<span>${escapeHtml(
      p.name
    )}</span><span class="score-points">${p.totalScore}</span>`;
    list.appendChild(row);
  });
  return list;
}

function nameOf(state, playerId) {
  const p = state.players.find((x) => x.id === playerId);
  return p ? p.name : "?";
}

function p(className, text) {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
}

function heading(text) {
  const h = document.createElement("h2");
  h.textContent = text;
  h.style.textAlign = "center";
  h.style.margin = "0";
  return h;
}

// What the screen shows changes only when this key changes; between changes
// the existing DOM is left alone (a recorder mid-recording or a clip mid-play
// would otherwise be torn down by every poll tick) and only a small
// `updater` patches the live bits, like the answered counter.
function viewKey(state, introDoneRound) {
  const status = state.room.status;
  if (status === "lobby") return `lobby:${state.players.length}:${state.canStart}:${state.me.isHost}`;
  if (status === "finished") return "finished";
  const rv = state.reverse;
  if (!rv) return "playing";
  const role = rv.isSpeaker ? "speaker" : rv.isImitator ? "imitator" : "other";
  const answered = rv.myAnswer === null || rv.myAnswer === undefined ? "open" : "answered";
  const intro = rv.isImitator && rv.imitationDone === 0 && introDoneRound !== rv.roundNumber ? "intro" : "parts";
  return `round${rv.roundNumber}:${rv.phase}:${role}:${answered}:${rv.originalDone}:${rv.imitationDone}:${intro}`;
}

export function mountReverseRoomPage(container, code) {
  let pollTimer = null;
  let stopped = false;
  let lastKey = null;
  let updater = null;
  // The imitator first hears the whole reversed recording, then goes through
  // it piece by piece. That step is purely local — remembered per round.
  let introDoneRound = null;
  let panels = [];

  function teardownView() {
    panels.forEach((panel) => panel.destroy());
    panels = [];
    updater = null;
  }

  function stop() {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    teardownView();
    stopAllAudio();
  }
  window.addEventListener("vecherinka:navigate", stop, { once: true });

  const session = loadSession(code);
  if (session) {
    startPolling(session.token);
  } else {
    renderJoinForm();
  }

  async function renderJoinForm() {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "screen home-screen";
    wrap.innerHTML = `<h1 class="logo">⏪ Комната ${escapeHtml(code)}</h1><p class="tagline">Введите имя, чтобы присоединиться</p>`;
    container.appendChild(wrap);

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 20;

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

    wrap.appendChild(nameInput);
    wrap.appendChild(picker.element);
    wrap.appendChild(errorEl);
    wrap.appendChild(btn);
  }

  function startPolling(token) {
    async function tick() {
      if (stopped) return;
      try {
        const state = await reverseApi.getState(code, token);
        const key = viewKey(state, introDoneRound);
        if (key !== lastKey) {
          lastKey = key;
          renderFull(state, token);
        } else if (updater) {
          updater(state);
        }
      } catch (e) {
        // Only a definitive "you're not in this room" ends the session —
        // a dropped connection has no e.status and just retries next tick.
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          clearSession(code);
          teardownView();
          container.innerHTML = `<div class="screen center-screen"><p class="error-msg">${escapeHtml(
            e.message
          )}</p><button class="btn" id="back-home">На главную</button></div>`;
          const backBtn = document.getElementById("back-home");
          if (backBtn) backBtn.addEventListener("click", () => navigate("/"));
          return;
        }
      }
      if (!stopped) pollTimer = setTimeout(tick, POLL_MS);
    }
    tick();
  }

  function renderFull(state, token) {
    teardownView();
    stopAllAudio();
    container.innerHTML = "";

    const page = document.createElement("div");
    page.className = "room-page";

    const meBadge = document.createElement("div");
    meBadge.className = "me-badge";
    meBadge.innerHTML = `${avatarHtml(state.me)}<span>${escapeHtml(state.me.name)}</span>`;
    page.appendChild(meBadge);

    const leaveBtn = document.createElement("button");
    leaveBtn.className = "link-btn danger-text";
    leaveBtn.textContent = "🚪 Выйти из комнаты";
    leaveBtn.addEventListener("click", async () => {
      leaveBtn.disabled = true;
      const left = await leaveRoom(state, token, code);
      if (!left) leaveBtn.disabled = false;
    });
    page.appendChild(leaveBtn);

    const wrap = document.createElement("div");
    wrap.className = "screen room-screen";
    page.appendChild(wrap);
    container.appendChild(page);

    const status = state.room.status;
    if (status === "lobby") renderLobby(wrap, state, token);
    else if (status === "finished") renderFinished(wrap, state, token);
    else if (state.reverse) renderRound(wrap, state, token);
  }

  // --- lobby ---

  function renderLobby(wrap, state, token) {
    const shareUrl = `${window.location.origin}/reverse/r/${code}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`;
    const players = state.players.filter((pl) => !pl.isDisplay);

    wrap.innerHTML = `
      <h1 class="logo">⏪ Комната ${escapeHtml(code)}</h1>
      <img class="qr-code" src="${qrUrl}" alt="QR код" />
      <p class="tagline">Позовите друзей: <b>${escapeHtml(shareUrl)}</b></p>
      <p class="players-count">Игроков: ${players.length} (минимум ${state.minPlayers})</p>
    `;

    const list = document.createElement("div");
    list.className = "player-list";
    players.forEach((pl) => {
      const item = document.createElement("div");
      item.className = "player-chip";
      item.innerHTML = `${avatarHtml(pl)}<span>${escapeHtml(pl.name)}</span>${
        pl.isHost ? '<span class="host-badge">хост</span>' : ""
      }`;
      list.appendChild(item);
    });
    wrap.appendChild(list);

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn";
    copyBtn.textContent = "Скопировать ссылку";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
      copyBtn.textContent = "Скопировано!";
      setTimeout(() => (copyBtn.textContent = "Скопировать ссылку"), 1500);
    });
    wrap.appendChild(copyBtn);

    wrap.appendChild(p("tagline", "🎙 Каждому понадобится микрофон на своём телефоне."));
    if (players.length >= state.minPlayers) {
      const rounds = players.length * (players.length - 1);
      wrap.appendChild(
        p(
          "tagline",
          `Каждый загадает каждому — раундов будет ${rounds}. Хост может завершить игру раньше.`
        )
      );
    }

    if (state.me.isHost) {
      const startBtn = document.createElement("button");
      startBtn.className = "btn btn-primary";
      startBtn.textContent = state.canStart ? "Начать игру" : `Нужно ещё игроков (мин. ${state.minPlayers})`;
      startBtn.disabled = !state.canStart;
      startBtn.addEventListener("click", async () => {
        startBtn.disabled = true;
        try {
          await reverseApi.start(code, token);
        } catch (e) {
          alert(e.message);
          startBtn.disabled = false;
        }
      });
      wrap.appendChild(startBtn);
    } else {
      wrap.appendChild(p("tagline", "Ждём, пока хост начнёт игру..."));
    }
  }

  // --- round ---

  function roundLabel(rv) {
    return p("round-label", `Раунд ${rv.roundNumber} из ${rv.totalRounds}`);
  }

  function renderRound(wrap, state, token) {
    const rv = state.reverse;
    wrap.appendChild(roundLabel(rv));

    if (rv.phase === "recording_original") renderRecordingOriginal(wrap, state, token, rv);
    else if (rv.phase === "recording_imitation") renderRecordingImitation(wrap, state, token, rv);
    else if (rv.phase === "guessing") renderGuessing(wrap, state, token, rv);
    else if (rv.phase === "reveal") renderReveal(wrap, state, token, rv);

    if (state.me.isHost && rv.phase !== "reveal") {
      const skipBtn = document.createElement("button");
      skipBtn.className = "link-btn danger-text";
      skipBtn.textContent = "⏭ Пропустить раунд";
      skipBtn.addEventListener("click", async () => {
        if (!confirm("Пропустить этот раунд без очков?")) return;
        skipBtn.disabled = true;
        try {
          await reverseApi.skip(code, token);
        } catch (e) {
          alert(e.message);
          skipBtn.disabled = false;
        }
      });
      wrap.appendChild(skipBtn);
    }

    if (state.me.isHost) {
      const endBtn = document.createElement("button");
      endBtn.className = "link-btn danger-text";
      endBtn.textContent = "🏁 Завершить игру";
      endBtn.addEventListener("click", async () => {
        if (!confirm("Завершить игру и показать итоги?")) return;
        endBtn.disabled = true;
        try {
          await reverseApi.end(code, token);
        } catch (e) {
          alert(e.message);
          endBtn.disabled = false;
        }
      });
      wrap.appendChild(endBtn);
    }
  }

  // Stands out on purpose: if the group is sitting together and the speaker
  // records out loud next to them, the whole round is spoiled.
  function secretWarning(html) {
    const el = document.createElement("div");
    el.className = "secret-warning";
    el.innerHTML = html;
    return el;
  }

  function progressDots(done, total) {
    const el = document.createElement("div");
    el.className = "chunk-progress";
    for (let i = 0; i < total; i++) {
      const dot = document.createElement("span");
      dot.className = "chunk-dot" + (i < done ? " done" : i === done ? " current" : "");
      el.appendChild(dot);
    }
    return el;
  }

  function renderRecordingOriginal(wrap, state, token, rv) {
    if (rv.isSpeaker) {
      const index = rv.originalDone;
      wrap.appendChild(heading(`Твоя фраза · часть ${index + 1} из ${rv.chunkCount}`));
      wrap.appendChild(
        secretWarning(
          "<b>🤫 Никто не должен слышать, как ты записываешь!</b><br/>Если вы сидите рядом — отойди в другую комнату или хотя бы подальше от всех. Иначе остальные узнают фразу ещё до игры."
        )
      );

      const card = document.createElement("div");
      card.className = "prompt-text phrase-card";
      rv.chunks.forEach((text, i) => {
        const piece = document.createElement("span");
        piece.className = "phrase-piece" + (i < index ? " done" : i === index ? " current" : "");
        piece.textContent = text;
        card.appendChild(piece);
        if (i < rv.chunks.length - 1) card.appendChild(document.createTextNode(" "));
      });
      wrap.appendChild(card);
      wrap.appendChild(progressDots(index, rv.chunkCount));
      wrap.appendChild(
        p(
          "tagline",
          "Фраза записывается кусками по два слова. Прочитай вслух выделенный кусок чётко и не торопясь. Остальные услышат всё только задом наперёд."
        )
      );
      const isLast = index === rv.chunkCount - 1;
      const panel = createRecorderPanel({
        idleLabel: `🎙 Записать «${rv.chunks[index]}»`,
        submitLabel: isLast ? "✅ Отправить последнюю часть" : "✅ Отправить и дальше",
        maxSeconds: MAX_CHUNK_SECONDS,
        onSubmit: (blob) => reverseApi.uploadOriginal(code, token, blob, index),
      });
      panels.push(panel);
      wrap.appendChild(panel.element);
      return;
    }
    wrap.appendChild(heading("🎙 Запись фразы"));
    wrap.appendChild(p("tagline", `${nameOf(state, rv.speakerId)} записывает загаданную фразу по частям…`));
    wrap.appendChild(progressDots(rv.originalDone, rv.chunkCount));
    wrap.appendChild(
      secretWarning("<b>🤫 Не подслушивайте!</b><br/>Пока идёт запись, фразу не должен слышать никто, кроме загадывающего.")
    );
    if (rv.isImitator) {
      wrap.appendChild(
        p("tagline", "Дальше ты послушаешь эту запись задом наперёд и повторишь её по частям. Приготовься!")
      );
    }
  }

  function renderRecordingImitation(wrap, state, token, rv) {
    if (rv.isImitator) {
      const inIntro = rv.imitationDone === 0 && introDoneRound !== rv.roundNumber;
      if (inIntro) {
        wrap.appendChild(heading("Послушай запись задом наперёд"));
        wrap.appendChild(
          p(
            "tagline",
            "Сначала послушай всю запись целиком — просто чтобы поймать общее впечатление. Потом будешь слушать и повторять её по частям."
          )
        );
        wrap.appendChild(createPlayButton(rv.reversedUrl, "Прослушать всю запись", "btn btn-primary"));
        const startBtn = document.createElement("button");
        startBtn.className = "btn";
        startBtn.textContent = `Дальше — по частям (${rv.chunkCount}) →`;
        startBtn.addEventListener("click", () => {
          introDoneRound = rv.roundNumber;
          lastKey = viewKey(state, introDoneRound);
          renderFull(state, token);
        });
        wrap.appendChild(startBtn);
        return;
      }

      const index = rv.imitationDone;
      wrap.appendChild(heading(`Часть ${index + 1} из ${rv.chunkCount}`));
      wrap.appendChild(progressDots(index, rv.chunkCount));
      wrap.appendChild(
        p(
          "tagline",
          "Послушай этот кусок сколько нужно и сразу повтори его на запись. Повторяй звуки, а не смысл — чем точнее, тем лучше."
        )
      );
      wrap.appendChild(createPlayButton(rv.portions[index], "Прослушать эту часть", "btn btn-primary"));
      const isLast = index === rv.chunkCount - 1;
      const panel = createRecorderPanel({
        idleLabel: "🎙 Записать, как я услышал(а)",
        submitLabel: isLast ? "✅ Отправить последнюю часть" : "✅ Отправить и дальше",
        maxSeconds: MAX_CHUNK_SECONDS,
        onSubmit: (blob) => reverseApi.uploadImitation(code, token, blob, index),
      });
      panels.push(panel);
      wrap.appendChild(panel.element);
      wrap.appendChild(createPlayButton(rv.reversedUrl, "Послушать всю запись ещё раз", "link-btn"));
      return;
    }
    wrap.appendChild(heading("👂 Слушаем наоборот"));
    wrap.appendChild(
      p("tagline", `${nameOf(state, rv.imitatorId)} слушает запись задом наперёд и повторяет её по частям…`)
    );
    wrap.appendChild(progressDots(rv.imitationDone, rv.chunkCount));
    if (rv.isSpeaker && rv.phrase) {
      wrap.appendChild(p("hint", `Твоя фраза: «${rv.phrase}»`));
    }
  }

  function renderGuessing(wrap, state, token, rv) {
    wrap.appendChild(heading("Что было загадано?"));
    wrap.appendChild(
      p(
        "tagline",
        rv.isSpeaker
          ? `Игроки слушают то, что получилось у ${nameOf(state, rv.imitatorId)}, и выбирают фразу.`
          : "Послушай запись и выбери фразу, которую загадали."
      )
    );
    wrap.appendChild(createPlayButton(rv.guessUrl, "Прослушать запись", "btn btn-primary"));

    const answered = rv.myAnswer !== null && rv.myAnswer !== undefined;
    if (!rv.isSpeaker) {
      const options = document.createElement("div");
      options.className = "guess-options";
      rv.options.forEach((text, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "guess-option" + (answered && rv.myAnswer === index ? " selected" : "");
        btn.textContent = text;
        btn.disabled = answered;
        btn.addEventListener("click", async () => {
          options.querySelectorAll("button").forEach((b) => (b.disabled = true));
          btn.classList.add("selected");
          try {
            await reverseApi.answer(code, token, index);
          } catch (e) {
            alert(e.message);
            options.querySelectorAll("button").forEach((b) => (b.disabled = false));
            btn.classList.remove("selected");
          }
        });
        options.appendChild(btn);
      });
      wrap.appendChild(options);
    }

    const progress = document.createElement("p");
    progress.className = "tagline";
    const renderProgress = (r) => {
      const waiting = rv.isSpeaker || answered ? "Ждём ответов: " : "Ответили: ";
      progress.textContent = `${waiting}${r.answeredCount} из ${r.guesserCount}`;
    };
    renderProgress(rv);
    wrap.appendChild(progress);
    updater = (s) => {
      if (s.reverse && s.reverse.phase === "guessing") renderProgress(s.reverse);
    };

    if (state.me.isHost) {
      const revealBtn = document.createElement("button");
      revealBtn.className = "btn";
      revealBtn.textContent = "Показать ответ, не дожидаясь всех";
      revealBtn.addEventListener("click", async () => {
        revealBtn.disabled = true;
        try {
          await reverseApi.reveal(code, token);
        } catch (e) {
          alert(e.message);
          revealBtn.disabled = false;
        }
      });
      wrap.appendChild(revealBtn);
    }
  }

  function renderReveal(wrap, state, token, rv) {
    wrap.appendChild(heading("Ответ"));

    const correctCount = rv.answers.filter((a) => a.correct).length;

    const list = document.createElement("div");
    list.className = "guess-options";
    rv.options.forEach((text, index) => {
      const isCorrect = index === rv.correctIndex;
      const picked = rv.answers.filter((a) => a.optionIndex === index);
      const row = document.createElement("div");
      row.className = "guess-result" + (isCorrect ? " correct" : "") + (picked.length && !isCorrect ? " wrong" : "");
      const label = document.createElement("div");
      label.className = "guess-result-text";
      label.textContent = `${isCorrect ? "✅ " : ""}${text}`;
      row.appendChild(label);
      if (picked.length) {
        const chips = document.createElement("div");
        chips.className = "guess-result-chips";
        picked.forEach((a) => {
          const pl = state.players.find((x) => x.id === a.playerId);
          if (!pl) return;
          const chip = document.createElement("span");
          chip.className = "mini-chip";
          chip.innerHTML = `${avatarHtml(pl)}<span>${escapeHtml(pl.name)}</span>`;
          chips.appendChild(chip);
        });
        row.appendChild(chips);
      }
      list.appendChild(row);
    });
    wrap.appendChild(list);

    const speakerName = nameOf(state, rv.speakerId);
    if (correctCount > 0) {
      wrap.appendChild(
        p(
          "tagline",
          `Угадавшие получают по 1 очку, а ${speakerName} — ещё ${correctCount} за чёткую речь.`
        )
      );
    } else {
      wrap.appendChild(p("tagline", "Никто не угадал — очков в этом раунде нет."));
    }

    const clips = document.createElement("div");
    clips.className = "row-actions";
    clips.appendChild(createPlayButton(rv.originalUrl, "Оригинал"));
    clips.appendChild(createPlayButton(rv.guessUrl, "Что услышали все"));
    wrap.appendChild(clips);

    wrap.appendChild(heading("Очки"));
    wrap.appendChild(leaderboardEl(state.players));

    if (state.me.isHost) {
      const isLast = rv.roundNumber >= rv.totalRounds;
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-primary";
      nextBtn.textContent = isLast ? "Показать итоги" : "Следующий раунд";
      nextBtn.addEventListener("click", async () => {
        nextBtn.disabled = true;
        try {
          await reverseApi.next(code, token);
        } catch (e) {
          alert(e.message);
          nextBtn.disabled = false;
        }
      });
      wrap.appendChild(nextBtn);
    } else {
      wrap.appendChild(p("tagline", "Ждём, пока хост продолжит…"));
    }
  }

  // --- finished ---

  function renderFinished(wrap, state, token) {
    wrap.innerHTML = `<h1 class="logo">🏁 Игра окончена!</h1>`;
    wrap.appendChild(leaderboardEl(state.players));

    (state.summary || []).forEach((r) => {
      const card = document.createElement("div");
      card.className = "fanty-summary-card";
      const who = r.correctNames.length ? r.correctNames.map(escapeHtml).join(", ") : "никто не угадал";
      card.innerHTML = `
        <p class="round-label">Раунд ${r.roundNumber} · ${escapeHtml(r.speakerName)}</p>
        <p class="prompt-text" style="font-size:16px">${escapeHtml(r.phrase)}</p>
        <p class="hint" style="margin:8px 0 0">Угадали: ${who}</p>
      `;
      wrap.appendChild(card);
    });

    const homeBtn = document.createElement("button");
    homeBtn.className = "btn btn-primary";
    homeBtn.textContent = "На главную";
    homeBtn.addEventListener("click", async () => {
      homeBtn.disabled = true;
      const left = await leaveRoom(state, token, code);
      if (!left) homeBtn.disabled = false;
    });
    wrap.appendChild(homeBtn);
  }
}
