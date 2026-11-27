async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const message = (data && data.error) || "Ошибка сети";
    const err = new Error(message);
    if (data && typeof data === "object") Object.assign(err, data);
    // A genuine server response (even an error one) reached us — status is
    // what lets callers tell "the server says you're not in this room
    // anymore" apart from a network blip, which never gets this far and so
    // never sets it.
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  createRoom: (payload) => request("POST", "/api/rooms", payload),
  joinRoom: (code, payload) => request("POST", `/api/rooms/${code}/join`, payload),
  getTakenEmojis: (code) => request("GET", `/api/rooms/${code}/taken-emojis`),
  myRooms: () => request("GET", "/api/my-rooms"),
  resumeRoom: (code) => request("POST", `/api/rooms/${code}/resume`),
  getState: (code, token) =>
    request("GET", `/api/rooms/${code}/state?token=${encodeURIComponent(token)}`),
  startGame: (code, token) => request("POST", `/api/rooms/${code}/start`, { token }),
  next: (code, token) => request("POST", `/api/rooms/${code}/next`, { token }),
  submitAnswer: (code, token, roundPromptId, answerText) =>
    request("POST", `/api/rooms/${code}/submit`, {
      token,
      roundPromptId,
      answerText,
    }),
  vote: (code, token, submissionId) =>
    request("POST", `/api/rooms/${code}/vote`, { token, submissionId }),
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("POST", "/api/upload-avatar", form);
  },
  contact: (email, message) => request("POST", "/api/contact", { email, message }),
  discardRoom: (code, token) => request("POST", `/api/rooms/${code}/discard`, { token }),
  // Taking a lost seat back (sentence and reverse games)
  getSeats: (code) => request("GET", `/api/rooms/${code}/seats`),
  createClaim: (code, playerId, deviceId) => request("POST", `/api/rooms/${code}/claims`, { playerId, deviceId }),
  getClaim: (code, claimId, secret) =>
    request("GET", `/api/rooms/${code}/claims/${claimId}?secret=${encodeURIComponent(secret)}`),
  resolveClaim: (code, token, claimId, approve) =>
    request("POST", `/api/rooms/${code}/claims/${claimId}/resolve`, { token, approve }),
  kickPlayer: (code, token, playerId) => request("POST", `/api/rooms/${code}/kick`, { token, playerId }),
};

// Whether the signed-in account is the testing one (the only one that gets the
// testing aids). Learned from the session; refreshed on sign-in and sign-out.
let testerAccount = false;
export function isTester() {
  return testerAccount;
}

// Whether the signed-in account is a paid one (a guest never is).
let paidAccount = false;
export function isPaid() {
  return paidAccount;
}

// Whether anybody is signed in (as opposed to a guest).
let signedIn = false;
export function isSignedIn() {
  return signedIn;
}

export const authApi = {
  register: (email, password) => request("POST", "/api/auth/register", { email, password }),
  login: async (email, password) => {
    const res = await request("POST", "/api/auth/login", { email, password });
    await authApi.session().catch(() => {});
    return res;
  },
  logout: async () => {
    const res = await request("POST", "/api/auth/logout");
    testerAccount = false;
    paidAccount = false;
    signedIn = false;
    return res;
  },
  session: async () => {
    const res = await request("GET", "/api/auth/session");
    testerAccount = Boolean(res && res.isTester);
    paidAccount = Boolean(res && res.isPaid);
    signedIn = Boolean(res && res.authenticated);
    return res;
  },
  forgotPassword: (email) => request("POST", "/api/auth/forgot-password", { email }),
  resetPassword: (token, password) => request("POST", "/api/auth/reset-password", { token, password }),
  verifyEmail: (email, code) => request("POST", "/api/auth/verify-email", { email, code }),
  resendCode: (email) => request("POST", "/api/auth/resend-code", { email }),
  updateProfile: (name, avatarType, avatarValue) =>
    request("POST", "/api/auth/profile", { name, avatarType, avatarValue }),
};

