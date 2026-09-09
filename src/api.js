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
    throw new Error(message);
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
};
