// The frame shared by every "set up a game" screen: a progress bar, a back
// button with the step's title, and room for the step's content.
// Steps are numbered from 1; `total` is how many the whole setup has (0 for a
// single screen with no progress bar).

export function stepsBarHtml(current, total) {
  let out = "";
  for (let i = 1; i <= total; i++) out += `<i class="${i <= current ? "done" : ""}"></i>`;
  return `<div class="wz-steps" role="progressbar" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${current}">${out}</div>`;
}

// Replaces the container's content with the frame and returns the body element
// the caller fills in.
export function mountWizardFrame(container, { current, total, title, onBack }) {
  container.innerHTML = "";
  const root = document.createElement("div");
  root.className = "wz";
  root.innerHTML = `
    ${total ? stepsBarHtml(current, total) : ""}
    <div class="wz-nav">
      <button type="button" class="wz-back" aria-label="Назад">←</button>
      <b class="wz-title"></b>
      ${total ? `<span class="wz-count">шаг ${current} из ${total}</span>` : ""}
    </div>
    <div class="wz-body"></div>
  `;
  root.querySelector(".wz-title").textContent = title;
  root.querySelector(".wz-back").addEventListener("click", onBack);
  container.appendChild(root);
  return root.querySelector(".wz-body");
}

export function shareLinks(url, text) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return {
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  };
}
