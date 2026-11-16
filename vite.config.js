import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { contentSecurityPolicy } from "./infra/aws/security.mjs";
export default defineConfig({
  plugins: [react()],
  preview: {
    headers: { "Content-Security-Policy": contentSecurityPolicy },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/config.json": "http://127.0.0.1:3001",
    },
  },
});
