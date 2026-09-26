import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { ApiClient } from './lib/api-client';
import { AuthController } from './lib/auth/auth-controller';
import { env } from './lib/env';
import { HotkeyRegistry } from './lib/hotkeys';
import { createQueryClient } from './lib/query-client';
import { initTheme } from './lib/theme/theme-store';
import { createAppRouter } from './router';
import './styles/index.css';

initTheme();

const api = new ApiClient({ baseUrl: env.VITE_API_BASE_URL });
const queryClient = createQueryClient();
const auth = new AuthController(api, queryClient);
const context = { auth, queryClient };
const router = createAppRouter(context);
// Outside React, so StrictMode's double effects never send the refresh cookie twice.
void auth.restore();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root missing');

createRoot(rootElement).render(
  <StrictMode>
    <App services={{ api, auth, hotkeys: new HotkeyRegistry(), router, context }} />
  </StrictMode>,
);
