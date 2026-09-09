import { parseRoute } from "./router.js";
import { renderHome } from "./pages/home.js";
import { mountRoomPage } from "./pages/room.js";

const app = document.getElementById("app");

function renderCurrentRoute() {
  const route = parseRoute(window.location.pathname);
  if (route.name === "home") {
    renderHome(app);
  } else if (route.name === "room") {
    mountRoomPage(app, route.code, { asDisplay: false });
  } else if (route.name === "display") {
    mountRoomPage(app, route.code, { asDisplay: true });
  }
}

window.addEventListener("popstate", renderCurrentRoute);
window.addEventListener("vecherinka:navigate", renderCurrentRoute);

renderCurrentRoute();
