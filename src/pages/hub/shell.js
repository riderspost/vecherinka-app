import { navigate } from "../../router.js";
import { api, authApi } from "../../api.js";
import { createAvatarElement } from "../../avatarPicker.js";

const TABS = [
  { id: "games", path: "/", icon: "🎮", label: "Игры" },
  { id: "rooms", path: "/rooms", icon: "🚪", label: "Комнаты" },
  { id: "profile", path: "/profile", icon: "👤", label: "Профиль" },
];

function link(path, className, child) {
  const a = document.createElement("a");
  a.href = path;
  a.className = className;
  if (typeof child === "string") a.textContent = child;
  else if (child) a.appendChild(child);
  a.addEventListener("click", (e) => {
    // let ctrl/cmd-click open a new tab as usual
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(path);
  });
  return a;
}

function accountChip(session) {
  const chip = link("/profile", "hub-chip");
  const av = document.createElement("span");
  av.className = "hub-chip-avatar";
  av.appendChild(createAvatarElement({ avatarType: session.avatarType, avatarValue: session.avatarValue, name: session.name }));
  const name = document.createElement("span");
  name.className = "hub-chip-name";
  name.textContent = session.name || "Профиль";
  chip.appendChild(av);
  chip.appendChild(name);
  return chip;
}

// The frame shared by the three home tabs: logo and account chip on top,
// the tab's content in the middle, the tab bar at the bottom.
// Returns { body, sessionPromise, roomsPromise, setRoomCount }.
export function mountHubShell(container, activeTab) {
  container.innerHTML = "";
  const sessionPromise = authApi.session().catch(() => ({ authenticated: false }));

  // Open rooms are only known for a signed-in account (see /api/my-rooms).
  const roomsPromise = sessionPromise.then((session) => (session.authenticated ? api.myRooms() : [])).catch(() => []);

  const root = document.createElement("div");
  root.className = "hub";

  const top = document.createElement("header");
  top.className = "hub-top";
  top.appendChild(link("/", "hub-logo", "PLYNGER"));
  const accountSlot = document.createElement("div");
  top.appendChild(accountSlot);

  const scroll = document.createElement("div");
  scroll.className = "hub-scroll";
  const body = document.createElement("main");
  body.className = "hub-body";
  scroll.appendChild(body);

  const nav = document.createElement("nav");
  nav.className = "hub-tabs";
  nav.setAttribute("aria-label", "Разделы");
  const badges = {};
  TABS.forEach((tab) => {
    const a = link(tab.path, "hub-tab");
    if (tab.id === activeTab) a.setAttribute("aria-current", "page");
    const icon = document.createElement("span");
    icon.className = "hub-tab-icon";
    icon.textContent = tab.icon;
    const label = document.createElement("span");
    label.textContent = tab.label;
    a.appendChild(icon);
    a.appendChild(label);
    const badge = document.createElement("span");
    badge.className = "hub-badge";
    badge.hidden = true;
    a.appendChild(badge);
    badges[tab.id] = badge;
    nav.appendChild(a);
  });

  root.appendChild(top);
  root.appendChild(scroll);
  root.appendChild(nav);
  container.appendChild(root);

  sessionPromise.then((session) => {
    if (session.authenticated && !session.profileComplete) {
      navigate("/profile/edit");
      return;
    }
    accountSlot.innerHTML = "";
    if (session.authenticated) {
      accountSlot.appendChild(accountChip(session));
    } else {
      accountSlot.appendChild(link("/account", "hub-login", "Войти"));
    }
  });

  const shell = {
    body,
    sessionPromise,
    roomsPromise,
    // number of open rooms, shown on the "Комнаты" tab
    setRoomCount(n) {
      badges.rooms.textContent = String(n);
      badges.rooms.hidden = !n;
    },
  };
  roomsPromise.then((rooms) => shell.setRoomCount(rooms.length));
  return shell;
}

export function goTo(path) {
  navigate(path);
}
