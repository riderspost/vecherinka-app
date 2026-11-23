import {
  startRecording,
  recordingErrorMessage,
  createPlayButton,
  stopAllAudio,
  isRecordingSupported,
  MAX_RECORD_SECONDS,
} from "../../audioTools.js";

function formatSeconds(sec) {
  const s = Math.floor(sec);
  return `0:${String(s).padStart(2, "0")}`;
}

// A self-contained "record -> listen back -> redo or send" block. onSubmit
// gets the finished WAV blob and returns a promise; if it rejects, the
// message is shown and the user can retry without re-recording.
// destroy() must be called when the panel goes away so a still-open
// microphone is released.
export function createRecorderPanel({
  idleLabel = "🎙 Начать запись",
  submitLabel = "✅ Отправить",
  maxSeconds = MAX_RECORD_SECONDS,
  onSubmit,
}) {
  const panel = document.createElement("div");
  panel.className = "card-inline recorder-panel";

  const body = document.createElement("div");
  body.className = "recorder-body";
  const errorEl = document.createElement("div");
  errorEl.className = "error-msg";
  panel.appendChild(body);
  panel.appendChild(errorEl);

  let activeRecording = null;
  let previewUrl = null;
  let destroyed = false;

  function releasePreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  function showIdle() {
    releasePreview();
    activeRecording = null;
    body.innerHTML = "";
    if (!isRecordingSupported()) {
      errorEl.textContent = recordingErrorMessage({ code: "unsupported" });
      return;
    }
    const recBtn = document.createElement("button");
    recBtn.className = "btn btn-primary rec-start-btn";
    recBtn.textContent = idleLabel;
    recBtn.addEventListener("click", async () => {
      recBtn.disabled = true;
      errorEl.textContent = "";
      // Whatever clip was playing would otherwise bleed into the recording.
      stopAllAudio();
      try {
        const rec = await startRecording({
          maxSeconds,
          onLevel: (level) => {
            if (levelFill) levelFill.style.width = `${Math.round(level * 100)}%`;
          },
          onTick: (elapsed) => {
            if (timerEl) timerEl.textContent = `${formatSeconds(elapsed)} / ${formatSeconds(maxSeconds)}`;
          },
        });
        if (destroyed) {
          rec.cancel();
          return;
        }
        showRecording(rec);
      } catch (e) {
        errorEl.textContent = recordingErrorMessage(e);
        recBtn.disabled = false;
      }
    });
    body.appendChild(recBtn);
  }

  let levelFill = null;
  let timerEl = null;

  function showRecording(rec) {
    activeRecording = rec;
    body.innerHTML = "";

    const status = document.createElement("div");
    status.className = "rec-status";
    status.innerHTML = `<span class="rec-dot"></span><span>Идёт запись…</span>`;
    timerEl = document.createElement("span");
    timerEl.className = "rec-timer";
    timerEl.textContent = `0:00 / ${formatSeconds(maxSeconds)}`;
    status.appendChild(timerEl);

    const level = document.createElement("div");
    level.className = "rec-level";
    levelFill = document.createElement("div");
    levelFill.className = "rec-level-fill";
    level.appendChild(levelFill);

    const stopBtn = document.createElement("button");
    stopBtn.className = "btn danger";
    stopBtn.textContent = "⏹ Закончить запись";
    stopBtn.addEventListener("click", () => {
      stopBtn.disabled = true;
      rec.stop();
    });

    body.appendChild(status);
    body.appendChild(level);
    body.appendChild(stopBtn);

    rec.result.then(
      (res) => {
        levelFill = null;
        timerEl = null;
        if (!destroyed) showRecorded(res);
      },
      (e) => {
        levelFill = null;
        timerEl = null;
        if (destroyed) return;
        errorEl.textContent = recordingErrorMessage(e);
        showIdle();
      }
    );
  }

  function showRecorded(res) {
    activeRecording = null;
    releasePreview();
    previewUrl = URL.createObjectURL(res.blob);
    body.innerHTML = "";

    const listen = createPlayButton(previewUrl, `Прослушать свою запись (${res.durationSec.toFixed(1)} с)`);
    body.appendChild(listen);

    const row = document.createElement("div");
    row.className = "row-actions";
    const redoBtn = document.createElement("button");
    redoBtn.className = "btn";
    redoBtn.textContent = "🔁 Заново";
    redoBtn.addEventListener("click", () => {
      stopAllAudio();
      errorEl.textContent = "";
      showIdle();
    });
    const sendBtn = document.createElement("button");
    sendBtn.className = "btn btn-primary";
    sendBtn.textContent = submitLabel;
    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = true;
      redoBtn.disabled = true;
      errorEl.textContent = "";
      stopAllAudio();
      try {
        await onSubmit(res.blob);
        if (destroyed) return;
        body.innerHTML = `<p class="tagline">✅ Отправлено — ждём остальных…</p>`;
      } catch (e) {
        if (destroyed) return;
        errorEl.textContent = e.message || "Не удалось отправить запись";
        sendBtn.disabled = false;
        redoBtn.disabled = false;
      }
    });
    row.appendChild(redoBtn);
    row.appendChild(sendBtn);
    body.appendChild(row);
  }

  showIdle();

  return {
    element: panel,
    destroy() {
      destroyed = true;
      if (activeRecording) activeRecording.cancel();
      activeRecording = null;
      releasePreview();
    },
  };
}
