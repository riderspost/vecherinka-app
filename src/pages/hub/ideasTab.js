import { fantyApi } from "../../api.js";
import { navigate } from "../../router.js";
import { escapeHtml } from "../../utils.js";
import { LOCATIONS, CATEGORIES } from "../fanty/constants.js";

const MAX_TEXT = 300;

const STATUS = {
  pending: { label: "🕓 На проверке", cls: "pending" },
  approved: { label: "✅ В игре", cls: "approved" },
  rejected: { label: "✖ Отклонено", cls: "rejected" },
};

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "pending", label: "На проверке" },
  { id: "approved", label: "В игре" },
  { id: "rejected", label: "Отклонено" },
];

// "2026-11-24 12:30:00" (UTC, from SQLite) -> "24 ноября"
function dateLabel(value) {
  if (!value) return "";
  const d = new Date(String(value).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function plural(n, one, few, many) {
  const last = n % 10;
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

// A row of toggle chips (several can be on).
function chipGroup(options) {
  const wrap = document.createElement("div");
  wrap.className = "idea-chips";
  options.forEach((opt) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "idea-chip";
    chip.textContent = opt.label;
    chip.dataset.value = opt.value;
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true")));
    wrap.appendChild(chip);
  });
  return {
    element: wrap,
    getValue: () => [...wrap.querySelectorAll('[aria-pressed="true"]')].map((c) => c.dataset.value),
  };
}

// Two or three options, exactly one on.
function segmented(options, initial) {
  const wrap = document.createElement("div");
  wrap.className = "idea-seg";
  let value = initial;
  const listeners = [];
  function draw() {
    wrap.innerHTML = "";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.setAttribute("aria-pressed", String(opt.value === value));
      btn.addEventListener("click", () => {
        value = opt.value;
        draw();
        listeners.forEach((fn) => fn(value));
      });
      wrap.appendChild(btn);
    });
  }
  draw();
  return { element: wrap, getValue: () => value, onChange: (fn) => listeners.push(fn) };
}

