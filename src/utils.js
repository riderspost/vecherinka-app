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

// A tappable 🔥 reaction for a dare, so the admin can later see which ones
// players actually enjoyed. Toggles on/off — `onToggle(nextLiked)` is
// called with the new state and must call the matching like/unlike API;
// the button reverts its visual state if that call fails. Not tracked
// per-player server-side — a lightweight "people in the room liked this"
// signal, not a strict one-vote-per-person tally.
export function createFireButton(initiallyLiked, onToggle) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn fire-btn";

  const label = document.createElement("span");
  label.textContent = "🔥 Классный фант!";
  btn.appendChild(label);

  let liked = Boolean(initiallyLiked);
  btn.classList.toggle("fire-btn-liked", liked);
  btn.setAttribute("aria-pressed", String(liked));

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const next = !liked;
    btn.disabled = true;
    btn.classList.toggle("fire-btn-liked", next);
    btn.setAttribute("aria-pressed", String(next));
    try {
      await onToggle(next);
      liked = next;
    } catch (e) {
      // Revert the visual state — the toggle didn't actually take.
      btn.classList.toggle("fire-btn-liked", liked);
      btn.setAttribute("aria-pressed", String(liked));
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}
