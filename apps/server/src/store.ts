import type { Deck } from '@cirelli/decks';
import type { GameState, SeatId } from '@cirelli/engine';

/** Tutto quello che serve per far ripartire una stanza dopo un riavvio. */
export interface RoomSnapshot {
  code: string;
  state: GameState;
  rev: number;
  /** hash del token → posto */
  seats: Record<string, SeatId>;
  /** hash dei token espulsi */
  banned: string[];
  decks: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StoredDeck {
  shareCode: string;
  deck: Deck;
  editTokenHash: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Persistenza delle stanze e dei mazzi. SQL volutamente semplice (testo JSON, chiavi stringa)
 * perché funzioni uguale su SQLite e Postgres.
 */
export interface Store {
  saveRoom(snapshot: RoomSnapshot): Promise<void>;
  deleteRoom(code: string): Promise<void>;
  loadRooms(): Promise<RoomSnapshot[]>;
  getDeck(shareCode: string): Promise<StoredDeck | null>;
  saveDeck(deck: StoredDeck): Promise<void>;
  close(): Promise<void>;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  snapshot TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS decks (
  share_code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  edit_token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

export class MemoryStore implements Store {
  rooms = new Map<string, string>();
  decks = new Map<string, string>();

  async saveRoom(s: RoomSnapshot) {
    this.rooms.set(s.code, JSON.stringify(s));
  }
  async deleteRoom(code: string) {
    this.rooms.delete(code);
  }
  async loadRooms() {
    return [...this.rooms.values()].map((v) => JSON.parse(v) as RoomSnapshot);
  }
  async getDeck(code: string) {
    const v = this.decks.get(code);
    return v ? (JSON.parse(v) as StoredDeck) : null;
  }
  async saveDeck(d: StoredDeck) {
    this.decks.set(d.shareCode, JSON.stringify(d));
  }
  async close() {}
}

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  close(): void;
};

/** SQLite incluso in Node 22 (`node:sqlite`): nessuna dipendenza nativa da compilare. */
export class SqliteStore implements Store {
  private constructor(private db: SqliteDb) {}

  static async open(path: string): Promise<SqliteStore> {
    const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
      DatabaseSync: new (path: string) => SqliteDb;
    };
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA_SQL);
    return new SqliteStore(db);
  }

  async saveRoom(s: RoomSnapshot) {
    this.db
      .prepare(
        `INSERT INTO rooms (code, snapshot, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
      )
      .run(s.code, JSON.stringify(s), s.updatedAt);
  }
  async deleteRoom(code: string) {
    this.db.prepare('DELETE FROM rooms WHERE code = ?').run(code);
  }
  async loadRooms() {
    const rows = this.db.prepare('SELECT snapshot FROM rooms').all() as { snapshot: string }[];
    return rows.map((r) => JSON.parse(r.snapshot) as RoomSnapshot);
  }
  async getDeck(code: string) {
    const row = this.db
      .prepare(
        'SELECT data, edit_token_hash, created_at, updated_at FROM decks WHERE share_code = ?',
      )
      .get(code) as
      { data: string; edit_token_hash: string; created_at: number; updated_at: number } | undefined;
    if (!row) return null;
    return {
      shareCode: code,
      deck: JSON.parse(row.data) as Deck,
      editTokenHash: row.edit_token_hash,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
  async saveDeck(d: StoredDeck) {
    this.db
      .prepare(
        `INSERT INTO decks (share_code, data, edit_token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(share_code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(d.shareCode, JSON.stringify(d.deck), d.editTokenHash, d.createdAt, d.updatedAt);
  }
  async close() {
    this.db.close();
  }
}
