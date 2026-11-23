// Recording + playback helpers for the "Наоборот" game.
//
// Recording goes MediaRecorder -> decodeAudioData -> our own 16 kHz mono
// 16-bit WAV. Every browser records in its own container (Chrome: webm/opus,
// Safari: mp4/aac) and not every browser can decode every other one's — so
// the recording is decoded right here, in the browser that made it, and only
// the WAV (which everything understands) is ever uploaded. The server
// reverses it, which also means the listener is never handed the forward
// version of what they're meant to be hearing backwards.

export const MAX_RECORD_SECONDS = 12;
// Pieces of a phrase are two words each, so one can be short — a single
// quick word is still a valid piece.
export const MAX_CHUNK_SECONDS = 6;
const MIN_RECORD_SECONDS = 0.4;
const TARGET_RATE = 16000;
const TRIM_PADDING_SECONDS = 0.12;
const MIN_PEAK = 0.01;

export class RecordingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const ERROR_TEXT = {
  unsupported: "Этот браузер не умеет записывать звук. Откройте игру в Safari или Chrome.",
  denied: "Нет доступа к микрофону. Разрешите его в настройках браузера и попробуйте снова.",
  unavailable: "Не удалось включить микрофон.",
  silent: "Не слышно звука — проверьте микрофон и скажите громче.",
  short: "Запись слишком короткая — попробуйте ещё раз.",
  failed: "Не удалось обработать запись. Попробуйте ещё раз.",
};

export function recordingErrorMessage(e) {
  return (e && e.code && ERROR_TEXT[e.code]) || ERROR_TEXT.failed;
}

function audioContextClass() {
  return window.AudioContext || window.webkitAudioContext;
}

export function isRecordingSupported() {
  return Boolean(
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder && audioContextClass()
  );
}

function pickMimeType() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

// Older Safari only has the callback form of decodeAudioData.
function decodeAudio(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const maybePromise = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolve, reject);
  });
}

function toMono(audioBuffer) {
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const out = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i] / channels;
  }
  return out;
}

// Plain box-filter downsample: averaging the source samples that fall into
// each output sample is enough for speech at 16 kHz.
function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / (end - start);
  }
  return out;
}

// Cuts the dead air around the speech (reversed, a quiet lead-in would
// become a long silent tail) and brings quiet voices up to a usable level.
function trimAndNormalize(samples, rate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak < MIN_PEAK) throw new RecordingError("silent");

  const threshold = Math.max(0.01, peak * 0.06);
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++;
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) end--;
  const pad = Math.round(TRIM_PADDING_SECONDS * rate);
  start = Math.max(0, start - pad);
  end = Math.min(samples.length - 1, end + pad);

  const gain = Math.min(4, 0.9 / peak);
  const out = new Float32Array(end - start + 1);
  for (let i = 0; i < out.length; i++) out[i] = samples[start + i] * gain;
  return out;
}

function encodeWav(samples, rate) {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function recordedBlobToWav(blob) {
  const Ctx = audioContextClass();
  const ctx = new Ctx();
  try {
    const decoded = await decodeAudio(ctx, await blob.arrayBuffer());
    const mono = resample(toMono(decoded), decoded.sampleRate, TARGET_RATE);
    const trimmed = trimAndNormalize(mono, TARGET_RATE);
    const durationSec = trimmed.length / TARGET_RATE;
    if (durationSec < MIN_RECORD_SECONDS) throw new RecordingError("short");
    return { blob: encodeWav(trimmed, TARGET_RATE), durationSec };
  } finally {
    if (ctx.close) ctx.close().catch(() => {});
  }
}

// Starts recording from the microphone. Must be called from a tap handler
// (iOS only asks for mic access on a user gesture). Returns
// { result, stop, cancel }: `result` resolves with { blob, durationSec } (a
// ready-to-upload WAV) once recording ends — via stop(), or on its own after
// maxSeconds. onLevel(0..1) and onTick(elapsedSeconds) drive the UI.
export async function startRecording({ maxSeconds = MAX_RECORD_SECONDS, onLevel, onTick } = {}) {
  if (!isRecordingSupported()) throw new RecordingError("unsupported");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    throw new RecordingError(denied ? "denied" : "unavailable");
  }

  const mimeType = pickMimeType();
  let recorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw new RecordingError("unsupported");
  }
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  // The level meter is cosmetic — if the browser won't give us an analyser,
  // recording itself carries on regardless.
  let meterCtx = null;
  let meterTimer = null;
  try {
    const Ctx = audioContextClass();
    meterCtx = new Ctx();
    if (meterCtx.resume) meterCtx.resume().catch(() => {});
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 512;
    meterCtx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    meterTimer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      if (onLevel) onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
    }, 80);
  } catch (e) {
    meterCtx = null;
  }

  const startedAt = performance.now();
  let cancelled = false;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const tickTimer = setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    if (onTick) onTick(elapsed);
    if (elapsed >= maxSeconds) stop();
  }, 100);

  function cleanup() {
    clearInterval(tickTimer);
    if (meterTimer) clearInterval(meterTimer);
    stream.getTracks().forEach((t) => t.stop());
    if (meterCtx && meterCtx.close) meterCtx.close().catch(() => {});
  }

  recorder.onstop = async () => {
    cleanup();
    if (cancelled) return;
    try {
      const type = recorder.mimeType || mimeType || "audio/webm";
      resolveResult(await recordedBlobToWav(new Blob(chunks, { type })));
    } catch (e) {
      rejectResult(e instanceof RecordingError ? e : new RecordingError("failed"));
    }
  };

  function stop() {
    if (recorder.state !== "inactive") recorder.stop();
  }

  function cancel() {
    cancelled = true;
    stop();
    if (recorder.state === "inactive") cleanup();
  }

  recorder.start();
  return { result, stop, cancel };
}

// --- playback ---

let currentAudio = null;
let currentReset = null;

export function stopAllAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentReset) {
    currentReset();
    currentReset = null;
  }
}

// A play/stop toggle button. Only one clip plays at a time across the whole
// page, so tapping a second button stops the first.
export function createPlayButton(url, label, className = "btn") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  const idleText = `▶︎ ${label}`;
  btn.textContent = idleText;

  function reset() {
    btn.textContent = idleText;
    btn.classList.remove("playing");
  }

  btn.addEventListener("click", () => {
    const wasMine = currentReset === reset;
    stopAllAudio();
    if (wasMine) return;
    const audio = new Audio(url);
    currentAudio = audio;
    currentReset = reset;
    btn.textContent = `⏹ ${label}`;
    btn.classList.add("playing");
    audio.addEventListener("ended", () => {
      if (currentAudio === audio) {
        currentAudio = null;
        currentReset = null;
      }
      reset();
    });
    audio.play().catch(() => {
      if (currentAudio === audio) {
        currentAudio = null;
        currentReset = null;
      }
      reset();
    });
  });
  return btn;
}
