import { mountHubShell } from "./shell.js";
import { renderGamesTab } from "./gamesTab.js";
import { renderRoomsTab } from "./roomsTab.js";
import { renderProfileTab } from "./profileTab.js";

const RENDERERS = {
  games: renderGamesTab,
  rooms: renderRoomsTab,
  profile: renderProfileTab,
};

// The three tabs of the home screen: games, open rooms, profile.
export function renderHub(container, tab) {
  const shell = mountHubShell(container, tab);
  RENDERERS[tab](shell);
}
