function absoluteUrl(src) {
  return new URL(src, window.location.origin).href;
}

async function fileFromSrc(src) {
  const resp = await fetch(src);
  const blob = await resp.blob();
  const filename = src.split("/").pop() || "photo.jpg";
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

async function shareImage(src) {
  try {
    const file = await fileFromSrc(src);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (e) {
    // Fall through to a link-based share below.
  }

  const url = absoluteUrl(src);
  if (navigator.share) {
    try {
      await navigator.share({ url });
      return;
    } catch (e) {
      return; // user cancelled the share sheet
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    alert("Ссылка на фото скопирована в буфер обмена");
  } catch (e) {
    window.open(url, "_blank");
  }
}

export async function shareAllImages(sources) {
  if (sources.length === 0) return;
  if (sources.length === 1) {
    await shareImage(sources[0]);
    return;
  }

  try {
    const files = await Promise.all(sources.map(fileFromSrc));
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files });
      return;
    }
  } catch (e) {
    // Fall through to a link-list fallback below.
  }

  const urls = sources.map(absoluteUrl);
  if (navigator.share) {
    try {
      await navigator.share({ text: urls.join("\n") });
      return;
    } catch (e) {
      return; // user cancelled the share sheet
    }
  }

  try {
    await navigator.clipboard.writeText(urls.join("\n"));
    alert(`Ссылки на все фото (${urls.length}) скопированы в буфер обмена`);
  } catch (e) {
    urls.forEach((url) => window.open(url, "_blank"));
  }
}

export function openLightbox(sources, startIndex = 0) {
  const list = Array.isArray(sources) ? sources : [sources];
  let index = startIndex;

  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";

  const img = document.createElement("img");
  img.className = "lightbox-img";
  img.addEventListener("click", (e) => e.stopPropagation());

  const closeBtn = document.createElement("button");
  closeBtn.className = "lightbox-close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Закрыть");

  const shareBtn = document.createElement("button");
  shareBtn.className = "lightbox-share";
  shareBtn.textContent = "📤 Поделиться";

  let prevBtn = null;
  let nextBtn = null;
  let counter = null;

  function render() {
    img.src = list[index];
  }

  function go(delta) {
    index = (index + delta + list.length) % list.length;
    render();
    if (counter) counter.textContent = `${index + 1} / ${list.length}`;
  }

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }
  function onKeydown(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  }

  let suppressClick = false;
  overlay.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    close();
  });
  closeBtn.addEventListener("click", close);
  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    shareImage(list[index]);
  });
  document.addEventListener("keydown", onKeydown);

  if (list.length > 1) {
    const SWIPE_THRESHOLD = 40;
    let touchStartX = 0;
    let touchStartY = 0;
    let touching = false;

    overlay.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        touching = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      },
      { passive: true }
    );

    overlay.addEventListener(
      "touchmove",
      (e) => {
        if (!touching || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        // Once a swipe is clearly horizontal, stop the page itself from
        // scrolling/bouncing underneath the fullscreen overlay.
        if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
      },
      { passive: false }
    );

    overlay.addEventListener("touchend", (e) => {
      if (!touching) return;
      touching = false;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        go(dx < 0 ? 1 : -1);
        suppressClick = true;
      }
    });
  }

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  overlay.appendChild(shareBtn);

  if (list.length > 1) {
    prevBtn = document.createElement("button");
    prevBtn.className = "lightbox-nav lightbox-prev";
    prevBtn.textContent = "‹";
    prevBtn.setAttribute("aria-label", "Предыдущее фото");
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      go(-1);
    });

    nextBtn = document.createElement("button");
    nextBtn.className = "lightbox-nav lightbox-next";
    nextBtn.textContent = "›";
    nextBtn.setAttribute("aria-label", "Следующее фото");
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      go(1);
    });

    counter = document.createElement("div");
    counter.className = "lightbox-counter";
    counter.textContent = `${index + 1} / ${list.length}`;

    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(counter);
  }

  render();
  document.body.appendChild(overlay);
}
