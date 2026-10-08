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
    </div>

    <div id="section-prompts">
      <div class="card">
        <h2 style="margin-top:0" id="prompt-form-heading">Добавить вручную</h2>
        <form id="add-form">
          <label>Текст фразы (начало предложения)</label>
          <textarea name="text" maxlength="300" placeholder="Если бы я был..." required></textarea>
          <div class="error-box" id="add-error"></div>
          <div class="row-actions" style="margin-top:8px">
            <button type="submit" class="btn" id="prompt-submit-btn">Добавить</button>
            <button type="button" class="btn secondary" id="prompt-cancel-edit-btn" style="display:none">Отмена</button>
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
        <h2 style="margin-top:0">Активные вопросы</h2>
        <div class="prompt-count" id="prompts-count"></div>
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
          <h2 style="margin-top:0" id="dare-form-heading">Добавить вручную</h2>
          <form id="add-dare-form">
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
            <div class="row">
              <label><input type="checkbox" id="dare-has-timer" /> Таймер</label>
            </div>
            <div class="row" id="dare-timer-seconds-row" style="display:none">
              <label>Секунд: <input type="number" id="dare-timer-seconds" value="60" min="5" max="600" style="width:70px" /></label>
            </div>
            <div class="error-box" id="add-dare-error"></div>
            <div class="row-actions" style="margin-top:8px">
              <button type="submit" class="btn" id="dare-submit-btn">Добавить</button>
              <button type="button" class="btn secondary" id="dare-cancel-edit-btn" style="display:none">Отмена</button>
            </div>
          </form>
        </div>

        ${pendingReviewCard("dares", "На проверке (предложено игроками)")}

        <div class="card">
          <h2 style="margin-top:0">Активные фанты</h2>
          <div class="prompt-count" id="dares-count"></div>
          <div id="dares-table"></div>
        </div>
      </div>

      <div id="fanty-subsection-truths" style="display:none">
        <div class="card">
          <h2 style="margin-top:0" id="truth-form-heading">Добавить вручную</h2>
          <form id="add-truth-form">
            <label>Текст вопроса</label>
            <textarea name="text" maxlength="300" placeholder="Бил ли ты когда-нибудь животное?" required></textarea>
            <label>Категория</label>
            <div class="row" id="truth-category"></div>
            <div class="error-box" id="add-truth-error"></div>
            <div class="row-actions" style="margin-top:8px">
              <button type="submit" class="btn" id="truth-submit-btn">Добавить</button>
              <button type="button" class="btn secondary" id="truth-cancel-edit-btn" style="display:none">Отмена</button>
            </div>
          </form>
        </div>

        ${pendingReviewCard("truths", "На проверке (предложено игроками)")}

        <div class="card">
          <h2 style="margin-top:0">Активные вопросы</h2>
          <div class="prompt-count" id="truths-count"></div>
          <div id="truths-table"></div>
        </div>
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
  });
  setupTabs(document.querySelectorAll("#fanty-tabs .tab-btn"), {
    dares: document.getElementById("fanty-subsection-dares"),
    truths: document.getElementById("fanty-subsection-truths"),
  });

  const promptForm = document.getElementById("add-form");
  const promptFormHeading = document.getElementById("prompt-form-heading");
  const promptSubmitBtn = document.getElementById("prompt-submit-btn");
  const promptCancelEditBtn = document.getElementById("prompt-cancel-edit-btn");
  let editingPromptId = null;

  function resetPromptForm() {
    promptForm.reset();
    editingPromptId = null;
    promptFormHeading.textContent = "Добавить вручную";
    promptSubmitBtn.textContent = "Добавить";
    promptCancelEditBtn.style.display = "none";
  }

  window.startEditingPrompt = function (prompt) {
    editingPromptId = prompt.id;
    promptForm.elements.text.value = prompt.text;
    promptFormHeading.textContent = `Редактировать вопрос #${prompt.id}`;
    promptSubmitBtn.textContent = "Сохранить изменения";
    promptCancelEditBtn.style.display = "";
    promptForm.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  promptCancelEditBtn.addEventListener("click", resetPromptForm);

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
  const mixedPairRow = document.getElementById("dare-mixed-pair-row");
  function updateMixedPairVisibility() {
    mixedPairRow.style.display = dareForm.elements.kind.value === "team" ? "" : "none";
  }
  dareForm.querySelectorAll('input[name="kind"]').forEach((el) => el.addEventListener("change", updateMixedPairVisibility));
  updateMixedPairVisibility();

  const timerSecondsRow = document.getElementById("dare-timer-seconds-row");
  const hasTimerCheckbox = document.getElementById("dare-has-timer");
  function updateTimerSecondsVisibility() {
    timerSecondsRow.style.display = hasTimerCheckbox.checked ? "" : "none";
  }
  hasTimerCheckbox.addEventListener("change", updateTimerSecondsVisibility);
  updateTimerSecondsVisibility();

  let uploadedAudioFilename = null;
  const audioInput = document.getElementById("dare-audio-input");
  const audioStatus = document.getElementById("dare-audio-status");
  audioInput.addEventListener("change", async () => {
    const file = audioInput.files && audioInput.files[0];
    if (!file) return;
    uploadedAudioFilename = null;
    audioStatus.textContent = "Загрузка...";
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api("/fanty/upload-audio", { method: "POST", body: form });
      uploadedAudioFilename = res.filename;
      audioStatus.textContent = `Загружено: ${file.name}`;
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
    updateTimerSecondsVisibility();
    uploadedAudioFilename = null;
    audioStatus.textContent = "";
    document.getElementById("dare-timer-seconds").value = 60;
    editingDareId = null;
    dareFormHeading.textContent = "Добавить вручную";
    dareSubmitBtn.textContent = "Добавить";
    dareCancelEditBtn.style.display = "none";
  }

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

    uploadedAudioFilename = dare.musicUrl ? dare.musicUrl.split("/").pop() : null;
    audioStatus.textContent = dare.musicUrl ? "Текущий трек сохранится, если не загрузить новый" : "";
    audioInput.value = "";

    hasTimerCheckbox.checked = dare.hasTimer;
    updateTimerSecondsVisibility();
    document.getElementById("dare-timer-seconds").value = dare.timerSeconds || 60;

    dareFormHeading.textContent = `Редактировать фант #${dare.id}`;
    dareSubmitBtn.textContent = "Сохранить изменения";
    dareCancelEditBtn.style.display = "";
    dareForm.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  dareCancelEditBtn.addEventListener("click", resetDareForm);

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
      await refreshDares();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  const truthForm = document.getElementById("add-truth-form");
  const truthFormHeading = document.getElementById("truth-form-heading");
  const truthSubmitBtn = document.getElementById("truth-submit-btn");
  const truthCancelEditBtn = document.getElementById("truth-cancel-edit-btn");
  let editingTruthId = null;

  function resetTruthForm() {
    truthForm.reset();
    editingTruthId = null;
    truthFormHeading.textContent = "Добавить вручную";
    truthSubmitBtn.textContent = "Добавить";
    truthCancelEditBtn.style.display = "none";
  }

  window.startEditingTruth = function (truth) {
    editingTruthId = truth.id;
    truthForm.elements.text.value = truth.text;
    const moodValue = MOOD_CATEGORIES.find((m) => truth.categories.includes(m.value))?.value || "basic";
    truthForm.querySelector(`input[name="category"][value="${moodValue}"]`).checked = true;
    truthFormHeading.textContent = `Редактировать вопрос #${truth.id}`;
    truthSubmitBtn.textContent = "Сохранить изменения";
    truthCancelEditBtn.style.display = "";
    truthForm.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  truthCancelEditBtn.addEventListener("click", resetTruthForm);

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
      await refreshTruths();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  await refreshPrompts();
  await refreshDares();
  await refreshTruths();
}

function tagsHtml(item) {
  const parts = [];
  if (item.createdByEmail) {
    parts.push(`<span class="tag-pill tag-author">👤 ${escapeHtml(item.createdByEmail)}</span>`);
  }
  if (item.likes) {
    parts.push(`<span class="tag-pill tag-likes">🔥 ${item.likes}</span>`);
  }
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

async function refreshEntityList({ apiBase, idPrefix, textLabel, refreshFn, onEdit }) {
  const all = await api(apiBase);
  const pending = all.filter((p) => p.status === "pending");
  const active = all.filter((p) => p.status !== "pending");

  const pendingCard = document.getElementById(`${idPrefix}-pending-card`);
  const pendingHost = document.getElementById(`${idPrefix}-pending-table`);
  if (pending.length === 0) {
    pendingCard.style.display = "none";
  } else {
    pendingCard.style.display = "";
    const rows = pending
      .map(
        (p) => `
        <tr data-id="${p.id}">
          <td><input type="checkbox" class="pending-check" data-id="${p.id}" /></td>
          <td>${escapeHtml(p.text)}${tagsHtml(p) ? `<br/>${tagsHtml(p)}` : ""}</td>
          <td>
            <div class="row-actions">
              <button class="btn" data-activate="${p.id}">Активировать</button>
              ${onEdit ? `<button class="btn" data-edit="${p.id}">Редактировать</button>` : ""}
              <button class="btn danger" data-delete="${p.id}">Удалить</button>
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

  document.getElementById(`${idPrefix}-count`).textContent = `Всего: ${active.length}`;
  const tableHost = document.getElementById(`${idPrefix}-table`);
  if (active.length === 0) {
    tableHost.innerHTML = `<p class="hint">Пока нет ни одного активного элемента.</p>`;
    return;
  }

  const rows = active
    .map(
      (p) => `
      <tr data-id="${p.id}">
        <td>${escapeHtml(p.text)}${tagsHtml(p) ? `<br/>${tagsHtml(p)}` : ""}</td>
        <td>
          <div class="row-actions">
            ${onEdit ? `<button class="btn" data-edit="${p.id}">Редактировать</button>` : ""}
            <button class="btn danger" data-delete="${p.id}">Удалить</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");

  tableHost.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>${textLabel}</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  wireDeleteButtons(tableHost, apiBase, refreshFn);
  wireEditButtons(tableHost, all, onEdit);
}

function refreshPrompts() {
  return refreshEntityList({
    apiBase: "/prompts",
    idPrefix: "prompts",
    textLabel: "Фраза",
    refreshFn: refreshPrompts,
    onEdit: startEditingPrompt,
  });
}

function refreshDares() {
  return refreshEntityList({
    apiBase: "/fanty/dares",
    idPrefix: "dares",
    textLabel: "Текст",
    refreshFn: refreshDares,
    onEdit: startEditingDare,
  });
}

function refreshTruths() {
  return refreshEntityList({
    apiBase: "/fanty/truths",
    idPrefix: "truths",
    textLabel: "Текст",
    refreshFn: refreshTruths,
    onEdit: startEditingTruth,
  });
}

main();
