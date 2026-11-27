// Bottom sheets close with a swipe down (and with a drag on the handle with a
// mouse). The sheet follows the finger; past a third of its height, or on a
// quick flick, it slides away; otherwise it springs back.
//
// A swipe only starts on the sheet when its content is scrolled to the top,
// so a long sheet can still be scrolled normally.

const CLOSE_FRACTION = 0.3;
const FLICK_PX_PER_MS = 0.6;

export function enableSwipeDown(sheet, onClose) {
  let startY = 0;
  let startX = 0;
  let startAt = 0;
  let dy = 0;
  let tracking = false;
  sheet.__dragging = false;

  function begin(y, x) {
    tracking = true;
    sheet.__dragging = false;
    startY = y;
    startX = x;
    startAt = Date.now();
    dy = 0;
  }

  function move(y, x, event) {
    if (!tracking) return;
    const diff = y - startY;
    if (!sheet.__dragging) {
      // not a vertical pull down from the top: leave it to normal scrolling
      if (diff <= 6 || Math.abs(x - startX) > Math.abs(diff) || sheet.scrollTop > 0) {
        if (diff < -6) tracking = false;
        return;
      }
      sheet.__dragging = true;
      sheet.style.transition = "none";
    }
    dy = Math.max(0, diff);
    sheet.style.transform = `translateY(${dy}px)`;
    if (event && event.cancelable) event.preventDefault();
  }

  function end() {
    if (!tracking) return;
    tracking = false;
    if (!sheet.__dragging) return;
    const speed = dy / Math.max(1, Date.now() - startAt);
    sheet.style.transition = "transform 0.2s ease";
    if (dy > sheet.offsetHeight * CLOSE_FRACTION || speed > FLICK_PX_PER_MS) {
      sheet.style.transform = "translateY(100%)";
      setTimeout(onClose, 180);
    } else {
      sheet.style.transform = "translateY(0)";
      setTimeout(() => {
        sheet.__dragging = false;
        sheet.style.transition = "";
      }, 210);
    }
  }

  sheet.addEventListener("touchstart", (e) => begin(e.touches[0].clientY, e.touches[0].clientX), { passive: true });
  sheet.addEventListener("touchmove", (e) => move(e.touches[0].clientY, e.touches[0].clientX, e), { passive: false });
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);

  // with a mouse (desktop), the handle at the top can be dragged
  const handle = sheet.querySelector(".sheet-handle");
  if (handle) {
    handle.style.cursor = "grab";
    handle.addEventListener("mousedown", (e) => {
      begin(e.clientY, e.clientX);
      const onMove = (ev) => move(ev.clientY, ev.clientX, ev);
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        end();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
}

// A ready-made sheet: dimmed backdrop, handle, title and a close cross.
// `build(content, close)` fills the body. Returns { close }.
export function openBottomSheet({ title, build, onClose }) {
  const bg = document.createElement("div");
  bg.className = "sheet-overlay";
  const sheet = document.createElement("div");
  sheet.className = "sheet-panel";
  sheet.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-head"><b></b><button type="button" class="sheet-close" aria-label="Закрыть">✕</button></div>
    <div class="sheet-content"></div>
  `;
  sheet.querySelector(".sheet-head b").textContent = title;
  bg.appendChild(sheet);
  document.body.appendChild(bg);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    bg.remove();
    if (onClose) onClose();
  }
  bg.addEventListener("click", (e) => e.target === bg && close());
  sheet.querySelector(".sheet-close").addEventListener("click", close);
  enableSwipeDown(sheet, close);
  build(sheet.querySelector(".sheet-content"), close);
  return { close };
}
