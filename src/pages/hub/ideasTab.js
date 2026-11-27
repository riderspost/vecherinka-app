import { fantyApi } from "../../api.js";
import { navigate } from "../../router.js";
import { escapeHtml } from "../../utils.js";
import { openIdeaWizard } from "./ideaWizard.js";

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

// A thank-you line to show on the list once, after an idea was sent.
let flashNotice = null;

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
      .then(() => {
        const notice = flashNotice;
        flashNotice = null;
        drawList(notice);
      })
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

    const extras = [];
    if (item.hasTimer) extras.push(`⏱ ${item.timerSeconds} с`);
    if (item.hasRecording) extras.push("🎙 запись");
    if (item.hasMusic) extras.push("🎵 музыка");
    card.innerHTML = `
      <div class="idea-card-head"><span class="idea-kind">${kindLabel}</span><span class="idea-status ${st.cls}">${st.label}</span></div>
      <p class="idea-text">${escapeHtml(item.text)}</p>
      ${extras.length ? `<div class="idea-preview-tags">${extras.map((t) => `<span>${t}</span>`).join("")}</div>` : ""}
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

  // ---- the form: a wizard that takes over the whole screen ----

  function drawForm() {
    const container = body.closest(".hub").parentElement;
    openIdeaWizard(container, {
      onExit: async (notice) => {
        flashNotice = notice || null;
        const { renderHub } = await import("./index.js");
        renderHub(container, "ideas");
      },
    });
  }
}