export const fantyApi = {
  createRoom: (payload) => request("POST", "/api/fanty/rooms", payload),
  addLocalPlayer: (code, token, name, avatarType, avatarValue, gender) =>
    request("POST", `/api/fanty/rooms/${code}/local-players`, { token, name, avatarType, avatarValue, gender }),
  removePlayer: (code, token, playerId) =>
    request("DELETE", `/api/fanty/rooms/${code}/players/${playerId}?token=${encodeURIComponent(token)}`),
  start: (code, token) => request("POST", `/api/fanty/rooms/${code}/start`, { token }),
  getState: (code, token) =>
    request("GET", `/api/fanty/rooms/${code}/state?token=${encodeURIComponent(token)}`),
  spin: (code, token) => request("POST", `/api/fanty/rooms/${code}/spin`, { token }),
  choose: (code, token, choice) => request("POST", `/api/fanty/rooms/${code}/choose`, { token, choice }),
  startPerformance: (code, token) => request("POST", `/api/fanty/rooms/${code}/start-performance`, { token }),
  spinPartner: (code, token) => request("POST", `/api/fanty/rooms/${code}/spin-partner`, { token }),
  resolve: (code, token, counted, photoFilenames) =>
    request("POST", `/api/fanty/rooms/${code}/resolve`, { token, counted, photoFilenames }),
  uploadPhoto: (code, file) => {
    const form = new FormData();
    form.append("file", file);
    return request("POST", `/api/fanty/rooms/${code}/upload-photo`, form);
  },
  uploadRecording: (code, token, blob) => {
    const form = new FormData();
    form.append("token", token);
    form.append("file", blob, "recording.wav");
    return request("POST", `/api/fanty/rooms/${code}/upload-recording`, form);
  },
  recordingFailed: (code, token) => {
    const form = new FormData();
    form.append("token", token);
    form.append("failed", "1");
    return request("POST", `/api/fanty/rooms/${code}/upload-recording`, form);
  },
  allDares: (code, token) => request("GET", `/api/fanty/rooms/${code}/all-dares?token=${encodeURIComponent(token)}`),
  forceDare: (code, token, dareId) => request("POST", `/api/fanty/rooms/${code}/force-dare`, { token, dareId }),
  end: (code, token) => request("POST", `/api/fanty/rooms/${code}/end`, { token }),
  discard: (code, token) => request("POST", `/api/fanty/rooms/${code}/discard`, { token }),
  likeDare: (dareId) => request("POST", `/api/fanty/dares/${dareId}/like`),
  unlikeDare: (dareId) => request("POST", `/api/fanty/dares/${dareId}/unlike`),
  submit: (payload) => request("POST", "/api/fanty/submit", payload),
  uploadIdeaAudio: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("POST", "/api/fanty/upload-idea-audio", form);
  },
  mySubmissions: () => request("GET", "/api/fanty/my-submissions"),
  withdrawSubmission: (type, id) => request("DELETE", `/api/fanty/my-submissions/${type}/${id}`),
};

function uploadAudio(code, token, kind, blob, index) {
  const form = new FormData();
  form.append("token", token);
  if (index !== undefined) form.append("index", String(index));
  form.append("file", blob, "recording.wav");
  return request("POST", `/api/reverse/rooms/${code}/${kind}`, form);
}

export const reverseApi = {
  createRoom: (payload) => request("POST", "/api/reverse/rooms", payload),
  start: (code, token) => request("POST", `/api/reverse/rooms/${code}/start`, { token }),
  getState: (code, token) =>
    request("GET", `/api/reverse/rooms/${code}/state?token=${encodeURIComponent(token)}`),
  uploadOriginal: (code, token, blob) => uploadAudio(code, token, "original", blob),
  uploadImitation: (code, token, blob, index) => uploadAudio(code, token, "imitation", blob, index),
  answer: (code, token, optionIndex) =>
    request("POST", `/api/reverse/rooms/${code}/answer`, { token, optionIndex }),
  reveal: (code, token) => request("POST", `/api/reverse/rooms/${code}/reveal`, { token }),
  next: (code, token) => request("POST", `/api/reverse/rooms/${code}/next`, { token }),
  skip: (code, token) => request("POST", `/api/reverse/rooms/${code}/skip`, { token }),
  end: (code, token) => request("POST", `/api/reverse/rooms/${code}/end`, { token }),
};
