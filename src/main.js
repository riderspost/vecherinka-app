import { parseRoute } from "./router.js";
import { renderHub } from "./pages/hub/index.js";
import { renderHome } from "./pages/home.js";
import { mountRoomPage } from "./pages/room.js";
import { renderFantyHome } from "./pages/fanty/home.js";
import { mountFantyRoomPage } from "./pages/fanty/room.js";
import { renderAccountPage } from "./pages/account.js";
import { renderContactPage } from "./pages/contact.js";
import { renderProfilePage } from "./pages/profile.js";
import { renderProfileSettings } from "./pages/profileSettings.js";
import { renderReverseHome } from "./pages/reverse/home.js";
import { mountReverseRoomPage } from "./pages/reverse/room.js";
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
    renderHub(app, "games");
  } else if (route.name === "rooms") {
    renderHub(app, "rooms");
  } else if (route.name === "ideas") {
    renderHub(app, "ideas");
  } else if (route.name === "profile") {
    renderProfileSettings(app);
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
    renderHub(app, "ideas");
  } else if (route.name === "reverseHome") {
    renderReverseHome(app);
  } else if (route.name === "reverseRoom") {
    mountReverseRoomPage(app, route.code);
  } else if (route.name === "account") {
    renderAccountPage(app);
  } else if (route.name === "profileEdit") {
    renderProfilePage(app);
  } else if (route.name === "contact") {
    renderContactPage(app);
  }
}

window.addEventListener("popstate", renderCurrentRoute);
window.addEventListener("vecherinka:navigate", renderCurrentRoute);

renderCurrentRoute();
