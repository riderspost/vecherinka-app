import { api, fantyApi } from "../../api.js";
import { saveSession } from "../../storage.js";
import { navigate } from "../../router.js";
import { createAvatarPicker } from "../../avatarPicker.js";
import { LOCATIONS, MOOD_CATEGORIES, ATTRIBUTES, GAME_MODES, PICK_MODES, MIN_PLAYERS_BY_MODE } from "./constants.js";

const TOTAL_STEPS = 5;

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
    wrap.appendChild(label);
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

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  const createTab = document.createElement("button");
  createTab.className = "tab active";
  createTab.textContent = "Создать комнату";
  const joinTab = document.createElement("button");
  joinTab.className = "tab";
  joinTab.textContent = "У меня есть код";
  tabs.appendChild(createTab);
  tabs.appendChild(joinTab);
  wrap.appendChild(tabs);

  const formHost = document.createElement("div");
  wrap.appendChild(formHost);
  container.appendChild(wrap);

  function showCreateForm() {
    createTab.classList.add("active");
    joinTab.classList.remove("active");

    const formState = {
      gameMode: "truth_or_dare",
      location: LOCATIONS[0].value,
      categories: ["basic"],
      attributes: [],
      pickMode: "fair",
      deviceMode: "remote",
      name: "",
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
      if (stepIndex > 0) {
        const backBtn = document.createElement("button");
        backBtn.className = "btn";
        backBtn.textContent = "Назад";
        backBtn.addEventListener("click", () => {
          if (onBack) onBack();
          stepIndex -= 1;
          renderStep();
        });
        row.appendChild(backBtn);
      }
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

      const nextBtn = navButtons();
      nextBtn.addEventListener("click", () => {
        formState.gameMode = modeGroup.getValue();
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

    function renderDeviceStep() {
      stepHeading(
        "На каком устройстве",
        "Каждый заходит со своего телефона по ссылке, либо все игроки добавляются по очереди с одного устройства хоста."
      );
      const deviceGroup = radioGroup(
        "deviceMode",
        [
          { value: "remote", label: "Каждый со своего телефона" },
          { value: "local", label: "Все с одного устройства" },
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

    function renderPlayerStep() {
      const minPlayers = MIN_PLAYERS_BY_MODE[formState.gameMode] || 2;
      stepHeading(
        "Игроки",
        `Вы — первый игрок и хост. Остальных добавите уже в комнате. Чтобы начать, нужно минимум ${minPlayers} игрока(ов).`
      );

      const nameInput = document.createElement("input");
      nameInput.className = "text-input";
      nameInput.placeholder = "Ваше имя";
      nameInput.maxLength = 30;
      if (formState.name) nameInput.value = formState.name;

      const picker = createAvatarPicker();

      const errorEl = document.createElement("div");
      errorEl.className = "error-msg";

      formHost.appendChild(nameInput);
      formHost.appendChild(picker.element);
      formHost.appendChild(errorEl);

      const nextBtn = navButtons("Создать комнату", () => {
        formState.name = nameInput.value.trim();
      });
      nextBtn.addEventListener("click", async () => {
        const name = nameInput.value.trim();
        if (!name) {
          errorEl.textContent = "Введите имя";
          return;
        }
        nextBtn.disabled = true;
        errorEl.textContent = "";
        try {
          const avatar = picker.getValue();
          const res = await fantyApi.createRoom({
            name,
            ...avatar,
            deviceMode: formState.deviceMode,
            gameMode: formState.gameMode,
            location: formState.location,
            categories: [...formState.categories, ...formState.attributes],
            pickMode: formState.pickMode,
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
      else if (stepIndex === 3) renderDeviceStep();
      else renderPlayerStep();
    }

    renderStep();
  }

  function showJoinForm() {
    joinTab.classList.add("active");
    createTab.classList.remove("active");
    formHost.innerHTML = "";

    const codeInput = document.createElement("input");
    codeInput.className = "text-input code-input";
    codeInput.placeholder = "КОД КОМНАТЫ";
    codeInput.maxLength = 5;

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 30;

    const picker = createAvatarPicker();

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Присоединиться";

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    btn.addEventListener("click", async () => {
      const code = codeInput.value.trim().toUpperCase();
      const name = nameInput.value.trim();
      if (!code || !name) {
        errorEl.textContent = "Заполните код и имя";
        return;
      }
      btn.disabled = true;
      errorEl.textContent = "";
      try {
        const avatar = picker.getValue();
        const res = await api.joinRoom(code, { name, ...avatar });
        saveSession(res.code, { token: res.token, playerId: res.playerId });
        navigate(`/fanty/r/${res.code}`);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    formHost.appendChild(codeInput);
    formHost.appendChild(nameInput);
    formHost.appendChild(picker.element);
    formHost.appendChild(errorEl);
    formHost.appendChild(btn);
  }

  createTab.addEventListener("click", showCreateForm);
  joinTab.addEventListener("click", showJoinForm);
  showCreateForm();
}
