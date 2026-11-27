import { fantyApi, authApi, isPaid } from "../../api.js";
import { saveSession } from "../../storage.js";
import { navigate } from "../../router.js";
import { createAvatarPicker } from "../../avatarPicker.js";
import { mountWizardFrame } from "../../wizard.js";
import { createGenderPicker } from "./genderPicker.js";
import {
  LOCATIONS,
  MOOD_CATEGORIES,
  ATTRIBUTES,
  GAME_MODES,
  PICK_MODES,
  PAIR_MODES,
  MIN_PLAYERS_BY_MODE,
} from "./constants.js";

const TOTAL_STEPS = 5;
const STEP_TITLES = ["Как играем", "Где играем", "Типы фантов", "Как выбирает бутылка", "Кто вы"];

// Step zero: which game to play. The rest of the setup follows from this.
const MODE_CARDS = [
  { value: "truth_or_dare", tone: "g1", art: "🍾🎭", title: "Правда или действие", text: "Выпавший сам выбирает: ответить на вопрос или выполнить задание." },
  { value: "solo", tone: "g2", art: "🍾🎯", title: "Просто фанты", text: "Бутылка сразу даёт задание тому, на кого указала." },
  { value: "team", pairMode: "any", tone: "g3", art: "🍾👯", title: "Командные фанты", text: "Пара из любых игроков выполняет общее задание." },
  { value: "team", pairMode: "mixed", tone: "g4", art: "🍾💞", title: "Фанты для пар", text: "Пара всегда мужчина и женщина." },
];

// Short lines under the options of the next steps (the long explanations
// that used to hide behind an ⓘ are now the rules cards).
const LOCATION_ART = {
  apartment: { emoji: "🏠", note: "Тихо и уютно", tone: "l1" },
  bar: { emoji: "🍸", note: "Шумно и людно", tone: "l2" },
  street: { emoji: "🌃", note: "На людях", tone: "l3" },
  country_house: { emoji: "🏡", note: "Есть где разгуляться", tone: "l4" },
};
const MOOD_ART = {
  basic: { emoji: "🙂", note: "Безобидно для любой компании", heat: 1, tint: "rgba(93, 255, 167, 0.2)" },
  flirt: { emoji: "😏", note: "Лёгкие намёки и игривые задания", heat: 2, tint: "rgba(255, 210, 63, 0.2)" },
  flirt_plus: { emoji: "🔥", note: "Смелее и откровеннее", heat: 3, tint: "rgba(255, 93, 162, 0.22)" },
};
const ATTRIBUTE_ART = {
  alcohol: { emoji: "🍺", note: "Только если он правда есть" },
  food: { emoji: "🍕", note: "Фанты с едой" },
};

// The rules cards of step one: each mode explains itself in three cards.
const RULES = {
  truth_or_dare: [
    { emoji: "🍾", title: "Крутим бутылку", text: "Бутылка выбирает игрока. Все видят, на кого она указала." },
    { emoji: "🎭", title: "Правда или действие", text: "Выпавший сам решает: ответить на вопрос о себе или выполнить задание.", demo: { q: "Антон, правда или действие?", a: "Действие: зачитай рэп про то, как вы кайфово сидите" } },
    { emoji: "🎉", title: "Выполнили, крутим снова", text: "Задание нужно сделать по-настоящему." },
  ],
  solo: [
    { emoji: "🍾", title: "Крутим бутылку", text: "Бутылка выбирает игрока. Все видят, на кого она указала." },
    { emoji: "🎯", title: "Сразу задание", text: "Никакого выбора: выпавший получает фант и выполняет его.", demo: { q: "Антон", a: "Зачитай рэп про то, как вы кайфово сидите" } },
    { emoji: "🎉", title: "Выполнили, крутим снова", text: "Задание нужно сделать по-настоящему." },
  ],
  team_mixed: [
    { emoji: "🍾", title: "Первый спин", text: "Бутылка выбирает первого игрока." },
    { emoji: "💞", title: "Второй спин: пара", text: "Бутылка крутится ещё раз и выбирает напарника другого пола. Задание выполняют мужчина и женщина вместе.", demo: { q: "Антон и Маша", a: "Станцуйте медленный танец без музыки" } },
    { emoji: "🎉", title: "Выполнили, крутим снова", text: "Задание нужно сделать по-настоящему." },
  ],
  team: [
    { emoji: "🍾", title: "Первый спин", text: "Бутылка выбирает первого игрока." },
    { emoji: "👯", title: "Второй спин: напарник", text: "Бутылка крутится ещё раз и выбирает пару. Задание вы выполняете вместе.", demo: { q: "Антон и Маша", a: "Станцуйте медленный танец без музыки" } },
    { emoji: "🎉", title: "Выполнили, крутим снова", text: "Задание нужно сделать по-настоящему." },
  ],
};

