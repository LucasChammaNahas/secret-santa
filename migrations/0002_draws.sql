-- One row per draw. The id tells phones "this is a new draw", so after a reset + redraw everyone
-- has to see who they drew again, even if they got the same person.
-- AUTOINCREMENT: ids are never reused, even after a reset.
CREATE TABLE draws (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A draw that already exists (made before this table) gets an id too.
INSERT INTO draws (id) SELECT 1 WHERE EXISTS (SELECT 1 FROM assignments);
