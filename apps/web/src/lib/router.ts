import { useSyncExternalStore } from 'react';

const subscribe = (fn: () => void) => {
  window.addEventListener('popstate', fn);
  return () => window.removeEventListener('popstate', fn);
};

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export type Route =
  | { name: 'home' }
  | { name: 'room'; code: string }
  | { name: 'tv'; code: string }
  | { name: 'notFound' };

export function matchRoute(path: string): Route {
  if (path === '/' || path === '') return { name: 'home' };
  const room = /^\/r\/([A-Za-z]{4})\/?$/.exec(path);
  if (room) return { name: 'room', code: (room[1] as string).toUpperCase() };
  const tv = /^\/tv\/([A-Za-z]{4})\/?$/.exec(path);
  if (tv) return { name: 'tv', code: (tv[1] as string).toUpperCase() };
  return { name: 'notFound' };
}
