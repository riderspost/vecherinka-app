import { fantyApi } from "../../api.js";
import { mountWizardFrame } from "../../wizard.js";
import { escapeHtml } from "../../utils.js";
import { LOCATIONS, MOOD_CATEGORIES, ATTRIBUTES, locationLabel, categoryLabel } from "../fanty/constants.js";

// "Предложить идею" as a wizard with one question per screen. Which screens
// there are depends on the answers: a question needs only a text and a
// mood; a dare asks who does it and where; a dare with a timer also asks
// about the voice recording and music.

const MAX_TEXT = 300;
const MIN_SECONDS = 10;
const MAX_SECONDS = 300;
const MAX_AUDIO_MB = 8;

const TITLES = {
  type: "Что предлагаете",
  text: "Текст",
  kind: "Кто выполняет",
  where: "Где",
  mood: "Накал",
  attrs: "Под рукой",
  timer: "Таймер",
  rec: "Запись голоса",
  music: "Музыка",
  review: "Проверьте",
};

function stepsFor(s) {
  const dare = s.type !== "truth";
  const steps = ["type", "text"];
  if (dare) steps.push("kind", "where");
  steps.push("mood", "attrs");
  if (dare) {
    steps.push("timer");
    if (s.hasTimer) steps.push("rec", "music");
  }
  steps.push("review");
  return steps;
}

