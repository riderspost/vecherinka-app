import { parseRoute } from "./router.js";
import { renderGamePicker } from "./pages/gamePicker.js";
import { renderHome } from "./pages/home.js";
import { mountRoomPage } from "./pages/room.js";
import { renderFantyHome } from "./pages/fanty/home.js";
import { mountFantyRoomPage } from "./pages/fanty/room.js";
import { renderFantySubmit } from "./pages/fanty/submit.js";
import { renderAccountPage } from "./pages/account.js";
import { renderContactPage } from "./pages/contact.js";
import { renderProfilePage } from "./pages/profile.js";
import "./pwaInstall.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const app = document.getElementById("app");

function renderCurrentRoute() {
  const route = parseRoute(window.location.pathname);
  if (route.name === "gamePicker") {
    renderGamePicker(app);
  } else if (route.name === "sentenceHome") {
    renderHome(app);
  } else if (route.name === "room") {
    mountRoomPage(app, route.code, { asDisplay: false });
  } else if (route.name === "display") {
    mountRoomPage(app, route.code, { asDisplay: true });
  } else if (route.name === "fantyHome") {
    renderFantyHome(app);
  } else if (route.name === "fantyRoom") {
    mountFantyRoomPage(app, route.code, { asDisplay: false });
  } else if (route.name === "fantyDisplay") {
    mountFantyRoomPage(app, route.code, { asDisplay: true });
  } else if (route.name === "fantySubmit") {
    renderFantySubmit(app);
  } else if (route.name === "account") {
    renderAccountPage(app);
  } else if (route.name === "profile") {
    renderProfilePage(app);
  } else if (route.name === "contact") {
    renderContactPage(app);
  }
}

window.addEventListener("popstate", renderCurrentRoute);
window.addEventListener("vecherinka:navigate", renderCurrentRoute);

renderCurrentRoute();
