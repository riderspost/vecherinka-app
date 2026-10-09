import { api } from "./api.js";

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

// Visiting the home screen while logged in (saveSession on a normal
// create/join, or clicking a "вернуться" card for an account room, which
// fetches a token via /resume and caches it the same way) leaves that
// room's token sitting in localStorage same as any guest session would.
// Call this BEFORE logging out — while /api/my-rooms can still answer for
// this account — to scrub exactly those entries, so they don't resurface
// as "guest" sessions for whoever uses this browser next. Sessions that
// were never linked to this account are left alone.
export async function forgetAccountLinkedSessions() {
  try {
    const rooms = await api.myRooms();
    rooms.forEach((r) => clearSession(r.code));
  } catch (e) {
    // Worst case a stale entry lingers until it 404s on its own (the home
    // screen already drops those) or the next logout retries this.
  }
}
