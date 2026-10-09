const PREFIX = "vecherinka:";

export function saveSession(code, session) {
  localStorage.setItem(PREFIX + code.toUpperCase(), JSON.stringify(session));
}

export function loadSession(code) {
  const raw = localStorage.getItem(PREFIX + code.toUpperCase());
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearSession(code) {
  localStorage.removeItem(PREFIX + code.toUpperCase());
}

// Every room code this device has ever joined and hasn't since left —
// used on the home screen to offer a way back in after an accidental exit
// (the installed PWA's start_url is always "/", so without this a lost
// session would otherwise just look like a brand-new, empty app).
export function listSessionCodes() {
  const codes = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX)) codes.push(key.slice(PREFIX.length));
  }
  return codes;
}
