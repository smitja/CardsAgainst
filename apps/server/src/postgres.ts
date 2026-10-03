import type { RoomSnapshot, Store, StoredDeck } from './store.ts';
import { SCHEMA_SQL } from './store.ts';

/** Postgres per la produzione: stesso schema di SQLite. Usa il driver `pg` (JavaScript puro). */
export class PostgresStore implements Store {
  private constructor(private pool: import('pg').Pool) {}

  static async open(url: string): Promise<PostgresStore> {
    const pg = await import('pg');
    const Pool = pg.default?.Pool ?? pg.Pool;
    const pool = new Pool({ connectionString: url, max: 5 });
    await pool.query(SCHEMA_SQL);
    return new PostgresStore(pool);
  }

  async saveRoom(s: RoomSnapshot) {
    await this.pool.query(
      `INSERT INTO rooms (code, snapshot, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`,
      [s.code, JSON.stringify(s), s.updatedAt],
    );
  }
  async deleteRoom(code: string) {
    await this.pool.query('DELETE FROM rooms WHERE code = $1', [code]);
  }
  async loadRooms() {
    const { rows } = await this.pool.query<{ snapshot: string }>('SELECT snapshot FROM rooms');
    return rows.map((r) => JSON.parse(r.snapshot) as RoomSnapshot);
  }
  async getDeck(code: string) {
    const { rows } = await this.pool.query<{
      data: string;
      edit_token_hash: string;
      created_at: string;
      updated_at: string;
    }>('SELECT data, edit_token_hash, created_at, updated_at FROM decks WHERE share_code = $1', [
      code,
    ]);
    const row = rows[0];
    if (!row) return null;
    return {
      shareCode: code,
      deck: JSON.parse(row.data),
      editTokenHash: row.edit_token_hash,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    } satisfies StoredDeck;
  }
  async saveDeck(d: StoredDeck) {
    await this.pool.query(
      `INSERT INTO decks (share_code, data, edit_token_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (share_code) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [d.shareCode, JSON.stringify(d.deck), d.editTokenHash, d.createdAt, d.updatedAt],
    );
  }
  async close() {
    await this.pool.end();
  }
}
