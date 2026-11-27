export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

const NAME_DISPLAY_LEN = 15;

// Player names can be up to 20 characters (server-enforced), which is too
// wide for the bottle-table seat labels in Fanty. Cuts it to
// NAME_DISPLAY_LEN and marks the result with a `.truncated-name` class —
// renderBottleCircle (fanty/room.js) checks for that class to decide
// whether the seat's avatar should reveal a full-name tooltip on tap.
// Names that already fit are returned as plain escaped text.
export function truncatedNameHtml(name) {
  const full = name == null ? "" : String(name);
  if (full.length <= NAME_DISPLAY_LEN) return escapeHtml(full);
  const short = escapeHtml(full.slice(0, NAME_DISPLAY_LEN));
  return `<span class="truncated-name">${short}…</span>`;
}

// Round-result photo uploads save a much smaller "<name>_thumb.<ext>" copy
// alongside the full-size file (see upload_photo in fanty_routes.py) — this
// derives its URL from the full one so grids/lists can load the light
// version and only fetch the full image when actually opened in the
// lightbox. Falls back to the full URL itself if it doesn't look like an
// uploaded photo path (nothing to derive a thumb from).
export function thumbUrl(fullUrl) {
  if (!fullUrl) return fullUrl;
  const match = fullUrl.match(/^(.*)(\.[a-zA-Z0-9]+)$/);
  if (!match) return fullUrl;
  return `${match[1]}_thumb${match[2]}`;
}

// A double tap (two quick taps in the same place, or a double click) on `el`.
// iOS Safari does not send "dblclick" reliably, so the taps are timed by hand.
export function enableDoubleTap(el, onDoubleTap) {
  const MAX_GAP_MS = 350;
  const MAX_MOVE_PX = 30;
  let last = null;
  el.style.touchAction = "manipulation";
  el.addEventListener("pointerup", (e) => {
    const now = Date.now();
    if (last && now - last.t <= MAX_GAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= MAX_MOVE_PX) {
      last = null;
      onDoubleTap(e);
    } else {
      last = { t: now, x: e.clientX, y: e.clientY };
    }
  });
}
