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
