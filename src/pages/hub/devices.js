import { DEVICE_LABEL } from "../../games.js";

function phoneSvg(w, h) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 10 17" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1" y="1" width="8" height="15" rx="2"/><circle cx="5" cy="13.4" r=".7" fill="currentColor" stroke="none"/></svg>`;
}

// One phone, or three side by side: shows at a glance whether a game is
// played from a single device or from everyone's own.
export function phonesIconHtml(devices) {
  const inner = devices === "shared" ? phoneSvg(11, 19) : phoneSvg(9, 16) + phoneSvg(11, 19) + phoneSvg(9, 16);
  return `<span class="hub-phones">${inner}</span>`;
}

export function deviceLabel(devices) {
  return DEVICE_LABEL[devices] || DEVICE_LABEL.own;
}
