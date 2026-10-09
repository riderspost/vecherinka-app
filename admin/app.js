const API = "/admin/api";

const LOCATIONS = [
  { value: "apartment", label: "Квартира" },
  { value: "bar", label: "Бар" },
  { value: "street", label: "Улица" },
  { value: "country_house", label: "Загородный дом" },
];

const MOOD_CATEGORIES = [
  { value: "basic", label: "Базовые" },
  { value: "flirt", label: "Флирт" },
  { value: "flirt_plus", label: "Флирт+" },
];

const ATTRIBUTES = [
  { value: "alcohol", label: "Алкоголь" },
  { value: "food", label: "Еда" },
];

function checkboxRow(options, name) {
  return options
    .map((o) => `<label><input type="checkbox" name="${name}" value="${o.value}" /> ${o.label}</label>`)
    .join(" ");
}

function radioRow(options, name, defaultValue) {
  return options
    .map(
      (o) =>
        `<label><input type="radio" name="${name}" value="${o.value}"${
          o.value === defaultValue ? " checked" : ""
        } /> ${o.label}</label>`
    )
    .join(" ");
}

function selectOptions(options, placeholder) {
  return (
    `<option value="">${placeholder}</option>` +
    options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")
  );
}

function labelFor(list, value) {
  return list.find((o) => o.value === value)?.label || value;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(API + path, {
    credentials: "same-origin",
    headers: options.body && !isFormData ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `Ошибка запроса (${res.status})`);
  return data;
}

const root = document.getElementById("admin-app");

async function main() {
  const { authenticated } = await api("/session");
  if (!authenticated) {
    renderLogin();
  } else {
    await renderDashboard();
  }
}

function renderLogin() {
  root.innerHTML = `
    <div class="login-wrap card">
      <h1 style="margin-top:0">🎉 Вечеринка — админка</h1>
      <p class="hint">Управление списком фраз для игры. Доступ только для администраторов.</p>
      <form id="login-form">
        <label>Логин</label>
        <input type="text" name="username" autocomplete="username" required />
        <label>Пароль</label>
        <input type="password" name="password" autocomplete="current-password" required />
        <div class="error-box" id="login-error"></div>
        <div style="margin-top:16px">
          <button type="submit" class="btn">Войти</button>
        </div>
      </form>
    </div>
  `;

  const form = document.getElementById("login-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const errorEl = document.getElementById("login-error");
    errorEl.textContent = "";
    try {
      await api("/login", {
        method: "POST",
        body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
      });
      await renderDashboard();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function setupTabs(tabButtons, sections) {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
      Object.entries(sections).forEach(([key, el]) => {
        el.style.display = key === btn.dataset.target ? "" : "none";
      });
    });
  });
}

function pendingReviewCard(idPrefix, title) {
  return `
    <div class="card" id="${idPrefix}-pending-card" style="display:none">
      <h2 style="margin-top:0">${title}</h2>
      <div id="${idPrefix}-pending-table"></div>
    </div>
  `;
}

