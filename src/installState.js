// Whether PLYNGER is installed on this phone, as far as a web page can tell.
//
//  - Opened as an installed app (standalone): certainly installed.
//  - Android/desktop Chrome fires `appinstalled` after installing: remembered.
//  - iPhone says nothing outside the app: the mark appears once the game is
//    opened from the home-screen icon.
// The answer is remembered in this browser; everything that shows install
// UI listens for "plynger:install-changed" and redraws.

import { isRunningStandalone } from "./pwaInstall.js";

// The first versions had an "I added it" button that wrote the mark by hand;
// those old marks (key without the suffix) are dropped, since nothing proves
// they are true.
const OLD_INSTALLED_KEY = "plynger-installed";
const INSTALLED_KEY = "plynger-installed-v2";
const DISMISS_KEY = "plynger-install-banner-dismissed";
const BANNER_PAUSE_DAYS = 14;

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {
    // storage blocked: the state just won't be remembered
  }
}

function changed() {
  window.dispatchEvent(new Event("plynger:install-changed"));
}

export function isInstalled() {
  return isRunningStandalone() || read(INSTALLED_KEY) === "1";
}

// True only when this very window is the installed app.
export function isOpenedAsApp() {
  return isRunningStandalone();
}

export function markInstalled() {
  write(INSTALLED_KEY, "1");
  changed();
}

export function clearInstalled() {
  write(INSTALLED_KEY, null);
  changed();
}

export function bannerDismissed() {
  const at = Number(read(DISMISS_KEY));
  return Boolean(at) && Date.now() - at < BANNER_PAUSE_DAYS * 24 * 3600 * 1000;
}

export function dismissBanner() {
  write(DISMISS_KEY, String(Date.now()));
  changed();
}

write(OLD_INSTALLED_KEY, null);
window.addEventListener("appinstalled", markInstalled);
if (isRunningStandalone()) write(INSTALLED_KEY, "1");
