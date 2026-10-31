import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le front est servi par Vite en développement (proxy /api vers le serveur Node)
// et compilé dans dist/ pour être servi par le serveur Node en production.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3000" } },
});
