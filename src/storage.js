const PREFIX = "vecherinka:";

export function saveSession(code, session) {
  sessionStorage.setItem(PREFIX + code.toUpperCase(), JSON.stringify(session));
}

export function loadSession(code) {
  const raw = sessionStorage.getItem(PREFIX + code.toUpperCase());
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearSession(code) {
  sessionStorage.removeItem(PREFIX + code.toUpperCase());
}
