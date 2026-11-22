-- Members are fixed (the family). Tokens are generated inside D1, so they never appear in the repo.
CREATE TABLE members (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL UNIQUE,
  is_kid        INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  token         TEXT    NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  first_seen_at TEXT
);

CREATE TABLE assignments (
  giver_id    INTEGER PRIMARY KEY REFERENCES members(id),
  receiver_id INTEGER NOT NULL UNIQUE REFERENCES members(id)
);

CREATE TABLE wishlist_items (
  id         INTEGER PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members(id),
  kind       TEXT    NOT NULL CHECK (kind IN ('item', 'idea')),
  text       TEXT    NOT NULL,
  url        TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX wishlist_items_member ON wishlist_items(member_id);

-- One conversation per pairing. from_role says which side wrote it.
-- AUTOINCREMENT: ids are never reused after a reset, so the browser's "since" cursor stays valid.
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  giver_id    INTEGER NOT NULL REFERENCES members(id),
  receiver_id INTEGER NOT NULL REFERENCES members(id),
  from_role   TEXT    NOT NULL CHECK (from_role IN ('giver', 'receiver')),
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX messages_pair ON messages(giver_id, receiver_id, id);

INSERT INTO members (name, is_kid, is_admin) VALUES
  ('Camilla',   0, 0),
  ('Olivia',    1, 0),
  ('Francisco', 1, 0),
  ('Gabriel',   1, 0),
  ('Gilberto',  0, 0),
  ('Liliane',   0, 0),
  ('Neuza',     0, 0),
  ('Luciane',   0, 0),
  ('Rodrigo',   0, 0),
  ('Fernando',  0, 0),
  ('Patricia',  0, 0),
  ('Mauricio',  0, 0),
  ('Beatriz',   0, 0),
  ('Lucas',     0, 1);
