import { z } from 'zod';

const envSchema = z.object({
  /**
   * The API base URL. The default `/api/v1` goes through the Vite dev proxy (same origin). A
   * separate origin (e.g. `http://localhost:3000/api/v1`) needs the API's `APP_ORIGIN` set to
   * this app's origin, for CORS with credentials.
   */
  VITE_API_BASE_URL: z.string().min(1).default('/api/v1'),
});

export const env = envSchema.parse(import.meta.env);
