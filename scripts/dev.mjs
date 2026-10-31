// Lance le serveur API (rechargé à chaque modification) et Vite en parallèle.
// On appelle directement l'exécutable Node, sans shell ni npm/npx : cela marche
// de la même façon sous Windows, macOS et Linux.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const vite = resolve("node_modules/vite/bin/vite.js");
if (!existsSync(vite)) {
  console.error("Vite est introuvable : lancez d'abord « npm install » dans ce dossier.");
  process.exit(1);
}
const run = (args) => spawn(process.execPath, args, { stdio: "inherit" });
const children = [
  run(["--watch", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server/main.ts"]),
  run([vite]),
];
const stop = () => { for (const c of children) c.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
