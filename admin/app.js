const API = "/admin/api";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
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

async function renderDashboard() {
  root.innerHTML = `
    <div class="admin-header">
      <h1>🎉 Вечеринка — вопросы игры</h1>
      <button class="btn secondary" id="logout-btn">Выйти</button>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Добавить вручную</h2>
      <form id="add-form">
        <label>Текст фразы (начало предложения)</label>
        <textarea name="text" maxlength="300" placeholder="Если бы я был..." required></textarea>
        <div class="error-box" id="add-error"></div>
        <button type="submit" class="btn" style="margin-top:8px">Добавить</button>
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

    <div class="card" id="pending-card" style="display:none">
      <h2 style="margin-top:0">На проверке (сгенерировано AI)</h2>
      <p class="hint">Эти фразы ещё не используются в игре, пока их не активируют.</p>
      <div id="pending-table"></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Активные вопросы</h2>
      <div class="prompt-count" id="prompt-count"></div>
      <div id="prompts-table"></div>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    renderLogin();
  });

  document.getElementById("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const textarea = e.target.elements.text;
    const errorEl = document.getElementById("add-error");
    errorEl.textContent = "";
    const text = textarea.value.trim();
    if (!text) return;
    try {
      await api("/prompts", { method: "POST", body: JSON.stringify({ text }) });
      textarea.value = "";
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

  await refreshPrompts();
}

function wireDeleteButtons(host) {
  host.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Удалить эту фразу?")) return;
      btn.disabled = true;
      try {
        await api(`/prompts/${btn.dataset.delete}`, { method: "DELETE" });
        await refreshPrompts();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

async function refreshPrompts() {
  const all = await api("/prompts");
  const pending = all.filter((p) => p.status === "pending");
  const active = all.filter((p) => p.status !== "pending");

  const pendingCard = document.getElementById("pending-card");
  const pendingHost = document.getElementById("pending-table");
  if (pending.length === 0) {
    pendingCard.style.display = "none";
  } else {
    pendingCard.style.display = "";
    const rows = pending
      .map(
        (p) => `
        <tr data-id="${p.id}">
          <td>${escapeHtml(p.text)}</td>
          <td>
            <button class="btn" data-activate="${p.id}">Активировать</button>
            <button class="btn danger" data-delete="${p.id}">Удалить</button>
          </td>
        </tr>
      `
      )
      .join("");
    pendingHost.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Фраза</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    pendingHost.querySelectorAll("[data-activate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api(`/prompts/${btn.dataset.activate}/activate`, { method: "POST" });
          await refreshPrompts();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    });
    wireDeleteButtons(pendingHost);
  }

  document.getElementById("prompt-count").textContent = `Всего: ${active.length}`;
  const tableHost = document.getElementById("prompts-table");
  if (active.length === 0) {
    tableHost.innerHTML = `<p class="hint">Пока нет ни одной активной фразы.</p>`;
    return;
  }

  const rows = active
    .map(
      (p) => `
      <tr data-id="${p.id}">
        <td>${escapeHtml(p.text)}</td>
        <td>${p.uses > 0 ? `<span class="uses-pill">использован ${p.uses}×</span>` : ""}</td>
        <td><button class="btn danger" data-delete="${p.id}">Удалить</button></td>
      </tr>
    `
    )
    .join("");

  tableHost.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Фраза</th><th>Использований</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  wireDeleteButtons(tableHost);
}

main();
