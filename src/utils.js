export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
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

// A tappable 🔥 reaction for a question/dare, so the admin can later see
// which content players actually liked. `onLike` is called once per click;
// the button disables itself right after so one tap can't be spammed into
// many likes. Not tracked per-player server-side — a lightweight "people in
// the room liked this" signal, not a strict one-vote-per-person tally.
export function createFireButton(onLike) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fire-btn";
  btn.textContent = "🔥";
  btn.setAttribute("aria-label", "Нравится");
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add("fire-btn-liked");
    try {
      await onLike();
    } catch (e) {
      // Non-critical reaction — leave it marked liked even if the request failed.
    }
  });
  return btn;
}
