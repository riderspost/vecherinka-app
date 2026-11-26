import { detectPlatform } from "../../pwaInstall.js";
import { bannerDismissed, dismissBanner, isInstalled, isOpenedAsApp } from "../../installState.js";
import { openInstallSheet } from "../../installSheet.js";

// A banner at the top of the games screen, for phones that have not got the
// app yet and have not dismissed it in the last two weeks. It goes away by
// itself once the app is installed.
export function renderInstallBanner(parent) {
  const slot = document.createElement("div");
  parent.appendChild(slot);

  function draw() {
    slot.innerHTML = "";
    if (detectPlatform() === "desktop" || isInstalled() || bannerDismissed()) return;
    const banner = document.createElement("div");
    banner.className = "inst-banner";
    banner.innerHTML = `
      <div class="inst-banner-icon" aria-hidden="true">P</div>
      <div class="inst-banner-text"><b>Добавьте PLYNGER на телефон</b><small>Заходите в игру в один клик</small></div>
      <button type="button" class="inst-banner-go">Как</button>
      <button type="button" class="inst-banner-x" aria-label="Скрыть на две недели">✕</button>
    `;
    banner.querySelector(".inst-banner-go").addEventListener("click", openInstallSheet);
    banner.querySelector(".inst-banner-x").addEventListener("click", dismissBanner);
    slot.appendChild(banner);
  }

  draw();
  const onChange = () => {
    if (!slot.isConnected) {
      window.removeEventListener("plynger:install-changed", onChange);
      return;
    }
    draw();
  };
  window.addEventListener("plynger:install-changed", onChange);
}

// The "install" row of the profile list. Before: an action. After: a quiet
// confirmation that still opens the sheet (to see the steps again).
export function installRow() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hub-row";

  function draw() {
    const installed = isInstalled();
    btn.classList.toggle("hub-row-done", installed);
    btn.innerHTML = installed
      ? `<span class="hub-row-icon" aria-hidden="true">✅</span>
         <span class="hub-row-text">Приложение на телефоне<small>${isOpenedAsApp() ? "Вы сейчас в приложении" : "Установлено"}</small></span>
         <span class="hub-row-arrow" aria-hidden="true">›</span>`
      : `<span class="hub-row-icon" aria-hidden="true">📲</span>
         <span class="hub-row-text">Установить на телефон<small>Иконка на экране, без адресной строки</small></span>
         <span class="hub-row-arrow" aria-hidden="true">›</span>`;
  }

  draw();
  btn.addEventListener("click", openInstallSheet);
  const onChange = () => {
    if (!btn.isConnected) {
      window.removeEventListener("plynger:install-changed", onChange);
      return;
    }
    draw();
  };
  window.addEventListener("plynger:install-changed", onChange);
  return btn;
}
