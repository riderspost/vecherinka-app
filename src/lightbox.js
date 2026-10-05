async function shareImage(src) {
  const absoluteUrl = new URL(src, window.location.origin).href;

  try {
    const resp = await fetch(src);
    const blob = await resp.blob();
    const filename = src.split("/").pop() || "photo.jpg";
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (e) {
    // Fall through to a link-based share below.
  }

  if (navigator.share) {
    try {
      await navigator.share({ url: absoluteUrl });
      return;
    } catch (e) {
      return; // user cancelled the share sheet
    }
  }

  try {
    await navigator.clipboard.writeText(absoluteUrl);
    alert("Ссылка на фото скопирована в буфер обмена");
  } catch (e) {
    window.open(absoluteUrl, "_blank");
  }
}

export function openLightbox(src) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";

  const img = document.createElement("img");
  img.src = src;
  img.className = "lightbox-img";
  img.addEventListener("click", (e) => e.stopPropagation());

  const closeBtn = document.createElement("button");
  closeBtn.className = "lightbox-close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Закрыть");

  const shareBtn = document.createElement("button");
  shareBtn.className = "lightbox-share";
  shareBtn.textContent = "📤 Поделиться";

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }
  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  overlay.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    shareImage(src);
  });
  document.addEventListener("keydown", onKeydown);

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  overlay.appendChild(shareBtn);
  document.body.appendChild(overlay);
}
