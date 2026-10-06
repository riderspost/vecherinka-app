export function parseRoute(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { name: "gamePicker" };
  }
  if (parts[0] === "r" && parts[1]) {
    if (parts[2] === "display") {
      return { name: "display", code: parts[1].toUpperCase() };
    }
    return { name: "room", code: parts[1].toUpperCase() };
  }
  if (parts[0] === "sentence") {
    return { name: "sentenceHome" };
  }
  if (parts[0] === "account") {
    return { name: "account" };
  }
  if (parts[0] === "contact") {
    return { name: "contact" };
  }
  if (parts[0] === "fanty") {
    if (parts[1] === "submit") {
      return { name: "fantySubmit" };
    }
    if (parts[1] === "r" && parts[2]) {
      if (parts[3] === "display") {
        return { name: "fantyDisplay", code: parts[2].toUpperCase() };
      }
      return { name: "fantyRoom", code: parts[2].toUpperCase() };
    }
    return { name: "fantyHome" };
  }
  return { name: "gamePicker" };
}

export function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("vecherinka:navigate"));
}
