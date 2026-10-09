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