async function renderDashboard() {
  root.innerHTML = `
    <div class="admin-header">
      <h1>🎉 Вечеринка — админка</h1>
      <button class="btn secondary" id="logout-btn">Выйти</button>
    </div>

    <div class="tabs" id="main-tabs">
      <button class="tab-btn active" data-target="prompts">Продолжи предложение</button>
      <button class="tab-btn" data-target="fanty">Фанты</button>
      <button class="tab-btn" data-target="users">Пользователи</button>
      <button class="tab-btn" data-target="rooms">Комнаты</button>
    </div>

    <div id="section-prompts">
      <div class="card">
        <div class="row-actions" style="justify-content:space-between;align-items:center">
          <h2 style="margin:0">Вопросы</h2>
          <button class="btn" id="prompt-add-btn">+ Добавить новый</button>
        </div>
        <form id="add-form" style="display:none;margin-top:16px">
          <h3 style="margin-top:0" id="prompt-form-heading">Добавить вручную</h3>
          <label>Текст фразы (начало предложения)</label>
          <textarea name="text" maxlength="300" placeholder="Если бы я был..." required></textarea>
          <div class="error-box" id="add-error"></div>
          <div class="row-actions" style="margin-top:8px">
            <button type="submit" class="btn" id="prompt-submit-btn">Добавить</button>
            <button type="button" class="btn secondary" id="prompt-cancel-edit-btn">Отмена</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Сгенерировать через AI</h2>
        <div class="row">
          <div>
            <label>Сколько сгенерировать</label>
            <input type="number" id="gen-count" min="1" max="30" value="10" />
          </div>
          <div style="flex:2">
            <label>Тема/пожелание (необязательно)</label>
            <input type="text" id="gen-theme" maxlength="200" placeholder="Например: про путешествия" />
          </div>
          <div style="flex:0 0 auto">
            <button class="btn" id="gen-btn">Сгенерировать</button>
          </div>
        </div>
        <div class="error-box" id="gen-error"></div>
        <div class="success-box" id="gen-success"></div>
      </div>

      ${pendingReviewCard("prompts", "На проверке (сгенерировано AI)")}

      <div class="card">
        <div class="row-actions" style="justify-content:space-between;align-items:center;margin-bottom:10px">
          <h2 style="margin:0">Активные вопросы</h2>
          <div class="prompt-count" id="prompts-count"></div>
        </div>
        <div class="filter-bar">
          <input type="text" id="prompts-filter-search" class="filter-input" placeholder="Поиск по тексту..." />
        </div>
        <div id="prompts-table"></div>
      </div>
    </div>

    <div id="section-fanty" style="display:none">
      <div class="tabs" id="fanty-tabs">
        <button class="tab-btn active" data-target="dares">Фанты</button>
        <button class="tab-btn" data-target="truths">Вопросы (правда)</button>
      </div>

      <div id="fanty-subsection-dares">
        <div class="card">
          <div class="row-actions" style="justify-content:space-between;align-items:center">
            <h2 style="margin:0">Фанты</h2>
            <button class="btn" id="dare-add-btn">+ Добавить новый</button>
          </div>
          <form id="add-dare-form" style="display:none;margin-top:16px">
            <h3 style="margin-top:0" id="dare-form-heading">Добавить вручную</h3>
            <label>Текст фанта</label>
            <textarea name="text" maxlength="300" placeholder="Выпей стакан воды без использования рук." required></textarea>
            <label>Тип</label>
            <div class="row">
              <label><input type="radio" name="kind" value="solo" checked /> Для одного</label>
              <label><input type="radio" name="kind" value="team" /> Командный ({p1}/{p2})</label>
            </div>
            <div class="row" id="dare-mixed-pair-row" style="display:none">
              <label><input type="checkbox" name="mixedPair" /> Только для пары М+Ж (используйте {m}/{f} вместо {p1}/{p2})</label>
            </div>
            <label>Места</label>
            <div class="row" id="dare-locations"></div>
            <label>Категория</label>
            <div class="row" id="dare-category"></div>
            <label>Атрибуты (необязательно)</label>
            <div class="row" id="dare-attributes"></div>
            <label>Музыка (необязательно)</label>
            <input type="file" id="dare-audio-input" accept="audio/*" />
            <div id="dare-audio-status" class="hint"></div>
            <div id="dare-music-editor" style="display:none;margin-top:8px">
              <audio id="dare-music-preview"></audio>
              <div class="music-timeline" id="dare-music-timeline">
                <div class="music-timeline-fog music-timeline-fog-left" id="dare-music-fog-left"></div>
                <div class="music-timeline-window" id="dare-music-window"></div>
                <div class="music-timeline-fog music-timeline-fog-right" id="dare-music-fog-right"></div>
                <div class="music-timeline-playhead" id="dare-music-playhead"></div>
              </div>
              <div class="row-actions" style="margin-top:8px;align-items:center">
                <button type="button" class="btn secondary" id="dare-music-play-btn">▶️ Прослушать отрывок</button>
                <span class="hint" id="dare-music-range-label"></span>
              </div>
            </div>
            <div class="row">
              <label><input type="checkbox" id="dare-has-timer" /> Таймер</label>
            </div>
            <div class="row" id="dare-timer-seconds-row" style="display:none">
              <label>Секунд: <input type="number" id="dare-timer-seconds" value="60" min="5" max="600" style="width:70px" /></label>
              <span class="hint" id="dare-timer-music-hint"></span>
            </div>
            <div class="error-box" id="add-dare-error"></div>
            <div class="row-actions" style="margin-top:8px">
              <button type="submit" class="btn" id="dare-submit-btn">Добавить</button>
              <button type="button" class="btn secondary" id="dare-cancel-edit-btn">Отмена</button>
            </div>
          </form>
        </div>

        ${pendingReviewCard("dares", "На проверке (предложено игроками)")}

        <div class="card">
          <div class="row-actions" style="justify-content:space-between;align-items:center;margin-bottom:10px">
            <h2 style="margin:0">Активные фанты</h2>
            <div class="prompt-count" id="dares-count"></div>
          </div>
          <div class="filter-bar">
            <input type="text" id="dares-filter-search" class="filter-input" placeholder="Поиск по тексту..." />
            <select id="dares-filter-kind" class="filter-input">
              <option value="">Тип: все</option>
              <option value="solo">Один</option>
              <option value="team">Командный</option>
            </select>
            <select id="dares-filter-location" class="filter-input">${selectOptions(LOCATIONS, "Место: все")}</select>
            <select id="dares-filter-category" class="filter-input">${selectOptions(MOOD_CATEGORIES, "Категория: все")}</select>
            <select id="dares-filter-attribute" class="filter-input">${selectOptions(ATTRIBUTES, "Атрибут: все")}</select>
            <label class="filter-checkbox"><input type="checkbox" id="dares-filter-mixed" /> Только М+Ж</label>
            <label class="filter-checkbox"><input type="checkbox" id="dares-filter-timer" /> С таймером</label>
            <label class="filter-checkbox"><input type="checkbox" id="dares-filter-music" /> С музыкой</label>
          </div>
          <div id="dares-table"></div>
        </div>
      </div>

      <div id="fanty-subsection-truths" style="display:none">
        <div class="card">
          <div class="row-actions" style="justify-content:space-between;align-items:center">
            <h2 style="margin:0">Вопросы (правда)</h2>
            <button class="btn" id="truth-add-btn">+ Добавить новый</button>
          </div>
          <form id="add-truth-form" style="display:none;margin-top:16px">
            <h3 style="margin-top:0" id="truth-form-heading">Добавить вручную</h3>
            <label>Текст вопроса</label>
            <textarea name="text" maxlength="300" placeholder="Бил ли ты когда-нибудь животное?" required></textarea>
            <label>Категория</label>
            <div class="row" id="truth-category"></div>
            <div class="error-box" id="add-truth-error"></div>
            <div class="row-actions" style="margin-top:8px">
              <button type="submit" class="btn" id="truth-submit-btn">Добавить</button>
              <button type="button" class="btn secondary" id="truth-cancel-edit-btn">Отмена</button>
            </div>
          </form>
        </div>

        ${pendingReviewCard("truths", "На проверке (предложено игроками)")}

        <div class="card">
          <div class="row-actions" style="justify-content:space-between;align-items:center;margin-bottom:10px">
            <h2 style="margin:0">Активные вопросы</h2>
            <div class="prompt-count" id="truths-count"></div>
          </div>
          <div class="filter-bar">
            <input type="text" id="truths-filter-search" class="filter-input" placeholder="Поиск по тексту..." />
            <select id="truths-filter-category" class="filter-input">${selectOptions(MOOD_CATEGORIES, "Категория: все")}</select>
          </div>
          <div id="truths-table"></div>
        </div>
      </div>
    </div>

    <div id="section-users" style="display:none">
      <div class="card">
        <h2 style="margin-top:0">Зарегистрированные пользователи</h2>
        <div id="users-table"></div>
      </div>
    </div>

    <div id="section-rooms" style="display:none">
      <div class="card">
        <div class="row-actions" style="justify-content:space-between;align-items:center;margin-bottom:8px">
          <h2 style="margin:0">Открытые комнаты</h2>
          <button class="btn secondary" id="rooms-refresh-btn">Обновить</button>
        </div>
        <p class="hint">Комнаты закрываются автоматически через час без активности. Удаление здесь — принудительное и сразу.</p>
        <div id="rooms-table"></div>
      </div>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    renderLogin();
  });

  setupTabs(document.querySelectorAll("#main-tabs .tab-btn"), {
    prompts: document.getElementById("section-prompts"),
    fanty: document.getElementById("section-fanty"),
    users: document.getElementById("section-users"),
    rooms: document.getElementById("section-rooms"),
  });
  setupTabs(document.querySelectorAll("#fanty-tabs .tab-btn"), {
    dares: document.getElementById("fanty-subsection-dares"),
    truths: document.getElementById("fanty-subsection-truths"),
  });

  const promptForm = document.getElementById("add-form");
  const promptFormHeading = document.getElementById("prompt-form-heading");
  const promptSubmitBtn = document.getElementById("prompt-submit-btn");
  const promptCancelEditBtn = document.getElementById("prompt-cancel-edit-btn");
  const promptAddBtn = document.getElementById("prompt-add-btn");
  let editingPromptId = null;

  function resetPromptForm() {
    promptForm.reset();
    editingPromptId = null;
    promptFormHeading.textContent = "Добавить вручную";
    promptSubmitBtn.textContent = "Добавить";
  }

  promptAddBtn.addEventListener("click", () => {
    resetPromptForm();
    promptForm.style.display = "";
    promptForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.startEditingPrompt = function (prompt) {
    editingPromptId = prompt.id;
    promptForm.elements.text.value = prompt.text;
    promptFormHeading.textContent = `Редактировать вопрос #${prompt.id}`;
    promptSubmitBtn.textContent = "Сохранить изменения";
    promptForm.style.display = "";
    promptForm.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  promptCancelEditBtn.addEventListener("click", () => {
    resetPromptForm();
    promptForm.style.display = "none";
  });

  promptForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const textarea = e.target.elements.text;
    const errorEl = document.getElementById("add-error");
    errorEl.textContent = "";
    const text = textarea.value.trim();
    if (!text) return;
    try {
      if (editingPromptId) {
        await api(`/prompts/${editingPromptId}`, { method: "PUT", body: JSON.stringify({ text }) });
      } else {
        await api("/prompts", { method: "POST", body: JSON.stringify({ text }) });
      }
      resetPromptForm();
      promptForm.style.display = "none";
      await refreshPrompts();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  document.getElementById("gen-btn").addEventListener("click", async () => {
    const btn = document.getElementById("gen-btn");
    const errorEl = document.getElementById("gen-error");
    const successEl = document.getElementById("gen-success");
    errorEl.textContent = "";
    successEl.textContent = "";
    const count = parseInt(document.getElementById("gen-count").value, 10) || 10;
    const theme = document.getElementById("gen-theme").value.trim();

    btn.disabled = true;
    btn.textContent = "Генерирую...";
    try {
      const res = await api("/prompts/generate", {
        method: "POST",
        body: JSON.stringify({ count, theme }),
      });
      const skipped = res.generated - res.added;
      successEl.textContent =
        `Добавлено на проверку ${res.added} из ${res.generated} сгенерированных` +
        (skipped > 0 ? ` (${skipped} оказались дубликатами и пропущены)` : "") +
        (res.model ? ` — модель: ${res.model}` : "") +
        ". Проверьте текст и активируйте нужные ниже.";
      await refreshPrompts();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Сгенерировать";
    }
  });

  document.getElementById("dare-locations").innerHTML = checkboxRow(LOCATIONS, "location");
  document.getElementById("dare-category").innerHTML = radioRow(MOOD_CATEGORIES, "category", "basic");
  document.getElementById("dare-attributes").innerHTML = checkboxRow(ATTRIBUTES, "attribute");
  document.getElementById("truth-category").innerHTML = radioRow(MOOD_CATEGORIES, "category", "basic");

  const dareForm = document.getElementById("add-dare-form");
  const dareAddBtn = document.getElementById("dare-add-btn");
  const mixedPairRow = document.getElementById("dare-mixed-pair-row");
  function updateMixedPairVisibility() {
    mixedPairRow.style.display = dareForm.elements.kind.value === "team" ? "" : "none";
  }
  dareForm.querySelectorAll('input[name="kind"]').forEach((el) => el.addEventListener("change", updateMixedPairVisibility));
  updateMixedPairVisibility();

  const timerSecondsRow = document.getElementById("dare-timer-seconds-row");
  const hasTimerCheckbox = document.getElementById("dare-has-timer");
  const timerSecondsInput = document.getElementById("dare-timer-seconds");
  const timerMusicHint = document.getElementById("dare-timer-music-hint");

  let uploadedAudioFilename = null;
  let uploadedAudioOriginalName = null;
  let musicStartSeconds = 0;
  let musicDuration = 0;
  let musicStopTimer = null;
  let musicIsPlaying = false;
  let musicRafId = null;
  let musicDragAnchorOffset = null;
  const audioInput = document.getElementById("dare-audio-input");
  const audioStatus = document.getElementById("dare-audio-status");
  const musicEditor = document.getElementById("dare-music-editor");
  const musicPreviewEl = document.getElementById("dare-music-preview");
  const musicTimeline = document.getElementById("dare-music-timeline");
  const musicFogLeft = document.getElementById("dare-music-fog-left");
  const musicWindowEl = document.getElementById("dare-music-window");
  const musicFogRight = document.getElementById("dare-music-fog-right");
  const musicPlayhead = document.getElementById("dare-music-playhead");
  const musicRangeLabel = document.getElementById("dare-music-range-label");
  const musicPlayBtn = document.getElementById("dare-music-play-btn");

  function updateTimerSecondsVisibility() {
    const show = hasTimerCheckbox.checked || Boolean(uploadedAudioFilename);
    timerSecondsRow.style.display = show ? "" : "none";
    timerMusicHint.textContent =
      uploadedAudioFilename && !hasTimerCheckbox.checked ? "(это же длина отрывка музыки)" : "";
  }
  hasTimerCheckbox.addEventListener("change", updateTimerSecondsVisibility);
  updateTimerSecondsVisibility();

  function formatTime(sec) {
    sec = Math.max(0, Math.round(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }

  function currentTimerSeconds() {
    return parseInt(timerSecondsInput.value, 10) || 60;
  }

  function updateTimelineUI() {
    if (!musicDuration) {
      musicRangeLabel.textContent = "";
      return;
    }
    const timerSeconds = currentTimerSeconds();
    const maxStart = Math.max(0, musicDuration - timerSeconds);
    musicStartSeconds = Math.min(maxStart, Math.max(0, musicStartSeconds));
    const end = Math.min(musicDuration, musicStartSeconds + timerSeconds);
    const startPct = (musicStartSeconds / musicDuration) * 100;
    const endPct = (end / musicDuration) * 100;
    musicFogLeft.style.width = `${startPct}%`;
    musicWindowEl.style.left = `${startPct}%`;
    musicWindowEl.style.width = `${Math.max(0, endPct - startPct)}%`;
    musicFogRight.style.left = `${endPct}%`;
    musicFogRight.style.width = `${Math.max(0, 100 - endPct)}%`;
    musicRangeLabel.textContent =
      `${formatTime(musicStartSeconds)}–${formatTime(end)} (${timerSeconds} сек из ${formatTime(musicDuration)})`;
  }

  function updatePlayheadPosition() {
    if (!musicDuration) return;
    const pct = Math.min(100, Math.max(0, (musicPreviewEl.currentTime / musicDuration) * 100));
    musicPlayhead.style.left = `${pct}%`;
  }

  function trackPlayhead() {
    updatePlayheadPosition();
    if (musicIsPlaying) musicRafId = requestAnimationFrame(trackPlayhead);
  }

  function setPlayingState(isPlaying) {
    musicIsPlaying = isPlaying;
    musicPlayBtn.textContent = isPlaying ? "⏸ Остановить" : "▶️ Прослушать отрывок";
    musicPlayhead.style.opacity = isPlaying ? "1" : "0";
  }

  function stopPreview() {
    if (musicRafId) {
      cancelAnimationFrame(musicRafId);
      musicRafId = null;
    }
    if (musicStopTimer) {
      clearTimeout(musicStopTimer);
      musicStopTimer = null;
    }
    musicPreviewEl.pause();
    setPlayingState(false);
  }

  function playPreview() {
    const timerSeconds = currentTimerSeconds();
    stopPreview();
    musicPreviewEl.currentTime = musicStartSeconds;
    musicPreviewEl.play().catch(() => {});
    setPlayingState(true);
    trackPlayhead();
    musicStopTimer = setTimeout(stopPreview, timerSeconds * 1000);
  }

  musicPlayBtn.addEventListener("click", () => {
    if (musicIsPlaying) stopPreview();
    else playPreview();
  });
  musicPreviewEl.addEventListener("ended", stopPreview);

  function timeFromClientX(clientX) {
    const rect = musicTimeline.getBoundingClientRect();
    const ratio = rect.width ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    return ratio * musicDuration;
  }

  musicTimeline.addEventListener("pointerdown", (e) => {
    if (!musicDuration) return;
    musicTimeline.setPointerCapture(e.pointerId);
    const timerSeconds = currentTimerSeconds();
    const clickTime = timeFromClientX(e.clientX);
    const windowEnd = musicStartSeconds + timerSeconds;
    musicDragAnchorOffset =
      clickTime >= musicStartSeconds && clickTime <= windowEnd ? clickTime - musicStartSeconds : timerSeconds / 2;
    const maxStart = Math.max(0, musicDuration - timerSeconds);
    musicStartSeconds = Math.min(maxStart, Math.max(0, clickTime - musicDragAnchorOffset));
    updateTimelineUI();
  });

  musicTimeline.addEventListener("pointermove", (e) => {
    if (musicDragAnchorOffset === null) return;
    const timerSeconds = currentTimerSeconds();
    const clickTime = timeFromClientX(e.clientX);
    const maxStart = Math.max(0, musicDuration - timerSeconds);
    musicStartSeconds = Math.min(maxStart, Math.max(0, clickTime - musicDragAnchorOffset));
    updateTimelineUI();
  });

  function endMusicDrag(e) {
    if (musicDragAnchorOffset === null) return;
    musicDragAnchorOffset = null;
    try {
      musicTimeline.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* pointer already released */
    }
  }
  musicTimeline.addEventListener("pointerup", endMusicDrag);
  musicTimeline.addEventListener("pointercancel", endMusicDrag);

  function showMusicEditor(url, startSeconds) {
    musicStartSeconds = startSeconds || 0;
    musicDuration = 0;
    musicEditor.style.display = "";
    musicPlayhead.style.opacity = "0";
    musicPreviewEl.src = url;
    musicPreviewEl.addEventListener(
      "loadedmetadata",
      () => {
        musicDuration = musicPreviewEl.duration || 0;
        updateTimelineUI();
      },
      { once: true }
    );
  }

  function hideMusicEditor() {
    stopPreview();
    musicEditor.style.display = "none";
    musicPreviewEl.removeAttribute("src");
    musicPreviewEl.load();
    musicStartSeconds = 0;
    musicDuration = 0;
  }

  timerSecondsInput.addEventListener("input", () => {
    if (uploadedAudioFilename) updateTimelineUI();
    updateTimerSecondsVisibility();
  });

  audioInput.addEventListener("change", async () => {
    const file = audioInput.files && audioInput.files[0];
    if (!file) return;
    uploadedAudioFilename = null;
    uploadedAudioOriginalName = null;
    hideMusicEditor();
    audioStatus.textContent = "Загрузка...";
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api("/fanty/upload-audio", { method: "POST", body: form });
      uploadedAudioFilename = res.filename;
      uploadedAudioOriginalName = res.originalName || file.name;
      audioStatus.textContent = `Загружено: ${uploadedAudioOriginalName}`;
      showMusicEditor(`/uploads/${uploadedAudioFilename}`, 0);
      updateTimerSecondsVisibility();
    } catch (err) {
      audioStatus.textContent = err.message;
      audioInput.value = "";
    }
  });

  let editingDareId = null;
  const dareFormHeading = document.getElementById("dare-form-heading");
  const dareSubmitBtn = document.getElementById("dare-submit-btn");
  const dareCancelEditBtn = document.getElementById("dare-cancel-edit-btn");

  function resetDareForm() {
    dareForm.reset();
    updateMixedPairVisibility();
    uploadedAudioFilename = null;
    uploadedAudioOriginalName = null;
    audioStatus.textContent = "";
    hideMusicEditor();
    updateTimerSecondsVisibility();
    document.getElementById("dare-timer-seconds").value = 60;
    editingDareId = null;
    dareFormHeading.textContent = "Добавить вручную";
    dareSubmitBtn.textContent = "Добавить";
  }

  dareAddBtn.addEventListener("click", () => {
    resetDareForm();
    dareForm.style.display = "";
    dareForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.startEditingDare = function (dare) {
    editingDareId = dare.id;
    dareForm.elements.text.value = dare.text;
    dareForm.querySelector(`input[name="kind"][value="${dare.kind}"]`).checked = true;
    dareForm.elements.mixedPair.checked = dare.mixedPair;
    updateMixedPairVisibility();

    dareForm.querySelectorAll('input[name="location"]').forEach((el) => {
      el.checked = dare.locations.includes(el.value);
    });
    const moodValue = MOOD_CATEGORIES.find((m) => dare.categories.includes(m.value))?.value || "basic";
    dareForm.querySelector(`input[name="category"][value="${moodValue}"]`).checked = true;
    dareForm.querySelectorAll('input[name="attribute"]').forEach((el) => {
      el.checked = dare.categories.includes(el.value);
    });

    hasTimerCheckbox.checked = dare.hasTimer;
    document.getElementById("dare-timer-seconds").value = dare.timerSeconds || 60;

    uploadedAudioFilename = dare.musicUrl ? dare.musicUrl.split("/").pop() : null;
    uploadedAudioOriginalName = dare.musicOriginalName || uploadedAudioFilename;
    audioInput.value = "";
    if (dare.musicUrl) {
      audioStatus.textContent = `Текущий файл: ${uploadedAudioOriginalName}`;
      showMusicEditor(dare.musicUrl, dare.musicStartSeconds || 0);
    } else {
      audioStatus.textContent = "";
      hideMusicEditor();
    }
    updateTimerSecondsVisibility();

    dareFormHeading.textContent = `Редактировать фант #${dare.id}`;
    dareSubmitBtn.textContent = "Сохранить изменения";
    dareForm.style.display = "";
    dareForm.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  dareCancelEditBtn.addEventListener("click", () => {
    resetDareForm();
    dareForm.style.display = "none";
  });

  dareForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const text = form.elements.text.value.trim();
    const kind = form.elements.kind.value;
    const mixedPair = kind === "team" && form.elements.mixedPair.checked;
    const locations = Array.from(form.querySelectorAll('input[name="location"]:checked')).map((i) => i.value);
    const attributes = Array.from(form.querySelectorAll('input[name="attribute"]:checked')).map((i) => i.value);
    const categories = [form.elements.category.value, ...attributes];
    const hasTimer = document.getElementById("dare-has-timer").checked;
    const timerSeconds = parseInt(document.getElementById("dare-timer-seconds").value, 10) || 60;
    const errorEl = document.getElementById("add-dare-error");
    errorEl.textContent = "";
    if (!text) return;
    const payload = {
      text,
      kind,
      mixedPair,
      locations,
      categories,
      musicFilename: uploadedAudioFilename,
      musicOriginalName: uploadedAudioOriginalName,
      musicStartSeconds: uploadedAudioFilename ? musicStartSeconds : 0,
      hasTimer,
      timerSeconds,
    };
    try {
      if (editingDareId) {
        await api(`/fanty/dares/${editingDareId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/fanty/dares", { method: "POST", body: JSON.stringify(payload) });
      }
      resetDareForm();
      dareForm.style.display = "none";
      await refreshDares();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  const truthForm = document.getElementById("add-truth-form");
  const truthAddBtn = document.getElementById("truth-add-btn");
  const truthFormHeading = document.getElementById("truth-form-heading");
  const truthSubmitBtn = document.getElementById("truth-submit-btn");
  const truthCancelEditBtn = document.getElementById("truth-cancel-edit-btn");
  let editingTruthId = null;

  function resetTruthForm() {
    truthForm.reset();
    editingTruthId = null;
    truthFormHeading.textContent = "Добавить вручную";
    truthSubmitBtn.textContent = "Добавить";
  }

  truthAddBtn.addEventListener("click", () => {
    resetTruthForm();
    truthForm.style.display = "";
    truthForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.startEditingTruth = function (truth) {
    editingTruthId = truth.id;
    truthForm.elements.text.value = truth.text;
    const moodValue = MOOD_CATEGORIES.find((m) => truth.categories.includes(m.value))?.value || "basic";
    truthForm.querySelector(`input[name="category"][value="${moodValue}"]`).checked = true;
    truthFormHeading.textContent = `Редактировать вопрос #${truth.id}`;
    truthSubmitBtn.textContent = "Сохранить изменения";
    truthForm.style.display = "";
    truthForm.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  truthCancelEditBtn.addEventListener("click", () => {
    resetTruthForm();
    truthForm.style.display = "none";
  });

  truthForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const text = form.elements.text.value.trim();
    const categories = [form.elements.category.value];
    const errorEl = document.getElementById("add-truth-error");
    errorEl.textContent = "";
    if (!text) return;
    try {
      if (editingTruthId) {
        await api(`/fanty/truths/${editingTruthId}`, { method: "PUT", body: JSON.stringify({ text, categories }) });
      } else {
        await api("/fanty/truths", { method: "POST", body: JSON.stringify({ text, categories }) });
      }
      resetTruthForm();
      truthForm.style.display = "none";
      await refreshTruths();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  document.getElementById("rooms-refresh-btn").addEventListener("click", refreshRooms);

  wireFilterInputs("prompts", ["prompts-filter-search"], refreshPromptsTable);
  wireFilterInputs(
    "dares",
    [
      "dares-filter-search",
      "dares-filter-kind",
      "dares-filter-location",
      "dares-filter-category",
      "dares-filter-attribute",
      "dares-filter-mixed",
      "dares-filter-timer",
      "dares-filter-music",
    ],
    refreshDaresTable
  );
  wireFilterInputs("truths", ["truths-filter-search", "truths-filter-category"], refreshTruthsTable);

  await refreshPrompts();
  await refreshDares();
  await refreshTruths();
  await refreshUsers();
  await refreshRooms();
}

function wireFilterInputs(idPrefix, ids, onChange) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", onChange);
  });
}

function pendingTagsHtml(item) {
  const parts = [];
  if (item.createdBy) parts.push(`<span class="tag-pill tag-author">👤 ${escapeHtml(item.createdBy)}</span>`);
  if (item.likes) parts.push(`<span class="tag-pill tag-likes">🔥 ${item.likes}</span>`);
  if (item.kind === "team") parts.push('<span class="tag-pill tag-kind">командный</span>');
  if (item.kind === "team" && item.mixedPair) parts.push('<span class="tag-pill tag-mixed">М+Ж</span>');
  if (item.musicUrl) parts.push('<span class="tag-pill tag-music">🎵 музыка</span>');
  if (item.hasTimer) parts.push(`<span class="tag-pill tag-timer">⏱ ${item.timerSeconds}с</span>`);
  (item.locations || []).forEach((l) => {
    parts.push(`<span class="tag-pill tag-location">${escapeHtml(labelFor(LOCATIONS, l))}</span>`);
  });
  (item.categories || []).forEach((c) => {
    const isAttribute = ATTRIBUTES.some((a) => a.value === c);
    const list = isAttribute ? ATTRIBUTES : MOOD_CATEGORIES;
    const cls = isAttribute ? "tag-attribute" : "tag-category";
    parts.push(`<span class="tag-pill ${cls}">${escapeHtml(labelFor(list, c))}</span>`);
  });
  return parts.join(" ");
}

function iconActionsHtml(id, onEdit) {
  return `
    <div class="icon-btn-row">
      ${onEdit ? `<button class="icon-btn" data-edit="${id}" title="Редактировать" aria-label="Редактировать">✏️</button>` : ""}
      <button class="icon-btn icon-btn-danger" data-delete="${id}" title="Удалить" aria-label="Удалить">🗑️</button>
    </div>
  `;
}

function wireBulkToolbar(host, apiBase, refreshFn) {
  const selectAll = host.querySelector(".select-all-pending");
  const activateBulkBtn = host.querySelector(".bulk-activate-btn");
  const deleteBulkBtn = host.querySelector(".bulk-delete-btn");
  const checkboxes = () => Array.from(host.querySelectorAll(".pending-check"));

  function updateToolbar() {
    const count = checkboxes().filter((c) => c.checked).length;
    activateBulkBtn.disabled = count === 0;
    deleteBulkBtn.disabled = count === 0;
    activateBulkBtn.textContent = `Активировать выбранные (${count})`;
    deleteBulkBtn.textContent = `Удалить выбранные (${count})`;
    selectAll.checked = count > 0 && count === checkboxes().length;
    selectAll.indeterminate = count > 0 && count < checkboxes().length;
  }

  selectAll.addEventListener("change", () => {
    checkboxes().forEach((c) => (c.checked = selectAll.checked));
    updateToolbar();
  });
  checkboxes().forEach((c) => c.addEventListener("change", updateToolbar));

  activateBulkBtn.addEventListener("click", async () => {
    const ids = checkboxes()
      .filter((c) => c.checked)
      .map((c) => parseInt(c.dataset.id, 10));
    activateBulkBtn.disabled = true;
    try {
      await api(`${apiBase}/bulk-activate`, { method: "POST", body: JSON.stringify({ ids }) });
      await refreshFn();
    } catch (err) {
      alert(err.message);
      activateBulkBtn.disabled = false;
    }
  });

  deleteBulkBtn.addEventListener("click", async () => {
    const ids = checkboxes()
      .filter((c) => c.checked)
      .map((c) => parseInt(c.dataset.id, 10));
    if (!confirm(`Удалить выбранные (${ids.length})?`)) return;
    deleteBulkBtn.disabled = true;
    try {
      const res = await api(`${apiBase}/bulk-delete`, { method: "POST", body: JSON.stringify({ ids }) });
      if (res.blocked > 0) {
        alert(`Удалено ${res.deleted}, но ${res.blocked} уже использовались в игре и не были удалены.`);
      }
      await refreshFn();
    } catch (err) {
      alert(err.message);
      deleteBulkBtn.disabled = false;
    }
  });
}

function wireDeleteButtons(host, apiBase, refreshFn) {
  host.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Удалить этот элемент?")) return;
      btn.disabled = true;
      try {
        await api(`${apiBase}/${btn.dataset.delete}`, { method: "DELETE" });
        await refreshFn();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

function wireEditButtons(host, all, onEdit) {
  if (!onEdit) return;
  host.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = all.find((x) => String(x.id) === btn.dataset.edit);
      if (item) onEdit(item);
    });
  });
}

function renderPendingSection(idPrefix, apiBase, pending, all, onEdit, refreshFn, textLabel) {
  const pendingCard = document.getElementById(`${idPrefix}-pending-card`);
  const pendingHost = document.getElementById(`${idPrefix}-pending-table`);
  if (pending.length === 0) {
    pendingCard.style.display = "none";
    return;
  }
  pendingCard.style.display = "";
  const rows = pending
    .map(
      (p) => `
      <tr data-id="${p.id}">
        <td><input type="checkbox" class="pending-check" data-id="${p.id}" /></td>
        <td>${escapeHtml(p.text)}${pendingTagsHtml(p) ? `<br/>${pendingTagsHtml(p)}` : ""}</td>
        <td>
          <div class="row-actions">
            <button class="btn" data-activate="${p.id}">Активировать</button>
            ${iconActionsHtml(p.id, onEdit)}
          </div>
        </td>
      </tr>
    `
    )
    .join("");
  pendingHost.innerHTML = `
    <div class="row-actions" style="margin-bottom:10px">
      <button class="btn secondary bulk-activate-btn" disabled>Активировать выбранные (0)</button>
      <button class="btn danger bulk-delete-btn" disabled>Удалить выбранные (0)</button>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" class="select-all-pending" /></th>
            <th>${textLabel}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  wireBulkToolbar(pendingHost, apiBase, refreshFn);

  pendingHost.querySelectorAll("[data-activate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api(`${apiBase}/${btn.dataset.activate}/activate`, { method: "POST" });
        await refreshFn();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
  wireDeleteButtons(pendingHost, apiBase, refreshFn);
  wireEditButtons(pendingHost, all, onEdit);
}

function renderColumnTable(host, apiBase, items, columns, onEdit, refreshFn) {
  if (items.length === 0) {
    host.innerHTML = `<p class="hint">Ничего не найдено.</p>`;
    return;
  }
  const headRow = columns.map((c) => `<th>${c.label}</th>`).join("") + "<th></th>";
  const rows = items
    .map(
      (item) => `
      <tr data-id="${item.id}">
        ${columns.map((c) => `<td class="${c.cellClass || ""}">${c.render(item)}</td>`).join("")}
        <td>${iconActionsHtml(item.id, onEdit)}</td>
      </tr>
    `
    )
    .join("");
  host.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr>${headRow}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  wireDeleteButtons(host, apiBase, refreshFn);
  wireEditButtons(host, items, onEdit);
}

function pillsHtml(values, list, cls) {
  if (!values || values.length === 0) return `<span class="hint">—</span>`;
  return values.map((v) => `<span class="tag-pill ${cls}">${escapeHtml(labelFor(list, v))}</span>`).join(" ");
}

// ---- Prompts ("Продолжи предложение") ----

let allPrompts = [];

async function refreshPrompts() {
  allPrompts = await api("/prompts");
  refreshPromptsTable();
}

function refreshPromptsTable() {
  const pending = allPrompts.filter((p) => p.status === "pending");
  let active = allPrompts.filter((p) => p.status !== "pending");

  renderPendingSection("prompts", "/prompts", pending, allPrompts, startEditingPrompt, refreshPrompts, "Фраза");

  const search = document.getElementById("prompts-filter-search").value.trim().toLowerCase();
  if (search) active = active.filter((p) => p.text.toLowerCase().includes(search));

  document.getElementById("prompts-count").textContent = `Показано: ${active.length} из ${allPrompts.filter((p) => p.status !== "pending").length}`;

  const columns = [
    { label: "Текст", cellClass: "col-text", render: (p) => escapeHtml(p.text) },
    { label: "🔥", render: (p) => p.likes || 0 },
    { label: "Исп.", render: (p) => p.uses },
  ];
  renderColumnTable(document.getElementById("prompts-table"), "/prompts", active, columns, startEditingPrompt, refreshPrompts);
}

// ---- Fanty dares ----

let allDares = [];

async function refreshDares() {
  allDares = await api("/fanty/dares");
  refreshDaresTable();
}

function refreshDaresTable() {
  const pending = allDares.filter((p) => p.status === "pending");
  let active = allDares.filter((p) => p.status !== "pending");

  renderPendingSection("dares", "/fanty/dares", pending, allDares, startEditingDare, refreshDares, "Текст");

  const search = document.getElementById("dares-filter-search").value.trim().toLowerCase();
  const kindFilter = document.getElementById("dares-filter-kind").value;
  const locationFilter = document.getElementById("dares-filter-location").value;
  const categoryFilter = document.getElementById("dares-filter-category").value;
  const attributeFilter = document.getElementById("dares-filter-attribute").value;
  const mixedOnly = document.getElementById("dares-filter-mixed").checked;
  const timerOnly = document.getElementById("dares-filter-timer").checked;
  const musicOnly = document.getElementById("dares-filter-music").checked;

  if (search) active = active.filter((d) => d.text.toLowerCase().includes(search));
  if (kindFilter) active = active.filter((d) => d.kind === kindFilter);
  if (locationFilter) active = active.filter((d) => d.locations.includes(locationFilter));
  if (categoryFilter) active = active.filter((d) => d.categories.includes(categoryFilter));
  if (attributeFilter) active = active.filter((d) => d.categories.includes(attributeFilter));
  if (mixedOnly) active = active.filter((d) => d.mixedPair);
  if (timerOnly) active = active.filter((d) => d.hasTimer);
  if (musicOnly) active = active.filter((d) => Boolean(d.musicUrl));

  document.getElementById("dares-count").textContent = `Показано: ${active.length} из ${allDares.filter((p) => p.status !== "pending").length}`;

  const columns = [
    { label: "Текст", cellClass: "col-text", render: (d) => escapeHtml(d.text) },
    { label: "Автор", render: (d) => escapeHtml(d.createdBy || "—") },
    {
      label: "Тип",
      render: (d) => (d.kind === "team" ? "Командный" + (d.mixedPair ? " (М+Ж)" : "") : "Один"),
    },
    { label: "Места", render: (d) => pillsHtml(d.locations, LOCATIONS, "tag-location") },
    {
      label: "Категория",
      render: (d) => pillsHtml(d.categories.filter((c) => MOOD_CATEGORIES.some((m) => m.value === c)), MOOD_CATEGORIES, "tag-category"),
    },
    {
      label: "Атрибуты",
      render: (d) => pillsHtml(d.categories.filter((c) => ATTRIBUTES.some((a) => a.value === c)), ATTRIBUTES, "tag-attribute"),
    },
    { label: "Таймер", render: (d) => (d.hasTimer ? `⏱ ${d.timerSeconds}с` : `<span class="hint">—</span>`) },
    {
      label: "Музыка",
      render: (d) => (d.musicUrl ? `🎵` : `<span class="hint">—</span>`),
    },
    { label: "🔥", render: (d) => d.likes || 0 },
    { label: "Исп.", render: (d) => d.uses },
  ];
  renderColumnTable(document.getElementById("dares-table"), "/fanty/dares", active, columns, startEditingDare, refreshDares);
}

// ---- Fanty truths ----

let allTruths = [];

async function refreshTruths() {
  allTruths = await api("/fanty/truths");
  refreshTruthsTable();
}

function refreshTruthsTable() {
  const pending = allTruths.filter((p) => p.status === "pending");
  let active = allTruths.filter((p) => p.status !== "pending");

  renderPendingSection("truths", "/fanty/truths", pending, allTruths, startEditingTruth, refreshTruths, "Текст");

  const search = document.getElementById("truths-filter-search").value.trim().toLowerCase();
  const categoryFilter = document.getElementById("truths-filter-category").value;
  if (search) active = active.filter((t) => t.text.toLowerCase().includes(search));
  if (categoryFilter) active = active.filter((t) => t.categories.includes(categoryFilter));

  document.getElementById("truths-count").textContent = `Показано: ${active.length} из ${allTruths.filter((p) => p.status !== "pending").length}`;

  const columns = [
    { label: "Текст", cellClass: "col-text", render: (t) => escapeHtml(t.text) },
    { label: "Автор", render: (t) => escapeHtml(t.createdBy || "—") },
    { label: "Категория", render: (t) => pillsHtml(t.categories, MOOD_CATEGORIES, "tag-category") },
    { label: "🔥", render: (t) => t.likes || 0 },
    { label: "Исп.", render: (t) => t.uses },
  ];
  renderColumnTable(document.getElementById("truths-table"), "/fanty/truths", active, columns, startEditingTruth, refreshTruths);
}

// ---- Users ----

async function refreshUsers() {
  const users = await api("/users");
  const host = document.getElementById("users-table");
  if (users.length === 0) {
    host.innerHTML = `<p class="hint">Пока нет зарегистрированных пользователей.</p>`;
    return;
  }
  const rows = users
    .map(
      (u) => `
      <tr>
        <td>${escapeHtml(u.email)}${
        u.emailVerified ? "" : ' <span class="tag-pill tag-pending">не подтверждён</span>'
      }</td>
        <td>${escapeHtml(u.name || "—")}</td>
        <td>${u.gamesCreated}</td>
        <td>${escapeHtml(u.createdAt)}</td>
      </tr>
    `
    )
    .join("");
  host.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Email</th><th>Имя</th><th>Игр создано</th><th>Регистрация</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

const ROOM_GAME_TYPE_LABEL = { fanty: "Фанты", sentence: "Продолжи предложение" };

async function refreshRooms() {
  const rooms = await api("/rooms");
  const host = document.getElementById("rooms-table");
  if (rooms.length === 0) {
    host.innerHTML = `<p class="hint">Нет открытых комнат.</p>`;
    return;
  }
  const rows = rooms
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.code)}</td>
        <td>${escapeHtml(ROOM_GAME_TYPE_LABEL[r.gameType] || r.gameType)}</td>
        <td>${escapeHtml(r.status)}</td>
        <td>${escapeHtml(r.hostName || "—")}${
        r.hostAuthenticated
          ? ` <span class="tag-pill tag-author" title="${escapeHtml(r.hostEmail || "")}">аккаунт</span>`
          : ` <span class="tag-pill tag-kind">аноним</span>`
      }${
        r.hostRoomCount > 1
          ? ` <span class="tag-pill tag-timer" title="${
              r.hostAuthenticated
                ? "Этот аккаунт — хост ещё " + (r.hostRoomCount - 1) + " комнат(ы) из списка ниже"
                : "Совпадение имени и аватарки с ещё " + (r.hostRoomCount - 1) + " комнатой(ами) ниже — возможно, тот же человек"
            }">×${r.hostRoomCount}</span>`
          : ""
      }</td>
        <td>${r.playerCount}</td>
        <td>${r.roundsPlayed}</td>
        <td>${escapeHtml(r.createdAt)}</td>
        <td>${r.idleMinutes} мин</td>
        <td><button class="icon-btn icon-btn-danger" data-delete-room="${r.code}" title="Удалить" aria-label="Удалить">🗑️</button></td>
      </tr>
    `
    )
    .join("");
  host.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Код</th><th>Игра</th><th>Статус</th><th>Хост</th><th>Игроков</th>
            <th>Раундов</th><th>Создана</th><th>Простой</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  host.querySelectorAll("[data-delete-room]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Удалить комнату ${btn.dataset.deleteRoom}? Это необратимо.`)) return;
      btn.disabled = true;
      try {
        await api(`/rooms/${btn.dataset.deleteRoom}`, { method: "DELETE" });
        await refreshRooms();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

main();