// The "Идеи" tab: what the player has suggested, and a button to suggest more.
export function renderIdeasTab(shell) {
  const { body } = shell;
  const title = document.createElement("div");
  title.className = "idea-head";
  body.appendChild(title);
  const view = document.createElement("div");
  view.className = "idea-view";
  body.appendChild(view);

  shell.sessionPromise.then((session) => {
    if (!session.authenticated) return drawLoginRequired();
    start();
  });

  function drawLoginRequired() {
    title.innerHTML = `<h2 class="hub-h">Идеи</h2>`;
    const gate = document.createElement("div");
    gate.className = "hub-gate";
    gate.innerHTML = `
      <span class="hub-gate-emoji" aria-hidden="true">💡</span>
      <b>Предложите свой фант или вопрос</b>
      <p>Лучшие идеи попадают в игру «Фанты». Предлагать можно после входа: так вы увидите, что стало с вашим предложением.</p>
    `;
    const login = document.createElement("button");
    login.type = "button";
    login.className = "hub-login-btn";
    login.textContent = "Войти";
    login.addEventListener("click", () => navigate("/account"));
    gate.appendChild(login);
    view.appendChild(gate);
  }

  let items = [];
  let counts = { pending: 0, approved: 0, rejected: 0 };
  let filter = "all";

  async function load() {
    const res = await fantyApi.mySubmissions();
    items = res.items;
    counts = res.counts || { pending: 0, approved: res.approvedCount || 0, rejected: 0 };
  }

  function start() {
    view.innerHTML = `<p class="wz-note wz-note-left">Загружаем…</p>`;
    load()
      .then(() => drawList())
      .catch((e) => {
        view.innerHTML = `<p class="error-msg">${escapeHtml(e.message)}</p>`;
      });
  }

  function addButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "idea-add";
    btn.innerHTML = `<span aria-hidden="true">＋</span> Предложить`;
    btn.addEventListener("click", () => drawForm());
    return btn;
  }

  // ---- the list ----

  function drawList(notice) {
    title.innerHTML = "";
    const h = document.createElement("h2");
    h.className = "hub-h";
    h.textContent = "Идеи";
    title.appendChild(h);
    title.appendChild(addButton());

    view.innerHTML = "";
    const desc = document.createElement("p");
    desc.className = "hub-desc";
    desc.textContent = "Придумайте свой фант или вопрос для игры «Фанты». Лучшие попадут в игру, а здесь видно, что стало с каждой идеей.";
    view.appendChild(desc);
    if (notice) {
      const note = document.createElement("div");
      note.className = "wz-success";
      note.textContent = notice;
      view.appendChild(note);
    }

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "hub-gate";
      empty.innerHTML = `<span class="hub-gate-emoji" aria-hidden="true">💡</span><b>Пока пусто</b><p>Придумайте фант или вопрос для игры «Фанты». Одобренные идеи попадают в игру, а здесь будет видно, что стало с каждой.</p>`;
      const go = document.createElement("button");
      go.type = "button";
      go.className = "hub-login-btn";
      go.textContent = "Предложить первую идею";
      go.addEventListener("click", () => drawForm());
      empty.appendChild(go);
      view.appendChild(empty);
      return;
    }

    const filters = document.createElement("div");
    filters.className = "idea-filters";
    FILTERS.forEach((f) => {
      const n = f.id === "all" ? items.length : counts[f.id] || 0;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "idea-filter";
      chip.setAttribute("aria-pressed", String(filter === f.id));
      chip.textContent = `${f.label} · ${n}`;
      chip.addEventListener("click", () => {
        filter = f.id;
        drawList();
      });
      filters.appendChild(chip);
    });
    view.appendChild(filters);

    const list = document.createElement("div");
    list.className = "idea-list";
    items.filter((i) => filter === "all" || i.status === filter).forEach((i) => list.appendChild(ideaCard(i)));
    if (!list.children.length) {
      const none = document.createElement("p");
      none.className = "wz-note";
      none.textContent = "В этой группе ничего нет.";
      list.appendChild(none);
    }
    view.appendChild(list);
  }

  function ideaCard(item) {
    const st = STATUS[item.status] || STATUS.pending;
    const card = document.createElement("div");
    card.className = `idea-card ${st.cls}`;
    const kindLabel = item.type === "dare" ? (item.kind === "team" ? "Командный фант" : "Фант") : "Вопрос";

    const events = [`<li><i></i><span>${dateLabel(item.createdAt)}</span> Отправлено на проверку</li>`];
    if (item.status === "approved") events.push(`<li class="ok"><i></i><span>${dateLabel(item.reviewedAt)}</span> Одобрено и добавлено в игру</li>`);
    if (item.status === "rejected") events.push(`<li class="no"><i></i><span>${dateLabel(item.reviewedAt)}</span> Отклонено</li>`);

    card.innerHTML = `
      <div class="idea-card-head"><span class="idea-kind">${kindLabel}</span><span class="idea-status ${st.cls}">${st.label}</span></div>
      <p class="idea-text">${escapeHtml(item.text)}</p>
      <ul class="idea-timeline">${events.join("")}</ul>
    `;
    if (item.status === "approved") {
      const plays = item.plays || 0;
      const stats = document.createElement("div");
      stats.className = "idea-stats";
      stats.textContent = plays
        ? `Выпадал ${plays} ${plural(plays, "раз", "раза", "раз")} · 🔥 ${item.likes || 0}`
        : "Пока ни разу не выпадал";
      card.appendChild(stats);
    }
    if (item.status === "rejected" && item.rejectReason) {
      const why = document.createElement("div");
      why.className = "idea-reason";
      why.innerHTML = `<b>Причина</b> ${escapeHtml(item.rejectReason)}`;
      card.appendChild(why);
    }
    if (item.status === "pending") {
      const withdraw = document.createElement("button");
      withdraw.type = "button";
      withdraw.className = "idea-withdraw";
      withdraw.textContent = "Отозвать";
      let armed = false;
      withdraw.addEventListener("click", async () => {
        if (!armed) {
          armed = true;
          withdraw.textContent = "Точно отозвать?";
          withdraw.classList.add("armed");
          setTimeout(() => {
            armed = false;
            withdraw.textContent = "Отозвать";
            withdraw.classList.remove("armed");
          }, 5000);
          return;
        }
        withdraw.disabled = true;
        try {
          await fantyApi.withdrawSubmission(item.type, item.id);
          await load();
          drawList();
        } catch (e) {
          alert(e.message);
          withdraw.disabled = false;
        }
      });
      card.appendChild(withdraw);
    }
    return card;
  }

  // ---- the form: a second view with a way back to the list ----

  function drawForm() {
    title.innerHTML = "";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "idea-back";
    back.setAttribute("aria-label", "К списку");
    back.textContent = "←";
    back.addEventListener("click", () => drawList());
    const h = document.createElement("h2");
    h.className = "hub-h";
    h.textContent = "Новая идея";
    title.appendChild(back);
    title.appendChild(h);

    view.innerHTML = "";
    const intro = document.createElement("p");
    intro.className = "wz-note wz-note-left";
    intro.textContent = "Администратор проверяет каждое предложение. Одобренное появится в игре.";
    view.appendChild(intro);

    const form = document.createElement("div");
    form.className = "wz-form";
    view.appendChild(form);

    const type = segmented(
      [
        { value: "dare", label: "Фант (действие)" },
        { value: "truth", label: "Вопрос (правда)" },
      ],
      "dare"
    );

    const textField = document.createElement("label");
    textField.className = "wz-field";
    textField.innerHTML = `<span>Текст</span>`;
    const textArea = document.createElement("textarea");
    textArea.className = "answer-input wz-textarea";
    textArea.maxLength = MAX_TEXT;
    textField.appendChild(textArea);
    const counter = document.createElement("small");
    counter.className = "idea-counter";
    textField.appendChild(counter);
    const example = document.createElement("small");
    example.className = "idea-example";
    textField.appendChild(example);

    const kind = segmented(
      [
        { value: "solo", label: "Для одного" },
        { value: "team", label: "Командный" },
      ],
      "solo"
    );
    const kindField = document.createElement("div");
    kindField.className = "wz-field";
    kindField.innerHTML = `<span>Кто выполняет</span>`;
    kindField.appendChild(kind.element);
    const kindHint = document.createElement("small");
    kindHint.className = "idea-example";
    kindHint.textContent = "В командном фанте пишите {p1} и {p2} вместо имён игроков.";
    kindField.appendChild(kindHint);

    const locations = chipGroup(LOCATIONS);
    const locationsField = document.createElement("div");
    locationsField.className = "wz-field";
    locationsField.innerHTML = `<span>Где это можно делать</span>`;
    locationsField.appendChild(locations.element);

    const categories = chipGroup(CATEGORIES);
    const categoriesField = document.createElement("div");
    categoriesField.className = "wz-field";
    categoriesField.innerHTML = `<span>Категории</span>`;
    categoriesField.appendChild(categories.element);

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wz-cta";
    btn.textContent = "Отправить на проверку";

    function sync() {
      const isDare = type.getValue() === "dare";
      textArea.placeholder = isDare ? "Например: спой куплет любимой песни" : "Например: какой твой самый неловкий момент на свидании?";
      example.textContent = isDare ? "Опишите действие, которое выполняет игрок." : "Задайте вопрос, на который игрок отвечает вслух.";
      kindField.hidden = !isDare;
      locationsField.hidden = !isDare;
      counter.textContent = `${textArea.value.length} / ${MAX_TEXT}`;
    }
    type.onChange(sync);
    textArea.addEventListener("input", sync);

    btn.addEventListener("click", async () => {
      errorEl.textContent = "";
      const isDare = type.getValue() === "dare";
      const text = textArea.value.trim();
      if (!text) {
        errorEl.textContent = "Введите текст";
        textArea.focus();
        return;
      }
      const cats = categories.getValue();
      if (!cats.length) {
        errorEl.textContent = "Выберите хотя бы одну категорию";
        return;
      }
      const payload = { type: type.getValue(), text, categories: cats };
      if (isDare) {
        const locs = locations.getValue();
        if (!locs.length) {
          errorEl.textContent = "Выберите хотя бы одно место";
          return;
        }
        payload.kind = kind.getValue();
        payload.locations = locs;
      }
      btn.disabled = true;
      try {
        await fantyApi.submit(payload);
        await load();
        filter = "all";
        drawList("Спасибо! Предложение отправлено на проверку.");
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    form.appendChild(type.element);
    form.appendChild(textField);
    form.appendChild(kindField);
    form.appendChild(locationsField);
    form.appendChild(categoriesField);
    form.appendChild(errorEl);
    form.appendChild(btn);
    sync();
  }
}
