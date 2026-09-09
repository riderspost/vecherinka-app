export function parseRoute(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { name: "home" };
  }
  if (parts[0] === "r" && parts[1]) {
    if (parts[2] === "display") {
      return { name: "display", code: parts[1].toUpperCase() };
    }
    return { name: "room", code: parts[1].toUpperCase() };
  }
  return { name: "home" };
}

export function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("vecherinka:navigate"));
}
