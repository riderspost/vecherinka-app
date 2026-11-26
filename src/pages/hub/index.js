import { mountHubShell } from "./shell.js";
import { renderGamesTab } from "./gamesTab.js";
import { renderRoomsTab } from "./roomsTab.js";
import { renderIdeasTab } from "./ideasTab.js";

const RENDERERS = {
  games: renderGamesTab,
  rooms: renderRoomsTab,
  ideas: renderIdeasTab,
};

// The three tabs of the home screen: games, open rooms, own ideas.
export function renderHub(container, tab) {
  const shell = mountHubShell(container, tab);
  RENDERERS[tab](shell);
}
