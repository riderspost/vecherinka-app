import { authApi, fantyApi } from "../../api.js";
import { navigate } from "../../router.js";
import { escapeHtml } from "../../utils.js";
import { LOCATIONS, CATEGORIES } from "./constants.js";

function checkboxGroup(options) {
  const wrap = document.createElement("div");
  wrap.className = "checkbox-group";
  options.forEach((opt) => {
    const label = document.createElement("label");
    label.className = "checkbox-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = opt.value;
    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + opt.label));
    wrap.appendChild(label);
  });
  return {
    element: wrap,
    getValue: () => Array.from(wrap.querySelectorAll("input:checked")).map((i) => i.value),
  };
}

function radioGroup(name, options, defaultValue) {
  const wrap = document.createElement("div");
  wrap.className = "radio-group";
  options.forEach((opt) => {
    const label = document.createElement("label");
    label.className = "radio-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
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

export function renderFantySubmit(container) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `<p class="tagline">Проверяем доступ...</p>`;
  container.appendChild(wrap);

  authApi
    .session()
    .then((res) => {
      if (res.authenticated) {
        const mySubmissions = createMySubmissions();
        renderForm(wrap, mySubmissions.refresh);
        wrap.appendChild(mySubmissions.element);
        mySubmissions.refresh();
      } else {
        renderLoginRequired(wrap);
      }
    })
    .catch(() => renderLoginRequired(wrap));
}

function renderLoginRequired(wrap) {
  wrap.innerHTML = `
    <h1 class="logo">💡 Предложить фант</h1>
    <p class="tagline">Предлагать свои фанты и вопросы могут только зарегистрированные пользователи. Войдите или зарегистрируйтесь, чтобы продолжить.</p>
  `;

  const row = document.createElement("div");
  row.className = "row-actions";

  const backBtn = document.createElement("button");
  backBtn.className = "btn";
  backBtn.textContent = "Назад";
  backBtn.addEventListener("click", () => navigate("/fanty"));

  const loginBtn = document.createElement("button");
  loginBtn.className = "btn btn-primary";
  loginBtn.textContent = "Войти";
  loginBtn.addEventListener("click", () => navigate("/account"));

  row.appendChild(backBtn);
  row.appendChild(loginBtn);
  wrap.appendChild(row);
}

function renderForm(wrap, onSubmitted) {
  wrap.innerHTML = `
    <h1 class="logo">💡 Предложить фант</h1>
    <p class="tagline">Ваш вариант попадёт на проверку администратору и появится в игре после одобрения</p>
  `;

  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Что предлагаете?";
  const typeGroup = radioGroup(
    "type",
    [
      { value: "dare", label: "Фант (действие)" },
      { value: "truth", label: "Вопрос (правда)" },
    ],
    "dare"
  );

  const textLabel = document.createElement("label");
  textLabel.textContent = "Текст";
  const textArea = document.createElement("textarea");
  textArea.className = "answer-input";
  textArea.maxLength = 300;
  textArea.placeholder = "Например: Спой куплет своей любимой песни...";

  const kindLabel = document.createElement("label");
  kindLabel.textContent = "Тип фанта";
  const kindGroup = radioGroup(
    "kind",
    [
      { value: "solo", label: "Для одного игрока" },
      { value: "team", label: "Командный (используйте {p1} и {p2} вместо имён)" },
    ],
    "solo"
  );

  const locationsLabel = document.createElement("label");
  locationsLabel.textContent = "Где это можно делать?";
  const locationsGroup = checkboxGroup(LOCATIONS);

  const categoriesLabel = document.createElement("label");
  categoriesLabel.textContent = "Категории";
  const categoriesGroup = checkboxGroup(CATEGORIES);

  const dareOnlyFields = [kindLabel, kindGroup.element, locationsLabel, locationsGroup.element];

  function updateVisibility() {
    const isDare = typeGroup.getValue() === "dare";
    dareOnlyFields.forEach((el) => (el.style.display = isDare ? "" : "none"));
  }
  typeGroup.element.addEventListener("change", updateVisibility);

  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Отправить на проверку";

  const errorEl = document.createElement("div");
  errorEl.className = "error-msg";
  const successEl = document.createElement("div");
  successEl.className = "success-msg";

  btn.addEventListener("click", async () => {
    errorEl.textContent = "";
    successEl.textContent = "";
    const type = typeGroup.getValue();
    const text = textArea.value.trim();
    if (!text) {
      errorEl.textContent = "Введите текст";
      return;
    }
    const categories = categoriesGroup.getValue();
    if (categories.length === 0) {
      errorEl.textContent = "Выберите хотя бы одну категорию";
      return;
    }
    const payload = { type, text, categories };
    if (type === "dare") {
      const locations = locationsGroup.getValue();
      if (locations.length === 0) {
        errorEl.textContent = "Выберите хотя бы одно место";
        return;
      }
      payload.kind = kindGroup.getValue();
      payload.locations = locations;
    }

    btn.disabled = true;
    try {
      await fantyApi.submit(payload);
      successEl.textContent = "Спасибо! Ваш вариант отправлен на проверку.";
      textArea.value = "";
      if (onSubmitted) onSubmitted();
    } catch (e) {
      errorEl.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  const backLink = document.createElement("a");
  backLink.className = "link-btn";
  backLink.href = "/fanty";
  backLink.textContent = "← Назад к Фантам";
  backLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/fanty");
  });

  wrap.appendChild(typeLabel);
  wrap.appendChild(typeGroup.element);
  wrap.appendChild(textLabel);
  wrap.appendChild(textArea);
  wrap.appendChild(kindLabel);
  wrap.appendChild(kindGroup.element);
  wrap.appendChild(locationsLabel);
  wrap.appendChild(locationsGroup.element);
  wrap.appendChild(categoriesLabel);
  wrap.appendChild(categoriesGroup.element);
  wrap.appendChild(errorEl);
  wrap.appendChild(successEl);
  wrap.appendChild(btn);
  wrap.appendChild(backLink);

  updateVisibility();
}

function createMySubmissions() {
  const host = document.createElement("div");
  host.className = "my-submissions";

  async function refresh() {
    host.innerHTML = `<p class="tagline">Загружаем ваши предложения...</p>`;
    try {
      const res = await fantyApi.mySubmissions();
      renderList(res);
    } catch (e) {
      host.innerHTML = `<p class="error-msg">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderList(res) {
    host.innerHTML = "";

    const heading = document.createElement("h2");
    heading.className = "section-heading";
    heading.textContent = "💡 Мои предложения";
    host.appendChild(heading);

    const counter = document.createElement("p");
    counter.className = "tagline";
    counter.textContent =
      res.items.length === 0
        ? "Вы пока ничего не предлагали."
        : `Одобрено сервисом: ${res.approvedCount} из ${res.items.length}`;
    host.appendChild(counter);

    if (res.items.length === 0) return;

    const list = document.createElement("div");
    list.className = "submissions-list";
    res.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "submission-row";
      const approved = item.status === "active";
      const statusClass = approved ? "submission-status-approved" : "submission-status-pending";
      const statusLabel = approved ? "✅ Одобрено" : "🕓 На проверке";
      const typeLabel = item.type === "dare" ? "Фант" : "Вопрос";
      row.innerHTML = `
        <p class="submission-text">${escapeHtml(item.text)}</p>
        <span class="submission-meta">${typeLabel} · <span class="${statusClass}">${statusLabel}</span></span>
      `;
      list.appendChild(row);
    });
    host.appendChild(list);
  }

  return { element: host, refresh };
}
