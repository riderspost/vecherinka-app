import { canPromptInstall, detectPlatform, promptInstall } from "./pwaInstall.js";
import { isInstalled, isOpenedAsApp, markInstalled } from "./installState.js";
import { enableSwipeDown } from "./swipeSheet.js";

const TABS = [
  { id: "ios", label: "iPhone" },
  { id: "android", label: "Android" },
  { id: "desktop", label: "Компьютер" },
];

let sheetEl = null;

export function closeInstallSheet() {
  if (sheetEl) sheetEl.remove();
  sheetEl = null;
}

function stepsHtml(steps) {
  return `<ul class="inst-steps">${steps
    .map((s, i) => `<li><span class="inst-n">${i + 1}</span><span>${s.text}</span><span class="inst-ico" aria-hidden="true">${s.icon}</span></li>`)
    .join("")}</ul>`;
}

// A bottom sheet with what to do on this person's device, or, once the app is
// on the phone, a confirmation.
export function openInstallSheet() {
  closeInstallSheet();
  let tab = detectPlatform();
  let showSteps = false; // from the "installed" view, to look at the steps again

  sheetEl = document.createElement("div");
  sheetEl.className = "inst-bg";
  sheetEl.addEventListener("click", (e) => {
    if (e.target === sheetEl) closeInstallSheet();
  });
  document.body.appendChild(sheetEl);
  draw();
  const onChange = () => {
    if (!sheetEl || !sheetEl.isConnected) {
      window.removeEventListener("plynger:install-changed", onChange);
      return;
    }
    showSteps = false;
    draw();
  };
  window.addEventListener("plynger:install-changed", onChange);

  function frame(inner) {
    sheetEl.innerHTML = `<div class="inst-sheet"><div class="inst-grab sheet-handle"></div>${inner}</div>`;
    enableSwipeDown(sheetEl.firstChild, closeInstallSheet);
    return sheetEl.firstChild;
  }

  function draw() {
    if (isInstalled() && !showSteps) return drawInstalled();
    const sheet = frame(`
      <h2 class="inst-title">Установить на телефон</h2>
      <p class="inst-text">Игра откроется как приложение: иконка на экране и без адресной строки.</p>
      <div class="inst-tabs" role="tablist">${TABS.map(
        (t) => `<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.label}</button>`
      ).join("")}</div>
      <div class="inst-body"></div>
    `);
    sheet.querySelectorAll(".inst-tabs button").forEach((b) =>
      b.addEventListener("click", () => {
        tab = b.dataset.tab;
        draw();
      })
    );
    const body = sheet.querySelector(".inst-body");
    if (tab === "ios") drawIos(body);
    else if (tab === "android") drawAndroid(body);
    else drawDesktop(body);
  }

  // There is no "I did it" button: the app finds out by itself. The browser
  // announces an install on Android and desktop, and from the icon the game
  // opens as an app, which it can recognise (see installState.js).
  function autoNote(body) {
    const note = document.createElement("p");
    note.className = "inst-hint";
    note.textContent = "Когда игра появится на экране и вы откроете её с иконки, здесь появится отметка «Установлено».";
    body.appendChild(note);
  }

  function drawIos(body) {
    body.innerHTML =
      stepsHtml([
        { text: "Нажмите «Поделиться» внизу экрана Safari", icon: "⬆️" },
        { text: "Выберите «На экран «Домой»»", icon: "➕" },
        { text: "Нажмите «Добавить»", icon: "✅" },
      ]) + `<p class="inst-hint">Установить можно только из Safari: в других браузерах на iPhone такого пункта нет.</p>`;
    autoNote(body);
  }

  function drawAndroid(body) {
    if (canPromptInstall()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "inst-cta";
      btn.textContent = "📲 Установить";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const ok = await promptInstall();
        if (ok) {
          showSteps = false;
          markInstalled();
          draw();
        } else {
          btn.disabled = false;
        }
      });
      body.appendChild(btn);
      return;
    }
    body.innerHTML = stepsHtml([
      { text: "Откройте меню браузера (три точки в углу)", icon: "⋮" },
      { text: "Выберите «Установить приложение» или «Добавить на главный экран»", icon: "📲" },
    ]);
    autoNote(body);
  }

  function drawDesktop(body) {
    const url = window.location.origin;
    body.innerHTML = `
      <p class="inst-text">Откройте PLYNGER в браузере телефона и добавьте на экран. Наведите камеру на код:</p>
      <img class="inst-qr" alt="QR-код сайта" src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(url)}" />
    `;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "inst-ghost";
    copy.textContent = "Скопировать ссылку";
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(url).catch(() => {});
      copy.textContent = "Ссылка скопирована";
      setTimeout(() => (copy.textContent = "Скопировать ссылку"), 1500);
    });
    body.appendChild(copy);
  }

  function drawInstalled() {
    const asApp = isOpenedAsApp();
    const sheet = frame(`
      <div class="inst-done">
        <div class="inst-done-mark" aria-hidden="true">✅</div>
        <h2 class="inst-title">PLYNGER на вашем телефоне</h2>
        <p class="inst-text">${
          asApp
            ? "Вы сейчас в приложении. Открывайте игру с иконки на главном экране."
            : "Открывайте игру с иконки на главном экране: так быстрее, чем через браузер."
        }</p>
      </div>
    `);
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "inst-cta";
    ok.textContent = "Готово";
    ok.addEventListener("click", closeInstallSheet);
    sheet.appendChild(ok);
    if (!asApp) {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "inst-link";
      again.textContent = "Не появилась иконка? Показать шаги ещё раз";
      again.addEventListener("click", () => {
        showSteps = true;
        draw();
      });
      sheet.appendChild(again);
    }
  }
}
