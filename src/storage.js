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

const DEVICE_ID_KEY = "vecherinka-device-id";

// A single identifier for this browser, independent of any one room —
// generated once and kept forever. The sentence game sends it along with
// create/join so the server can refuse a second join from a device that's
// already got a player in that room (its "у меня есть код" flow has no
// login to key uniqueness off otherwise). Same trust model as the room
// session tokens above: good enough to stop someone from casually joining
// twice from one browser, not a defense against someone deliberately
// clearing storage or switching browsers.
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
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
