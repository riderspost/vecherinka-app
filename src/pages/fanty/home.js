import { fantyApi, authApi } from "../../api.js";
import { saveSession } from "../../storage.js";
import { navigate } from "../../router.js";
import { createAvatarPicker } from "../../avatarPicker.js";
import {
  LOCATIONS,
  MOOD_CATEGORIES,
  ATTRIBUTES,
  GAME_MODES,
  PICK_MODES,
  PAIR_MODES,
  GENDERS,
  MIN_PLAYERS_BY_MODE,
} from "./constants.js";

const TOTAL_STEPS = 4;

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
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "screen home-screen";
  wrap.innerHTML = `
    <h1 class="logo">🍾 Фанты</h1>
    <p class="tagline">Правда, действие и командные фанты для компании</p>
  `;

  const homeLink = document.createElement("a");
  homeLink.className = "link-btn";
  homeLink.href = "/";
  homeLink.textContent = "← На главную";
  homeLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/");
  });
  wrap.appendChild(homeLink);

  const submitLink = document.createElement("a");
  submitLink.className = "link-btn";
  submitLink.href = "/fanty/submit";
  submitLink.textContent = "Предложить свой фант или вопрос";
  submitLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/fanty/submit");
  });
  wrap.appendChild(submitLink);

  const formHost = document.createElement("div");
  wrap.appendChild(formHost);
  container.appendChild(wrap);

  function showCreateForm() {
    const formState = {
      gameMode: "truth_or_dare",
      location: LOCATIONS[0].value,
      categories: ["basic"],
      attributes: [],
      pickMode: "fair",
      pairMode: "any",
      deviceMode: "local",
      name: "",
      gender: null,
    };
    let stepIndex = 0;

    function stepHeading(title, description) {
      const h = document.createElement("h2");
      h.textContent = title;
      formHost.appendChild(h);
      const p = document.createElement("p");
      p.className = "tagline";
      p.textContent = description;
      formHost.appendChild(p);
    }

    function navButtons(nextLabel, onBack) {
      const row = document.createElement("div");
      row.className = "row-actions";
      const backBtn = document.createElement("button");
      backBtn.className = "btn";
      backBtn.textContent = "Назад";
      backBtn.addEventListener("click", () => {
        if (onBack) onBack();
        if (stepIndex > 0) {
          stepIndex -= 1;
          renderStep();
        } else {
          navigate("/");
        }
      });
      row.appendChild(backBtn);
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-primary";
      nextBtn.textContent = nextLabel || "Далее";
      row.appendChild(nextBtn);
      formHost.appendChild(row);
      return nextBtn;
    }

    function renderGameModeStep() {
      stepHeading(
        "Тип игры",
        "«Правда или действие» — бутылка выбирает игрока, который сам решает, сказать правду или выполнить действие. «Просто фанты» — бутылка сразу даёт задание одному игроку. «Командные фанты» — бутылка крутится дважды и выбирает пару для совместного задания."
      );
      const modeGroup = radioGroup("gameMode", GAME_MODES, formState.gameMode);
      formHost.appendChild(modeGroup.element);

      const pairModeWrap = document.createElement("div");
      const pairModeLabelEl = document.createElement("label");
      pairModeLabelEl.textContent = "Кто может быть в паре";
      const pairModeGroup = radioGroup("pairMode", PAIR_MODES, formState.pairMode);
      pairModeWrap.appendChild(pairModeLabelEl);
      pairModeWrap.appendChild(pairModeGroup.element);
      pairModeWrap.hidden = formState.gameMode !== "team";
      formHost.appendChild(pairModeWrap);

      modeGroup.element.addEventListener("change", () => {
        pairModeWrap.hidden = modeGroup.getValue() !== "team";
      });

      const nextBtn = navButtons();
      nextBtn.addEventListener("click", () => {
        formState.gameMode = modeGroup.getValue();
        formState.pairMode = formState.gameMode === "team" ? pairModeGroup.getValue() : "any";
        stepIndex += 1;
        renderStep();
      });
    }

    function renderLocationStep() {
      stepHeading(
        "Где играем",
        "Место определяет, какие фанты (действия) будут предлагаться. На вопросы «правды» место не влияет."
      );
      const locationGroup = radioGroup("location", LOCATIONS, formState.location);
      formHost.appendChild(locationGroup.element);

      const nextBtn = navButtons();
      nextBtn.addEventListener("click", () => {
        formState.location = locationGroup.getValue();
        stepIndex += 1;
        renderStep();
      });
    }

    function renderSettingsStep() {
      stepHeading(
        "Как играем",
        "Выберите типы фантов, атрибуты, которые реально есть под рукой (если их нет — не отмечайте), и то, как бутылка выбирает игрока."
      );

      const categoriesLabel = document.createElement("label");
      categoriesLabel.textContent = "Типы фантов";
      const categoriesGroup = checkboxGroup(MOOD_CATEGORIES, formState.categories);

      const attributesLabel = document.createElement("label");
      attributesLabel.textContent = "Доступные атрибуты";
      const attributesGroup = checkboxGroup(ATTRIBUTES, formState.attributes);

      const pickModeLabelEl = document.createElement("label");
      pickModeLabelEl.textContent = "Кого выбирает бутылка";
      const pickModeGroup = radioGroup("pickMode", PICK_MODES, formState.pickMode);

      const errorEl = document.createElement("div");
      errorEl.className = "error-msg";

      formHost.appendChild(categoriesLabel);
      formHost.appendChild(categoriesGroup.element);
      formHost.appendChild(attributesLabel);
      formHost.appendChild(attributesGroup.element);
      formHost.appendChild(pickModeLabelEl);
      formHost.appendChild(pickModeGroup.element);
      formHost.appendChild(errorEl);

      const nextBtn = navButtons();
      nextBtn.addEventListener("click", () => {
        const categories = categoriesGroup.getValue();
        const attributes = attributesGroup.getValue();
        if (categories.length + attributes.length === 0) {
          errorEl.textContent = "Выберите хотя бы один тип фантов";
          return;
        }
        formState.categories = categories;
        formState.attributes = attributes;
        formState.pickMode = pickModeGroup.getValue();
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
      if (!formState.name) {
        try {
          const session = await authApi.session();
          if (session.authenticated && session.profileComplete) profile = session;
        } catch (e) {
          // not logged in or session check failed — fall back to a blank form
        }
      }

      const nameInput = document.createElement("input");
      nameInput.className = "text-input";
      nameInput.placeholder = "Ваше имя";
      nameInput.maxLength = 30;
      if (formState.name) nameInput.value = formState.name;
      else if (profile) nameInput.value = profile.name;

      const picker = createAvatarPicker(
        !formState.name && profile ? { avatarType: profile.avatarType, avatarValue: profile.avatarValue } : undefined
      );

      const needsGender = formState.gameMode === "team" && formState.pairMode === "mixed";
      const genderLabel = document.createElement("label");
      genderLabel.textContent = "Ваш пол";
      const genderGroup = needsGender ? radioGroup("gender", GENDERS, formState.gender) : null;

      const errorEl = document.createElement("div");
      errorEl.className = "error-msg";

      formHost.appendChild(nameInput);
      formHost.appendChild(picker.element);
      if (needsGender) {
        formHost.appendChild(genderLabel);
        formHost.appendChild(genderGroup.element);
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
      formHost.innerHTML = "";

      const stepLabel = document.createElement("p");
      stepLabel.className = "tagline";
      stepLabel.textContent = `Шаг ${stepIndex + 1} из ${TOTAL_STEPS}`;
      formHost.appendChild(stepLabel);

      if (stepIndex === 0) renderGameModeStep();
      else if (stepIndex === 1) renderLocationStep();
      else if (stepIndex === 2) renderSettingsStep();
      else renderPlayerStep();
    }

    renderStep();
  }

  showCreateForm();
}
