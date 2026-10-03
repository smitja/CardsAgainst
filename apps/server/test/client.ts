import WebSocket from 'ws';
import type { GameView } from '@cirelli/engine';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type Intent,
  type ServerMessage,
} from '@cirelli/protocol';

/** Client di test: tiene tutti i messaggi ricevuti e permette di aspettarne uno. */
export class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  seat: string | null = null;
  token: string | null = null;
  closed: { code: number; reason: string } | null = null;
  private seq = 0;
  private waiters: (() => void)[] = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(msg);
      if (msg.t === 'welcome') {
        this.seat = msg.seat;
        this.token = msg.token;
      }
      this.notify();
    });
    this.ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.notify();
    });
  }

  private notify() {
    for (const w of this.waiters.splice(0)) w();
  }

  opened(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((ok, ko) => {
      this.ws.once('open', () => ok());
      this.ws.once('error', ko);
    });
  }

  send(msg: ClientMessage | string) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  async hello(
    room: string,
    opts: { name?: string; token?: string; role?: 'player' | 'screen' } = {},
  ) {
    await this.opened();
    this.send({ t: 'hello', v: PROTOCOL_VERSION, room, role: opts.role ?? 'player', ...opts });
  }

  intent(intent: Intent): number {
    const seq = ++this.seq;
    this.send({ t: 'intent', seq, intent });
    return seq;
  }

  async ack(intent: Intent) {
    const seq = this.intent(intent);
    return this.waitFor(
      (m): m is Extract<ServerMessage, { t: 'ack' }> => m.t === 'ack' && m.seq === seq,
    );
  }

  /** Aspetta il primo messaggio (già arrivato o futuro) che soddisfa la condizione. */
  async waitFor<T extends ServerMessage>(
    pred: (m: ServerMessage) => m is T,
    ms?: number,
  ): Promise<T>;
  async waitFor(pred: (m: ServerMessage) => boolean, ms?: number): Promise<ServerMessage>;
  async waitFor(pred: (m: ServerMessage) => boolean, ms = 3000): Promise<ServerMessage> {
    const deadline = Date.now() + ms;
    let from = 0;
    for (;;) {
      const found = this.messages.slice(from).find(pred);
      if (found) return found;
      from = this.messages.length;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('messaggio atteso non arrivato');
      await new Promise<void>((ok) => {
        const t = setTimeout(ok, left);
        this.waiters.push(() => {
          clearTimeout(t);
          ok();
        });
      });
    }
  }

  /** Aspetta che l'ultima vista ricevuta soddisfi la condizione. */
  async view(pred: (v: GameView) => boolean = () => true, ms = 3000): Promise<GameView> {
    const deadline = Date.now() + ms;
    for (;;) {
      const s = this.latestState();
      if (s && pred(s.view)) return s.view;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`vista attesa non arrivata (fase ${s?.view.phase})`);
      await new Promise<void>((ok) => {
        const t = setTimeout(ok, left);
        this.waiters.push(() => {
          clearTimeout(t);
          ok();
        });
      });
    }
  }

  latestState(): Extract<ServerMessage, { t: 'state' }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m?.t === 'state') return m;
    }
    return undefined;
  }

  get latest(): GameView {
    const s = this.latestState();
    if (!s) throw new Error('nessuno stato ricevuto');
    return s.view;
  }

  async waitClosed(ms = 3000) {
    const deadline = Date.now() + ms;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('connessione non chiusa');
      await new Promise((ok) => setTimeout(ok, 10));
    }
    return this.closed;
  }

  close() {
    this.ws.close();
  }
}
