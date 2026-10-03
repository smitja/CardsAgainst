import { matchRoute, navigate, usePath } from './lib/router.ts';
import { Home } from './screens/Home.tsx';
import { RoomScreen } from './screens/RoomScreen.tsx';
import { TvScreen } from './screens/TvScreen.tsx';

export function App() {
  const route = matchRoute(usePath());
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'room':
      return <RoomScreen key={route.code} code={route.code} />;
    case 'tv':
      return <TvScreen key={route.code} code={route.code} />;
    case 'notFound':
      return (
        <main className="page center">
          <h1>Pagina inesistente</h1>
          <button className="primary" onClick={() => navigate('/')}>
            Torna all’inizio
          </button>
        </main>
      );
  }
}
