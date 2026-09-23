import { api, fantyApi } from "../../api.js";
import { saveSession } from "../../storage.js";
import { navigate } from "../../router.js";
import { createAvatarPicker } from "../../avatarPicker.js";
import { LOCATIONS, CATEGORIES, GAME_MODES, PICK_MODES } from "./constants.js";

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
    formHost.innerHTML = "";

    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.placeholder = "Ваше имя";
    nameInput.maxLength = 30;

    const picker = createAvatarPicker();

    const deviceLabel = document.createElement("label");
    deviceLabel.textContent = "Как играем?";
    const deviceGroup = radioGroup(
      "deviceMode",
      [
        { value: "remote", label: "Каждый со своего телефона" },
        { value: "local", label: "Все с одного устройства" },
      ],
      "remote"
    );

    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Режим игры";
    const modeGroup = radioGroup("gameMode", GAME_MODES, "truth_or_dare");

    const locationLabelEl = document.createElement("label");
    locationLabelEl.textContent = "Место игры";
    const locationSelect = document.createElement("select");
    locationSelect.className = "text-input";
    LOCATIONS.forEach((loc) => {
      const opt = document.createElement("option");
      opt.value = loc.value;
      opt.textContent = loc.label;
      locationSelect.appendChild(opt);
    });

    const categoriesLabel = document.createElement("label");
    categoriesLabel.textContent = "Типы фантов";
    const categoriesGroup = checkboxGroup(CATEGORIES, ["basic"]);

    const pickModeLabelEl = document.createElement("label");
    pickModeLabelEl.textContent = "Кого выбирает бутылка";
    const pickModeGroup = radioGroup("pickMode", PICK_MODES, "random");

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Создать комнату";

    const errorEl = document.createElement("div");
    errorEl.className = "error-msg";

    btn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.textContent = "Введите имя";
        return;
      }
      const categories = categoriesGroup.getValue();
      if (categories.length === 0) {
        errorEl.textContent = "Выберите хотя бы один тип фантов";
        return;
      }
      btn.disabled = true;
      errorEl.textContent = "";
      try {
        const avatar = picker.getValue();
        const res = await fantyApi.createRoom({
          name,
          ...avatar,
          deviceMode: deviceGroup.getValue(),
          gameMode: modeGroup.getValue(),
          location: locationSelect.value,
          categories,
          pickMode: pickModeGroup.getValue(),
        });
        saveSession(res.code, { token: res.token, playerId: res.playerId });
        navigate(`/fanty/r/${res.code}`);
      } catch (e) {
        errorEl.textContent = e.message;
        btn.disabled = false;
      }
    });

    formHost.appendChild(nameInput);
    formHost.appendChild(picker.element);
    formHost.appendChild(deviceLabel);
    formHost.appendChild(deviceGroup.element);
    formHost.appendChild(modeLabel);
    formHost.appendChild(modeGroup.element);
    formHost.appendChild(locationLabelEl);
    formHost.appendChild(locationSelect);
    formHost.appendChild(categoriesLabel);
    formHost.appendChild(categoriesGroup.element);
    formHost.appendChild(pickModeLabelEl);
    formHost.appendChild(pickModeGroup.element);
    formHost.appendChild(errorEl);
    formHost.appendChild(btn);
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
