import { useEffect, useState, useSyncExternalStore } from 'react';
import { RoomClient, type RoomSnapshot } from '../net/room-client.ts';

export function useRoom(code: string, role: 'player' | 'screen', name: string | null) {
  const [client, setClient] = useState<RoomClient | null>(null);
  useEffect(() => {
    if (role === 'player' && name === null) return;
    const c = new RoomClient(code, { role, ...(name ? { name } : {}) });
    setClient(c);
    return () => c.dispose();
  }, [code, role, name]);
  const snapshot = useSyncExternalStore(client?.subscribe ?? noop, client?.getSnapshot ?? empty);
  return { client, snapshot };
}

const noop = () => () => {};
const EMPTY: RoomSnapshot = {
  status: 'connecting',
  view: null,
  room: null,
  seat: null,
  fatal: null,
  notice: null,
  clockOffset: 0,
  pending: 0,
};
const empty = () => EMPTY;

/** Secondi rimanenti a una scadenza del server, aggiornati ogni mezzo secondo. */
export function useCountdown(deadline: number | null, offset: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - (now + offset)) / 1000));
}
