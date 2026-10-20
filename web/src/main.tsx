import { createRoot } from 'react-dom/client';
import { useRoute, restoreDeepLink, linkProps } from './router';
import { applyTheme } from './theme';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BoardPage from './pages/BoardPage';
import TryPage from './pages/TryPage';
import { Mark } from './icons';
// fonts ship with the app (no third-party requests, and they work offline)
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/fraunces/wght.css';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import '@fontsource/caveat/500.css';
import '@fontsource/caveat/700.css';
import './styles.css';
import './pages.css';

restoreDeepLink();
applyTheme();

function Root() {
  const r = useRoute();
  switch (r.name) {
    case 'home': return <Landing />;
    case 'login': return <Login key={r.mode} mode={r.mode} next={r.next} token={r.token} />;
    case 'boards': return <Dashboard tab={r.tab} />;
    case 'board': return <BoardPage key={r.id + (r.k || '')} id={r.id} k={r.k} />;
    case 'try': return <TryPage />;
    default: return (
      <div className="gate">
        <Mark size={40} />
        <h1>This page doesn’t exist</h1>
        <p className="muted">The link may be mistyped, or the page was moved.</p>
        <a className="btn primary" {...linkProps('/')}>Go to Tessel</a>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(<Root />);

// installable app + opens offline (production only, so local development never serves stale files)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL }).catch(() => {}); });
}
