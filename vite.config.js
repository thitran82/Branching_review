import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local dev, proxy /api/* to `vercel dev` (port 3000) so the serverless
// functions run. In production on Vercel, /api/* is served natively.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
});
