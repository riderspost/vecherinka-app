CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reset_token TEXT,
  reset_token_expires_at TEXT,
  email_verified INTEGER NOT NULL DEFAULT 1,
  verification_code TEXT,
  verification_code_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby',
  current_round INTEGER NOT NULL DEFAULT 0,
  voting_index INTEGER NOT NULL DEFAULT 0,
  phase_started_at TEXT,
  game_type TEXT NOT NULL DEFAULT 'sentence',
  device_mode TEXT NOT NULL DEFAULT 'remote',
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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

-- Фанты

CREATE TABLE IF NOT EXISTS fanty_dares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'solo',
  status TEXT NOT NULL DEFAULT 'active',
  created_by_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fanty_dare_locations (
  dare_id INTEGER NOT NULL REFERENCES fanty_dares(id) ON DELETE CASCADE,
  location TEXT NOT NULL,
  PRIMARY KEY (dare_id, location)
);

CREATE TABLE IF NOT EXISTS fanty_dare_categories (
  dare_id INTEGER NOT NULL REFERENCES fanty_dares(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (dare_id, category)
);

CREATE TABLE IF NOT EXISTS fanty_truths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fanty_truth_categories (
  truth_id INTEGER NOT NULL REFERENCES fanty_truths(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (truth_id, category)
);

CREATE TABLE IF NOT EXISTS fanty_settings (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  game_mode TEXT NOT NULL,
  location TEXT NOT NULL,
  categories TEXT NOT NULL,
  pick_mode TEXT NOT NULL DEFAULT 'fair'
);

CREATE TABLE IF NOT EXISTS fanty_state (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'ready_to_spin',
  next_spinner_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  current_picked_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  current_partner_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  current_choice TEXT,
  current_content_type TEXT,
  current_dare_id INTEGER REFERENCES fanty_dares(id),
  current_truth_id INTEGER REFERENCES fanty_truths(id),
  round_number INTEGER NOT NULL DEFAULT 0,
  picked_cycle TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS fanty_rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  picked_player_id TEXT NOT NULL REFERENCES players(id),
  partner_player_id TEXT REFERENCES players(id),
  choice TEXT,
  content_type TEXT NOT NULL,
  dare_id INTEGER REFERENCES fanty_dares(id),
  truth_id INTEGER REFERENCES fanty_truths(id),
  counted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fanty_round_photos (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES fanty_rounds(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fanty_rounds_room ON fanty_rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_fanty_round_photos_round ON fanty_round_photos(round_id);
CREATE INDEX IF NOT EXISTS idx_fanty_dare_locations_dare ON fanty_dare_locations(dare_id);
CREATE INDEX IF NOT EXISTS idx_fanty_dare_categories_dare ON fanty_dare_categories(dare_id);
CREATE INDEX IF NOT EXISTS idx_fanty_truth_categories_truth ON fanty_truth_categories(truth_id);
