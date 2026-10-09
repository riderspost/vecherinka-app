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

// Logging out of the account is the one action with a clear "fresh start
// on this device" intent — without this, the room sessions above (and the
// "вернуться в комнату" cards built from them) would just keep working as
// whoever was last logged in, handing the next person on a shared device
// a live seat in someone else's game.
export function clearAllSessions() {
  listSessionCodes().forEach(clearSession);
}
