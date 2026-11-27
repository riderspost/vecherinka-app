// The player block for a recorded performance: listen, send on, save.

import { createPlayButton } from "./audioTools.js";
import { prepareAudioShare, shareAudioFile, saveAudioFile } from "./audioShare.js";

export function createRecordingPlayer(url, filename) {
  const box = document.createElement("div");
  box.className = "rec-player";

  const title = document.createElement("span");
  title.className = "rec-player-title";
  title.textContent = "🎙 Запись выступления";
  box.appendChild(title);

  const row = document.createElement("div");
  row.className = "rec-player-row";
  row.appendChild(createPlayButton(url, "Слушать", "btn rec-play-btn"));

  const prepared = prepareAudioShare(url, filename);
  const shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.className = "btn rec-act-btn";
  shareBtn.textContent = "📤 Отправить";
  shareBtn.addEventListener("click", () => shareAudioFile(url, filename, prepared));
  row.appendChild(shareBtn);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn rec-act-btn";
  saveBtn.textContent = "💾 Сохранить";
  saveBtn.addEventListener("click", () => saveAudioFile(url, filename));
  row.appendChild(saveBtn);

  box.appendChild(row);
  return box;
}