function optionRow(labelEl, hint) {
  const row = document.createElement("div");
  row.className = "option-row";

  const main = document.createElement("div");
  main.className = "option-row-main";
  main.appendChild(labelEl);

  if (hint) {
    const hintBtn = document.createElement("button");
    hintBtn.type = "button";
    hintBtn.className = "hint-toggle";
    hintBtn.textContent = "ⓘ";
    hintBtn.setAttribute("aria-label", "Что это значит?");

    const hintText = document.createElement("div");
    hintText.className = "hint-text";
    hintText.textContent = hint;
    hintText.hidden = true;

    hintBtn.addEventListener("click", () => {
      hintText.hidden = !hintText.hidden;
    });

    main.appendChild(hintBtn);
    row.appendChild(main);
    row.appendChild(hintText);
  } else {
    row.appendChild(main);
  }

  return row;
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
    wrap.appendChild(optionRow(label, opt.hint));
  });
  return {
    element: wrap,
    getValue: () => wrap.querySelector("input:checked")?.value,
  };
}

function checkboxGroup(options, defaultChecked) {
  const wrap = document.createElement("div");
  wrap.className = "checkbox-group";
  options.forEach((opt) => {
    const label = document.createElement("label");
    label.className = "checkbox-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = opt.value;
    if (defaultChecked.includes(opt.value)) input.checked = true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + opt.label));
    wrap.appendChild(optionRow(label, opt.hint));
  });
  return {
    element: wrap,
    getValue: () => Array.from(wrap.querySelectorAll("input:checked")).map((i) => i.value),
  };
}

