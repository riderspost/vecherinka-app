// Sending a recording to somebody (messenger, mail — whatever the phone's
// share sheet offers) or keeping it on the phone.

export function saveAudioFile(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function fetchAudioFile(url, filename) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("fetch failed");
  const blob = await resp.blob();
  return new File([blob], filename, { type: blob.type || "audio/wav" });
}

// Starts loading the file now, so that the share sheet can open right on the
// tap: phones only allow it straight after a tap, and waiting for a download
// first can make them refuse.
export function prepareAudioShare(url, filename) {
  if (!(navigator.canShare && navigator.share)) return null;
  const promise = fetchAudioFile(url, filename);
  promise.catch(() => {});
  return promise;
}

// Opens the share sheet with the audio file. Where the browser cannot share
// files (a computer, an old phone) the file is saved instead.
export async function shareAudioFile(url, filename, prepared) {
  try {
    const file = await (prepared || fetchAudioFile(url, filename));
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Запись из PLYNGER" });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return; // closed the share sheet
  }
  saveAudioFile(url, filename);
}