function formatSeconds(n) {
  if (n < 60) return `${n} с`;
  const m = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${m} мин ${r} с` : `${m} мин`;
}

// `onExit(notice?)` is called when the wizard is left: back from the first
// screen, or after sending (with a thank-you line).
export function openIdeaWizard(container, { onExit }) {
  const state = {
    type: null,
    text: "",
    kind: "solo",
    locations: [],
    moods: [],
    attrs: [],
    hasTimer: false,
    seconds: 60,
    hasRecording: false,
    music: null, // { filename, originalName }
  };
  let current = "type";

  function go(id) {
    current = id;
    draw();
  }

  function next() {
    const steps = stepsFor(state);
    go(steps[Math.min(steps.indexOf(current) + 1, steps.length - 1)]);
  }

  function draw() {
    const steps = stepsFor(state);
    if (!steps.includes(current)) current = steps[steps.length - 1];
    const index = steps.indexOf(current);
    const body = mountWizardFrame(container, {
      current: index + 1,
      total: steps.length,
      title: TITLES[current],
      onBack: () => (index === 0 ? onExit() : go(steps[index - 1])),
    });
    STEP[current](body);
  }

  // ---- little parts ----

  function question(body, title, note) {
    const q = document.createElement("div");
    q.className = "idea-q";
    q.innerHTML = `<h2>${escapeHtml(title)}</h2>${note ? `<p>${escapeHtml(note)}</p>` : ""}`;
    body.appendChild(q);
  }

  function nextButton(body, label = "Дальше", onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wz-cta";
    btn.textContent = label;
    btn.addEventListener("click", onClick || next);
    body.appendChild(btn);
    return btn;
  }

  function errorLine(body) {
    const el = document.createElement("div");
    el.className = "error-msg";
    body.appendChild(el);
    return el;
  }

  // A big card with an emoji, a title and a line of text. Used for one-of
  // choices (taps move on) and for several-of choices (aria-pressed).
  function card({ emoji, title, text, pressed }) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "mood-card";
    if (pressed !== undefined) el.setAttribute("aria-pressed", String(pressed));
    el.innerHTML = `
      <span class="mood-emoji" style="background:rgba(138, 92, 255, 0.2)" aria-hidden="true">${emoji}</span>
      <span class="mood-text"><b>${escapeHtml(title)}</b><small>${escapeHtml(text || "")}</small></span>
    `;
    return el;
  }

  function yesNo(body, value, onPick, labels = ["Нет", "Да"]) {
    const row = document.createElement("div");
    row.className = "idea-yn";
    [false, true].forEach((v, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = labels[i];
      b.setAttribute("aria-pressed", String(value === v));
      b.addEventListener("click", () => onPick(v));
      row.appendChild(b);
    });
    body.appendChild(row);
  }

  // ---- the screens ----

  const STEP = {
    type(body) {
      question(body, "Что вы придумали?", "Администратор проверит идею, и если она подходит, добавит в игру «Фанты».");
      const dare = card({ emoji: "🎭", title: "Фант", text: "Действие, которое выполняет игрок" });
      const truth = card({ emoji: "💬", title: "Вопрос", text: "Вопрос, на который отвечают вслух" });
      dare.addEventListener("click", () => {
        state.type = "dare";
        next();
      });
      truth.addEventListener("click", () => {
        state.type = "truth";
        next();
      });
      body.appendChild(dare);
      body.appendChild(truth);
    },

    text(body) {
      const isDare = state.type !== "truth";
      question(
        body,
        isDare ? "Что должен сделать игрок?" : "О чём спросить?",
        isDare ? "Опишите так, чтобы было понятно с первого раза." : "Задайте вопрос, на который игрок ответит вслух."
      );
      const area = document.createElement("textarea");
      area.className = "answer-input wz-textarea";
      area.maxLength = MAX_TEXT;
      area.value = state.text;
      area.placeholder = isDare
        ? "Например: спой куплет любимой песни"
        : "Например: какой твой самый неловкий момент на свидании?";
      body.appendChild(area);
      const counter = document.createElement("small");
      counter.className = "idea-counter";
      body.appendChild(counter);
      const sync = () => (counter.textContent = `${area.value.length} / ${MAX_TEXT}`);
      area.addEventListener("input", sync);
      sync();
      const err = errorLine(body);
      nextButton(body, "Дальше", () => {
        const text = area.value.trim();
        if (!text) {
          err.textContent = "Введите текст";
          area.focus();
          return;
        }
        state.text = text;
        next();
      });
      area.focus();
    },

    kind(body) {
      question(body, "Кто выполняет?");
      const solo = card({ emoji: "👤", title: "Для одного", text: "Бутылка выбирает одного игрока" });
      const team = card({
        emoji: "👥",
        title: "Командный",
        text: "Для двоих. В тексте пишите {p1} и {p2} вместо имён",
      });
      solo.addEventListener("click", () => {
        state.kind = "solo";
        next();
      });
      team.addEventListener("click", () => {
        state.kind = "team";
        next();
      });
      body.appendChild(solo);
      body.appendChild(team);
    },

    where(body) {
      question(body, "Где это можно делать?", "Можно выбрать несколько мест.");
      LOCATIONS.forEach((loc) => {
        const c = card({
          emoji: { apartment: "🏠", bar: "🍸", street: "🌆", country_house: "🏡" }[loc.value] || "📍",
          title: loc.label,
          text: loc.hint,
          pressed: state.locations.includes(loc.value),
        });
        c.addEventListener("click", () => {
          const on = c.getAttribute("aria-pressed") !== "true";
          c.setAttribute("aria-pressed", String(on));
          state.locations = on ? [...state.locations, loc.value] : state.locations.filter((v) => v !== loc.value);
          err.textContent = "";
        });
        body.appendChild(c);
      });
      const err = errorLine(body);
      nextButton(body, "Дальше", () => {
        if (!state.locations.length) {
          err.textContent = "Выберите хотя бы одно место";
          return;
        }
        next();
      });
    },

    mood(body) {
      question(body, "Какой накал?", "Можно выбрать несколько.");
      const EMOJI = { basic: "🙂", flirt: "😏", flirt_plus: "🔥" };
      MOOD_CATEGORIES.forEach((cat) => {
        const c = card({
          emoji: EMOJI[cat.value] || "🎲",
          title: cat.label,
          text: cat.hint,
          pressed: state.moods.includes(cat.value),
        });
        c.addEventListener("click", () => {
          const on = c.getAttribute("aria-pressed") !== "true";
          c.setAttribute("aria-pressed", String(on));
          state.moods = on ? [...state.moods, cat.value] : state.moods.filter((v) => v !== cat.value);
          err.textContent = "";
        });
        body.appendChild(c);
      });
      const err = errorLine(body);
      nextButton(body, "Дальше", () => {
        if (!state.moods.length) {
          err.textContent = "Выберите хотя бы один вариант";
          return;
        }
        next();
      });
    },

    attrs(body) {
      question(body, "Нужно что-то под рукой?", "Отметьте, если без этого фант не получится. Иначе просто дальше.");
      const EMOJI = { alcohol: "🍺", food: "🍕" };
      ATTRIBUTES.forEach((attr) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "attr-row";
        row.setAttribute("aria-pressed", String(state.attrs.includes(attr.value)));
        row.innerHTML = `
          <span class="attr-emoji" aria-hidden="true">${EMOJI[attr.value] || "✨"}</span>
          <span class="mood-text"><b>${escapeHtml(attr.label)}</b><small>${escapeHtml(attr.hint)}</small></span>
          <span class="switch" aria-hidden="true"></span>
        `;
        row.addEventListener("click", () => {
          const on = row.getAttribute("aria-pressed") !== "true";
          row.setAttribute("aria-pressed", String(on));
          state.attrs = on ? [...state.attrs, attr.value] : state.attrs.filter((v) => v !== attr.value);
        });
        body.appendChild(row);
      });
      nextButton(body);
    },

    timer(body) {
      question(body, "Нужен таймер?", "Игроку покажут обратный отсчёт, пока он выполняет фант.");
      const stepper = document.createElement("div");
      stepper.className = "idea-stepper";
      stepper.hidden = !state.hasTimer;
      const minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "−";
      minus.setAttribute("aria-label", "Меньше");
      const value = document.createElement("div");
      value.className = "idea-stepper-value";
      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "＋";
      plus.setAttribute("aria-label", "Больше");
      const draw = () => {
        value.textContent = formatSeconds(state.seconds);
        minus.disabled = state.seconds <= MIN_SECONDS;
        plus.disabled = state.seconds >= MAX_SECONDS;
      };
      minus.addEventListener("click", () => {
        state.seconds = Math.max(MIN_SECONDS, state.seconds - (state.seconds > 60 ? 15 : 10));
        draw();
      });
      plus.addEventListener("click", () => {
        state.seconds = Math.min(MAX_SECONDS, state.seconds + (state.seconds >= 60 ? 15 : 10));
        draw();
      });
      stepper.append(minus, value, plus);
      draw();

      yesNo(body, state.hasTimer, (v) => {
        state.hasTimer = v;
        if (!v) {
          state.hasRecording = false;
          state.music = null;
          next();
        } else {
          draw();
          stepper.hidden = false;
          body.querySelectorAll(".idea-yn button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === 1)));
        }
      });
      body.appendChild(stepper);
      nextButton(body);
    },

    rec(body) {
      question(
        body,
        "Записывать голос?",
        "Запись включится сама вместе с таймером. Потом её можно переслушать, отправить друзьям или сохранить."
      );
      yesNo(
        body,
        state.hasRecording,
        (v) => {
          state.hasRecording = v;
          next();
        },
        ["Нет", "Да, записывать"]
      );
    },

    music(body) {
      question(
        body,
        "Добавить музыку?",
        `Она будет играть, пока идёт таймер. Файл mp3, m4a, ogg или wav, до ${MAX_AUDIO_MB} МБ. Её добавят в игру после проверки.`
      );
      const status = document.createElement("div");
      status.className = "idea-music";
      body.appendChild(status);

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*,.mp3,.m4a,.ogg,.wav";
      input.hidden = true;
      body.appendChild(input);

      const err = errorLine(body);
      let uploading = false;

      function drawStatus() {
        status.innerHTML = "";
        if (state.music) {
          const row = document.createElement("div");
          row.className = "idea-music-file";
          row.innerHTML = `<span aria-hidden="true">🎵</span><b>${escapeHtml(state.music.originalName || "Музыка")}</b>`;
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Убрать";
          remove.addEventListener("click", () => {
            state.music = null;
            drawStatus();
          });
          row.appendChild(remove);
          status.appendChild(row);
        } else {
          const pick = document.createElement("button");
          pick.type = "button";
          pick.className = "mood-card";
          pick.innerHTML = `
            <span class="mood-emoji" style="background:rgba(138, 92, 255, 0.2)" aria-hidden="true">🎵</span>
            <span class="mood-text"><b>${uploading ? "Загружаем…" : "Выбрать файл"}</b><small>С телефона или из облака</small></span>
          `;
          pick.disabled = uploading;
          pick.addEventListener("click", () => input.click());
          status.appendChild(pick);
        }
      }

      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        err.textContent = "";
        if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
          err.textContent = `Файл больше ${MAX_AUDIO_MB} МБ`;
          return;
        }
        uploading = true;
        drawStatus();
        try {
          const res = await fantyApi.uploadIdeaAudio(file);
          state.music = { filename: res.filename, originalName: res.originalName || file.name };
        } catch (e) {
          err.textContent = e.message;
        }
        uploading = false;
        drawStatus();
      });
      drawStatus();

      nextButton(body, state.music ? "Дальше" : "Без музыки, дальше", () => {
        if (uploading) {
          err.textContent = "Дождитесь загрузки файла";
          return;
        }
        next();
      });
    },

    review(body) {
      const isDare = state.type !== "truth";
      question(body, "Всё верно?", "Так идею увидит администратор. Любой ответ можно поправить.");

      const prev = document.createElement("div");
      prev.className = "idea-preview";
      const tags = [];
      if (isDare && state.hasTimer) tags.push(`⏱ ${formatSeconds(state.seconds)}`);
      if (isDare && state.hasTimer && state.hasRecording) tags.push("🎙 запись голоса");
      if (isDare && state.music) tags.push("🎵 музыка");
      prev.innerHTML = `
        <div class="idea-preview-who">${isDare ? (state.kind === "team" ? "Командный фант" : "Фант") : "Вопрос"}</div>
        <p>${escapeHtml(state.text)}</p>
        ${tags.length ? `<div class="idea-preview-tags">${tags.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      `;
      body.appendChild(prev);

      const rows = [["type", "Тип", isDare ? "Фант" : "Вопрос"], ["text", "Текст", state.text]];
      if (isDare) {
        rows.push(["kind", "Кто", state.kind === "team" ? "Командный" : "Для одного"]);
        rows.push(["where", "Где", state.locations.map(locationLabel).join(", ")]);
      }
      rows.push(["mood", "Накал", state.moods.map(categoryLabel).join(", ")]);
      rows.push(["attrs", "Под рукой", state.attrs.length ? state.attrs.map(categoryLabel).join(", ") : "ничего не нужно"]);
      if (isDare) {
        rows.push(["timer", "Таймер", state.hasTimer ? formatSeconds(state.seconds) : "без таймера"]);
        if (state.hasTimer) {
          rows.push(["rec", "Запись", state.hasRecording ? "да" : "нет"]);
          rows.push(["music", "Музыка", state.music ? state.music.originalName || "есть" : "нет"]);
        }
      }
      const list = document.createElement("div");
      list.className = "idea-review";
      rows.forEach(([id, label, value]) => {
        const row = document.createElement("button");
        row.type = "button";
        row.innerHTML = `<b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span><em>изменить</em>`;
        row.addEventListener("click", () => go(id));
        list.appendChild(row);
      });
      body.appendChild(list);

      const err = errorLine(body);
      const send = nextButton(body, "Отправить на проверку", async () => {
        send.disabled = true;
        err.textContent = "";
        const payload = {
          type: state.type,
          text: state.text,
          categories: [...state.moods, ...state.attrs],
        };
        if (isDare) {
          payload.kind = state.kind;
          payload.locations = state.locations;
          payload.hasTimer = state.hasTimer;
          if (state.hasTimer) {
            payload.timerSeconds = state.seconds;
            payload.hasRecording = state.hasRecording;
            if (state.music) {
              payload.musicFilename = state.music.filename;
              payload.musicOriginalName = state.music.originalName;
            }
          }
        }
        try {
          await fantyApi.submit(payload);
          onExit("Спасибо! Предложение отправлено на проверку.");
        } catch (e) {
          err.textContent = e.message;
          send.disabled = false;
        }
      });
    },
  };

  draw();
}
