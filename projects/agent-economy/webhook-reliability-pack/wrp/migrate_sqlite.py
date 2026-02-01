from __future__ import annotations

import sqlite3


def migrate_add_circuit_columns(con: sqlite3.Connection) -> None:
    # Add columns if missing (SQLite has limited ALTER TABLE).
    cols = {r[1] for r in con.execute("PRAGMA table_info(endpoints)").fetchall()}
    if "circuit_state" not in cols:
        con.execute("ALTER TABLE endpoints ADD COLUMN circuit_state TEXT NOT NULL DEFAULT 'closed'")
    if "circuit_opened_at_ms" not in cols:
        con.execute("ALTER TABLE endpoints ADD COLUMN circuit_opened_at_ms INTEGER")
    if "circuit_cooldown_ms" not in cols:
        con.execute("ALTER TABLE endpoints ADD COLUMN circuit_cooldown_ms INTEGER NOT NULL DEFAULT 0")
