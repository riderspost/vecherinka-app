// Captured as early as possible (imported for its side effect at the top
// of main.js) so a real "Установить" button can trigger the native prompt on
// Android/desktop Chrome. iOS Safari never fires this event — there's no
// programmatic install there, only the manual Share -> На экран «Домой»
// flow, which is why the two platforms render completely different UI below.
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
});

export function detectPlatform() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export function isRunningStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function canPromptInstall() {
  return Boolean(deferredInstallPrompt);
}

export async function promptInstall() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  return outcome === "accepted";
}

export function pwaInstallSectionHtml() {
  if (isRunningStandalone()) {
    return `<div class="badge">✅ Приложение уже установлено</div>`;
  }

  if (detectPlatform() === "ios") {
    return `
      <ol class="pwa-steps">
        <li>Нажмите кнопку «Поделиться» <span class="pwa-icon">⬆️</span> внизу экрана Safari</li>
        <li>Выберите «На экран «Домой»»</li>
        <li>Нажмите «Добавить» — готово, иконка появится на главном экране</li>
      </ol>
    `;
  }

  if (canPromptInstall()) {
    return `<button type="button" class="btn" id="pwa-install-btn">📲 Установить приложение</button>`;
  }

  return `
    <ol class="pwa-steps">
      <li>Откройте меню браузера (⋮ в правом верхнем углу)</li>
      <li>Выберите «Установить приложение» или «Добавить на главный экран»</li>
    </ol>
  `;
}

export function wirePwaInstallButton(container) {
  const btn = container.querySelector("#pwa-install-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const installed = await promptInstall();
    if (installed) {
      btn.outerHTML = `<div class="badge">✅ Установлено</div>`;
    }
  });
}