export function renderFantyHome(container) {
  // The setup is a wizard: every step is a screen of its own (see wizard.js).
  let formHost = null;
  let backHook = null;

  // ---- step zero: the mode ----
  function showModeStep() {
    const body = mountWizardFrame(container, {
      current: 1,
      total: 0,
      title: "Фанты",
      onBack: () => navigate("/"),
    });
    const intro = document.createElement("div");
    intro.className = "mode-intro";
    intro.innerHTML = `<h2>Как будем играть?</h2><p>Выберите режим. Бутылка у всех одна, отличается то, что она решает.</p>`;
    body.appendChild(intro);
    MODE_CARDS.forEach((mode) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `mode-card ${mode.tone}`;
      card.innerHTML = `
        <span class="mode-art" aria-hidden="true">${mode.art}</span>
        <b>${mode.title}</b>
        <p>${mode.text}</p>
      `;
      card.addEventListener("click", () => showCreateForm(mode.value, mode.pairMode));
      body.appendChild(card);
    });
  }

  function showCreateForm(chosenMode, chosenPairMode) {
    const formState = {
      gameMode: chosenMode || "truth_or_dare",
      location: LOCATIONS[0].value,
      categories: ["basic"],
      attributes: [],
      pickMode: "fair",
      pairMode: chosenPairMode || "any",
      deviceMode: "local",
      name: "",
      gender: null,
    };
    let stepIndex = 0;

    // the step's title is in the frame above; this is the text under it
    function stepHeading(_title, description) {
      const p = document.createElement("p");
      p.className = "wz-note wz-note-left";
      p.textContent = description;
      formHost.appendChild(p);
    }

    function navButtons(nextLabel, onBack) {
      backHook = onBack || null;
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "wz-cta";
      nextBtn.textContent = nextLabel || "Далее";
      formHost.appendChild(nextBtn);
      return nextBtn;
    }

    function renderRulesStep() {
      const slides =
        RULES[formState.gameMode === "team" && formState.pairMode === "mixed" ? "team_mixed" : formState.gameMode] || RULES.truth_or_dare;
      const track = document.createElement("div");
      track.className = "wz-slides";
      slides.forEach((slide) => {
        const el = document.createElement("section");
        el.className = "wz-slide";
        el.innerHTML = `
          <div class="wz-slide-art" aria-hidden="true">${slide.emoji}</div>
          <h2></h2>
          <p></p>
          ${slide.demo ? `<div class="wz-demo"><span class="wz-demo-q"></span><span class="wz-demo-a"><em></em></span></div>` : ""}
        `;
        el.querySelector("h2").textContent = slide.title;
        el.querySelector("p").textContent = slide.text;
        if (slide.demo) {
          el.querySelector(".wz-demo-q").textContent = slide.demo.q;
          el.querySelector("em").textContent = slide.demo.a;
        }
        track.appendChild(el);
      });

      const dots = document.createElement("div");
      dots.className = "wz-dots";
      slides.forEach(() => dots.appendChild(document.createElement("i")));
      let index = 0;
      const next = document.createElement("button");
      next.type = "button";
      next.className = "wz-cta";
      function setIndex(i) {
        index = i;
        [...dots.children].forEach((d, n) => d.classList.toggle("on", n === i));
        next.textContent = i === slides.length - 1 ? "Понятно, дальше" : "Дальше";
      }
      track.addEventListener("scroll", () => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== index) setIndex(Math.max(0, Math.min(slides.length - 1, i)));
      });
      function goOn() {
        stepIndex += 1;
        renderStep();
      }
      next.addEventListener("click", () => {
        if (index < slides.length - 1) {
          const target = index + 1;
          setIndex(target);
          track.scrollTo({ left: track.clientWidth * target, behavior: "smooth" });
        } else {
          goOn();
        }
      });
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "wz-link";
      skip.textContent = "Пропустить правила";
      skip.addEventListener("click", goOn);

      formHost.classList.remove("wz-form", "wz-step");
      formHost.appendChild(track);
      formHost.appendChild(dots);
      formHost.appendChild(next);
      formHost.appendChild(skip);
      setIndex(0);
    }

    function nextButton(label) {
      const btn = navButtons(label);
      return btn;
    }

    // Step 2: where. One of four scene tiles.
    function renderLocationStep() {
      stepHeading("Где играем", "От места зависит, какие задания выпадут. На вопросы «правды» место не влияет.");
      const grid = document.createElement("div");
      grid.className = "pick-grid";
      LOCATIONS.forEach((loc) => {
        const art = LOCATION_ART[loc.value] || { emoji: "📍", note: "", tone: "l1" };
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = `loc-tile ${art.tone}`;
        tile.setAttribute("aria-pressed", String(loc.value === formState.location));
        tile.innerHTML = `
          <span class="loc-check" aria-hidden="true">✓</span>
          <span class="loc-art" aria-hidden="true">${art.emoji}</span>
          <b></b>
          <small></small>
        `;
        tile.querySelector("b").textContent = loc.label;
        tile.querySelector("small").textContent = art.note;
        tile.addEventListener("click", () => {
          formState.location = loc.value;
          grid.querySelectorAll(".loc-tile").forEach((t) => t.setAttribute("aria-pressed", String(t === tile)));
        });
        grid.appendChild(tile);
      });
      formHost.appendChild(grid);

      const nextBtn = nextButton();
      nextBtn.addEventListener("click", () => {
        stepIndex += 1;
        renderStep();
      });
    }

    // Step 3: how bold (several can be on) and what is at hand.
    function renderTypesStep() {
      stepHeading("Типы фантов", "Выберите накал. Можно несколько сразу.");
      const moods = new Set(formState.categories);
      const extras = new Set(formState.attributes);
      let errorEl = null; // cleared as soon as something is chosen

      // The account may have been made paid (or not) since this page loaded,
      // so ask the server again; if the answer differs, draw the step anew
      // (keeping what is already chosen).
      const paidWhenDrawn = isPaid();
      const thisStep = stepIndex;
      authApi
        .session()
        .catch(() => {})
        .then(() => {
          if (isPaid() === paidWhenDrawn || stepIndex !== thisStep) return;
          formState.categories = [...moods];
          formState.attributes = [...extras];
          renderStep();
        });

      // "Флирт+" is only for paid accounts: others see it locked, and the
      // server refuses it anyway.
      const locked = (value) => value === "flirt_plus" && !isPaid();
      let lockNote = null;

      MOOD_CATEGORIES.forEach((cat) => {
        const art = MOOD_ART[cat.value] || { emoji: "🎲", note: "", heat: 1, tint: "rgba(138, 92, 255, 0.2)" };
        const card = document.createElement("button");
        card.type = "button";
        card.className = "mood-card" + (locked(cat.value) ? " locked" : "");
        card.setAttribute("aria-pressed", String(moods.has(cat.value)));
        const heat = [1, 2, 3].map((n) => `<i class="${n <= art.heat ? "on" : ""}"></i>`).join("");
        card.innerHTML = `
          <span class="mood-emoji" style="background:${art.tint}" aria-hidden="true">${art.emoji}</span>
          <span class="mood-text"><b></b><small></small></span>
          <span class="mood-heat" aria-hidden="true">${heat}</span>
        `;
        card.querySelector("b").textContent = cat.label;
        card.querySelector("small").textContent = art.note;
        if (locked(cat.value)) card.querySelector(".mood-heat").innerHTML = "🔒";
        card.addEventListener("click", () => {
          if (locked(cat.value)) {
            if (lockNote) {
              lockNote.hidden = false;
              lockNote.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
            return;
          }
          if (moods.has(cat.value)) moods.delete(cat.value);
          else moods.add(cat.value);
          card.setAttribute("aria-pressed", String(moods.has(cat.value)));
          if (errorEl) errorEl.textContent = "";
        });
        formHost.appendChild(card);
      });

      lockNote = document.createElement("div");
      lockNote.className = "lock-note";
      lockNote.hidden = true;
      lockNote.innerHTML = `<b>🔒 «Флирт+» только для платного аккаунта.</b> ${
        isPaid() ? "" : "Игры такого типа могут создавать только пользователи с оплаченным аккаунтом."
      }`;
      formHost.appendChild(lockNote);

      const sec = document.createElement("div");
      sec.className = "step-section";
      sec.textContent = "Что есть под рукой";
      formHost.appendChild(sec);

      ATTRIBUTES.forEach((attr) => {
        const art = ATTRIBUTE_ART[attr.value] || { emoji: "✨", note: "" };
        const row = document.createElement("button");
        row.type = "button";
        row.className = "attr-row";
        row.setAttribute("aria-pressed", String(extras.has(attr.value)));
        row.innerHTML = `
          <span class="attr-emoji" aria-hidden="true">${art.emoji}</span>
          <span class="mood-text"><b></b><small></small></span>
          <span class="switch" aria-hidden="true"></span>
        `;
        row.querySelector("b").textContent = attr.label;
        row.querySelector("small").textContent = art.note;
        row.addEventListener("click", () => {
          if (extras.has(attr.value)) extras.delete(attr.value);
          else extras.add(attr.value);
          row.setAttribute("aria-pressed", String(extras.has(attr.value)));
          if (errorEl) errorEl.textContent = "";
        });
        formHost.appendChild(row);
      });

      errorEl = document.createElement("div");
      errorEl.className = "error-msg";
      formHost.appendChild(errorEl);

      const nextBtn = nextButton();
      nextBtn.addEventListener("click", () => {
        if (moods.size + extras.size === 0) {
          errorEl.textContent = "Выберите хотя бы один тип фантов";
          return;
        }
        formState.categories = [...moods];
        formState.attributes = [...extras];
        stepIndex += 1;
        renderStep();
      });
    }

    // Step 4: who the bottle picks. Two cards, each with a small picture of the circle.
    function renderPickStep() {
      stepHeading("Как выбирает бутылка", "Выберите правило розыгрыша.");
      const SEATS = [
        [47, 0, "🦊"],
        [94, 47, "🐸"],
        [47, 94, "🐼"],
        [0, 47, "🐵"],
      ];
      const PICK_INFO = {
        random: { note: "Каждый раз случайный игрок: кто-то может выпадать чаще.", done: false },
        fair: { note: "Пока все не выпадут по разу, никто не повторяется.", done: true },
      };
      const wrap = document.createElement("div");
      wrap.className = "pick-list";
      PICK_MODES.forEach((mode) => {
        const info = PICK_INFO[mode.value] || { note: "", done: false };
        const card = document.createElement("button");
        card.type = "button";
        card.className = "pick-card";
        card.setAttribute("aria-pressed", String(mode.value === formState.pickMode));
        const seats = SEATS.map(
          ([x, y, em], i) => `<span class="pick-seat${info.done && i < 3 ? " done" : ""}" style="left:${x}px;top:${y}px">${em}</span>`
        ).join("");
        card.innerHTML = `<b></b><span class="pick-ring">${seats}<span class="pick-bottle">🍾</span></span><small></small>`;
        card.querySelector("b").textContent = mode.label;
        card.querySelector("small").textContent = info.note;
        card.addEventListener("click", () => {
          formState.pickMode = mode.value;
          wrap.querySelectorAll(".pick-card").forEach((c) => c.setAttribute("aria-pressed", String(c === card)));
        });
        wrap.appendChild(card);
      });
      formHost.appendChild(wrap);

      const nextBtn = nextButton();
      nextBtn.addEventListener("click", () => {
        stepIndex += 1;
        renderStep();
      });
    }

    // Hidden from the wizard for now (renderStep never calls this) — fanty
    // always creates "local" rooms. Kept intact in case remote mode comes back.
    function renderDeviceStep() {
      stepHeading(
        "На каком устройстве",
        "Каждый заходит со своего телефона по ссылке, либо все игроки добавляются по очереди с одного устройства хоста."
      );
      const deviceGroup = radioGroup(
        "deviceMode",
        [
          {
            value: "remote",
            label: "Каждый со своего телефона",
            hint: "Каждый игрок заходит в комнату по ссылке или QR-коду со своего телефона.",
          },
          {
            value: "local",
            label: "Все с одного устройства",
            hint: "Играете все вместе с одного телефона или планшета — хост по очереди добавляет игроков перед началом.",
          },
        ],
        formState.deviceMode
      );
      formHost.appendChild(deviceGroup.element);

      const nextBtn = navButtons();
      nextBtn.addEventListener("click", () => {
        formState.deviceMode = deviceGroup.getValue();
        stepIndex += 1;
        renderStep();
      });
    }

    async function renderPlayerStep() {
      const minPlayers = MIN_PLAYERS_BY_MODE[formState.gameMode] || 2;
      stepHeading(
        "Игроки",
        `Вы — первый игрок и хост. Остальных добавите уже в комнате. Чтобы начать, нужно минимум ${minPlayers} игрока(ов).`
      );

      let profile = null;
      let authenticated = false;
      try {
        const session = await authApi.session();
        authenticated = Boolean(session.authenticated);
        if (!formState.name && session.authenticated && session.profileComplete) profile = session;
      } catch (e) {
        // not logged in or session check failed — fall back to a blank form
      }

      if (!authenticated) {
        const warning = document.createElement("div");
        warning.className = "guest-warning wz-note";
        warning.innerHTML = `⚠️ Вы не вошли в аккаунт — если случайно закроете игру, вернуться в эту комнату будет нельзя. <a href="/account">Войти</a>`;
        warning.querySelector("a").addEventListener("click", (e) => {
          e.preventDefault();
          navigate("/account");
        });
        formHost.appendChild(warning);
      }

      const nameInput = document.createElement("input");
      nameInput.className = "text-input";
      nameInput.placeholder = "Ваше имя";
      nameInput.maxLength = 20;
      if (formState.name) nameInput.value = formState.name;
      else if (profile) nameInput.value = profile.name;

      const picker = createAvatarPicker(
        !formState.name && profile ? { avatarType: profile.avatarType, avatarValue: profile.avatarValue } : undefined
      );

      const needsGender = formState.gameMode === "team" && formState.pairMode === "mixed";
      const genderLabel = document.createElement("label");
      genderLabel.textContent = "Ваш пол";
      const genderGroup = needsGender ? createGenderPicker(formState.gender) : null;

      const errorEl = document.createElement("div");
      errorEl.className = "error-msg";

      formHost.appendChild(nameInput);
      formHost.appendChild(picker.element);
      if (needsGender) {
        formHost.appendChild(genderLabel);
        formHost.appendChild(genderGroup.element);
        genderGroup.element.addEventListener("click", () => (errorEl.textContent = ""));
      }
      formHost.appendChild(errorEl);

      const nextBtn = navButtons("Создать комнату", () => {
        formState.name = nameInput.value.trim();
        if (needsGender) formState.gender = genderGroup.getValue();
      });
      nextBtn.addEventListener("click", async () => {
        const name = nameInput.value.trim();
        if (!name) {
          errorEl.textContent = "Введите имя";
          return;
        }
        const gender = needsGender ? genderGroup.getValue() : null;
        if (needsGender && !gender) {
          errorEl.textContent = "Выберите пол";
          return;
        }
        if (picker.isUploading()) {
          errorEl.textContent = "Дождитесь загрузки фото";
          return;
        }
        nextBtn.disabled = true;
        errorEl.textContent = "";
        try {
          const avatar = picker.getValue();
          const res = await fantyApi.createRoom({
            name,
            ...avatar,
            gender,
            deviceMode: formState.deviceMode,
            gameMode: formState.gameMode,
            location: formState.location,
            categories: [...formState.categories, ...formState.attributes],
            pickMode: formState.pickMode,
            pairMode: formState.pairMode,
          });
          saveSession(res.code, { token: res.token, playerId: res.playerId });
          navigate(`/fanty/r/${res.code}`);
        } catch (e) {
          errorEl.textContent = e.message;
          nextBtn.disabled = false;
        }
      });
    }

    function renderStep() {
      backHook = null;
      formHost = mountWizardFrame(container, {
        current: stepIndex + 1,
        total: TOTAL_STEPS,
        title: STEP_TITLES[stepIndex],
        onBack: () => {
          if (backHook) backHook();
          if (stepIndex > 0) {
            stepIndex -= 1;
            renderStep();
          } else {
            showModeStep();
          }
        },
      });
      formHost.classList.add("wz-form", "wz-step");

      if (stepIndex === 0) renderRulesStep();
      else if (stepIndex === 1) renderLocationStep();
      else if (stepIndex === 2) renderTypesStep();
      else if (stepIndex === 3) renderPickStep();
      else renderPlayerStep();
    }

    renderStep();
  }

  showModeStep();
}
