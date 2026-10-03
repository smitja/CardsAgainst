/** Nickname scelto nella home per la stanza appena creata: evita di chiederlo due volte. */
const pending = new Map<string, string>();
export const setPendingName = (code: string, name: string) => pending.set(code, name);
export const takePendingName = (code: string) => {
  const n = pending.get(code) ?? null;
  pending.delete(code);
  return n;
};
