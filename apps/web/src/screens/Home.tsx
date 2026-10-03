import { normalizeRoomCode } from '@cirelli/protocol/client';
import { useState, type FormEvent } from 'react';
import { savedName } from '../net/room-client.ts';
import { navigate } from '../lib/router.ts';
import { setPendingName } from '../lib/pending.ts';

export function Home() {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Scrivi un nickname per creare la stanza.');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { code: room } = (await res.json()) as { code: string };
      setPendingName(room, name.trim());
      navigate(`/r/${room}`);
    } catch {
      setError('Non riesco a creare la stanza. Controlla la connessione e riprova.');
    } finally {
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (!c) return setError('Il codice è di quattro lettere, per esempio BRMT.');
    navigate(`/r/${c}`);
  }

  return (
    <main className="page home">
      <header>
        <h1 className="logo">Cards Against Cirelli</h1>
        <p className="lead">
          Completa la frase peggiore. Un telefono a testa, da tre a dieci persone.
        </p>
      </header>

      <div className="actions">
        <form onSubmit={create} className="stack">
          <label htmlFor="nick">Il tuo nickname</label>
          <input
            id="nick"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
            enterKeyHint="go"
          />
          <button className="primary" disabled={busy}>
            Crea stanza
          </button>
        </form>

        <form onSubmit={join} className="stack">
          <label htmlFor="code">Hai un codice?</label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            enterKeyHint="go"
            className="code-input"
          />
          <button className="secondary">Entra</button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
