// Lance le serveur API (rechargé à chaque modification) et Vite en parallèle.
import { spawn } from "node:child_process";

const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
const children = [run("npm", ["run", "dev:server"]), run("npx", ["vite"])];
const stop = () => { for (const c of children) c.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
