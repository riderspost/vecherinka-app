// A small <img> wrapped in a spinner placeholder that's shown until the
// image actually loads, used anywhere photos are displayed as thumbnails
// (round-resolve previews, the results grid) so a slow/large image doesn't
// just leave a blank gap. Tries thumbSrc first; if that 404s (e.g. a photo
// uploaded before thumbnails existed) it falls back to the full image.
export function createPhotoThumb(thumbSrc, fullSrc, imgClassName) {
  const wrap = document.createElement("div");
  wrap.className = "photo-thumb-wrap";

  const spinner = document.createElement("div");
  spinner.className = "photo-thumb-spinner";
  wrap.appendChild(spinner);

  const img = document.createElement("img");
  img.className = imgClassName;
  img.addEventListener(
    "load",
    () => {
      wrap.classList.add("loaded");
    },
    { once: true }
  );
  img.addEventListener("error", () => {
    if (thumbSrc && img.src.endsWith(thumbSrc) && fullSrc && thumbSrc !== fullSrc) {
      img.src = fullSrc;
    } else {
      wrap.classList.add("loaded");
    }
  });
  img.src = thumbSrc || fullSrc;
  wrap.appendChild(img);

  return { wrap, img };
}
