CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby',
  current_round INTEGER NOT NULL DEFAULT 0,
  voting_index INTEGER NOT NULL DEFAULT 0,
  phase_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_type TEXT NOT NULL DEFAULT 'emoji',
  avatar_value TEXT NOT NULL DEFAULT '🙂',
  is_host INTEGER NOT NULL DEFAULT 0,
  is_display INTEGER NOT NULL DEFAULT 0,
  total_score REAL NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS round_groups (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  group_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS round_group_members (
  group_id TEXT NOT NULL REFERENCES round_groups(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, player_id)
);

CREATE TABLE IF NOT EXISTS round_prompts (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  group_id TEXT NOT NULL REFERENCES round_groups(id) ON DELETE CASCADE,
  prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  order_index INTEGER NOT NULL,
  voting_done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  round_prompt_id TEXT NOT NULL REFERENCES round_prompts(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(round_prompt_id, player_id)
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  round_prompt_id TEXT NOT NULL REFERENCES round_prompts(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  voter_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE(round_prompt_id, voter_player_id)
);

CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
CREATE INDEX IF NOT EXISTS idx_round_groups_room_round ON round_groups(room_id, round_number);
CREATE INDEX IF NOT EXISTS idx_round_prompts_room_round ON round_prompts(room_id, round_number);
CREATE INDEX IF NOT EXISTS idx_submissions_round_prompt ON submissions(round_prompt_id);
CREATE INDEX IF NOT EXISTS idx_votes_round_prompt ON votes(round_prompt_id);
