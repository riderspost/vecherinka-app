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
    throw err;
  }
  return data;
}

export const api = {
  createRoom: (payload) => request("POST", "/api/rooms", payload),
  joinRoom: (code, payload) => request("POST", `/api/rooms/${code}/join`, payload),
  getTakenEmojis: (code) => request("GET", `/api/rooms/${code}/taken-emojis`),
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
};

export const authApi = {
  register: (email, password) => request("POST", "/api/auth/register", { email, password }),
  login: (email, password) => request("POST", "/api/auth/login", { email, password }),
  logout: () => request("POST", "/api/auth/logout"),
  session: () => request("GET", "/api/auth/session"),
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
  end: (code, token) => request("POST", `/api/fanty/rooms/${code}/end`, { token }),
  discard: (code, token) => request("POST", `/api/fanty/rooms/${code}/discard`, { token }),
  likeDare: (dareId) => request("POST", `/api/fanty/dares/${dareId}/like`),
  unlikeDare: (dareId) => request("POST", `/api/fanty/dares/${dareId}/unlike`),
  submit: (payload) => request("POST", "/api/fanty/submit", payload),
  mySubmissions: () => request("GET", "/api/fanty/my-submissions"),
};
