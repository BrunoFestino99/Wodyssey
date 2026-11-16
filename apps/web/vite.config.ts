import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'canonical-development-origin',
      configureServer(server) {
        const configured = process.env.WEB_ORIGIN;
        if (!configured) return;
        const canonical = new URL(configured);
        server.middlewares.use((request, response, next) => {
          const host = request.headers.host;
          if (
            host &&
            host !== canonical.host &&
            ['localhost', '127.0.0.1'].includes(host.split(':')[0])
          ) {
            response.writeHead(302, {
              Location: canonical.origin + (request.url ?? '/'),
              'Cache-Control': 'no-store',
            });
            response.end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    // Docker Compose sets this: file events from a bind-mounted host folder do not reach every container.
    watch: process.env.WATCH_POLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
  },
});
