import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { useRoute } from "./router.ts";
import { Toaster, useLoad, Loading, ErrorBox } from "./ui.tsx";
import { api, w } from "./api.ts";
import { Home } from "./pages/Home.tsx";
import { Dashboard, WorldSettings } from "./pages/Dashboard.tsx";
import { Explorer } from "./pages/Explorer.tsx";
import { EntityPage } from "./pages/Entity.tsx";
import { TypesPage } from "./pages/Types.tsx";
import { Writing } from "./pages/Writing.tsx";
import { MapsList, MapViewer } from "./pages/Maps.tsx";
import { Chronology } from "./pages/Chronology.tsx";
import { MediaPage } from "./pages/Media.tsx";
import { SearchPage } from "./pages/Search.tsx";
import { ArchivePage, ImportPanel } from "./pages/Archive.tsx";
import { Reader } from "./pages/Reader.tsx";
import { Help } from "./pages/Help.tsx";

// Les textes passent en premier : c'est la page d'arrivée d'un monde.
const NAV: [string, string, string][] = [
  ["documents", "✒️", "Textes"],
  ["entities", "📇", "Fiches"],
  ["dashboard", "🏠", "Tableau de bord"],
  ["maps", "🗺️", "Cartes"],
  ["chronology", "⏳", "Chronologie"],
  ["media", "🖼️", "Médiathèque"],
  ["search", "🔎", "Recherche"],
  ["types", "🧩", "Types et relations"],
];

function WorldLayout({ wid, path, query }: { wid: number; path: string[]; query: URLSearchParams }) {
  const world = useLoad(() => api<{ world: { name: string } }>("GET", w(wid)), [wid]);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [path.join("/")]);
  useEffect(() => { if (world.data) document.title = `${world.data.world.name} — World Building`; }, [world.data]);
  const section = path[0] ?? "";
  if (world.error) return <div className="main"><ErrorBox error={world.error} retry={world.reload} /><p><a href="#/">← Mes mondes</a></p></div>;
  let page;
  switch (section) {
    case "dashboard": page = <Dashboard wid={wid} />; break;
    case "entities": page = path[1] ? <EntityPage key={path[1]} wid={wid} id={Number(path[1])} /> : <Explorer wid={wid} query={query} />; break;
    case "types": page = <TypesPage wid={wid} />; break;
    case "documents": page = <Writing wid={wid} docId={path[1] ? Number(path[1]) : null} query={query} />; break;
    case "maps": page = path[1] ? <MapViewer key={path[1]} wid={wid} id={Number(path[1])} query={query} /> : <MapsList wid={wid} />; break;
    case "chronology": page = <Chronology wid={wid} />; break;
    case "media": page = <MediaPage wid={wid} />; break;
    case "search": page = <SearchPage wid={wid} query={query} />; break;
    case "archive": page = <ArchivePage wid={wid} />; break;
    case "settings": page = <WorldSettings wid={wid} onChange={world.reload} />; break;
    default: page = <p>Page inconnue. <a href={`#/w/${wid}`}>Retour aux textes</a></p>;
  }
  return (
    <div className="layout">
      <nav className={`sidebar ${menu ? "open" : ""}`} aria-label="Navigation du monde">
        <a href="#/" className="small muted" style={{ padding: "0 .6rem" }}>← Mes mondes</a>
        <div className="world-name">{world.data?.world.name ?? "…"}</div>
        {NAV.map(([p, icon, label]) => (
          <a key={p} className={`nav ${section === p ? "active" : ""}`} href={`#/w/${wid}${p ? "/" + p : ""}`}><span aria-hidden>{icon}</span>{label}</a>
        ))}
        <div className="sep" />
        <a className={`nav ${section === "archive" ? "active" : ""}`} href={`#/w/${wid}/archive`}><span aria-hidden>💾</span>Sauvegarde</a>
        <a className="nav" href={`#/read/${wid}`}><span aria-hidden>📖</span>Lecture publique</a>
        <a className={`nav ${section === "settings" ? "active" : ""}`} href={`#/w/${wid}/settings`}><span aria-hidden>⚙️</span>Réglages du monde</a>
        <a className="nav" href="#/aide"><span aria-hidden>❓</span>Aide</a>
      </nav>
      <main className="main">
        <button className="btn small menu-toggle" style={{ marginBottom: ".8rem" }} onClick={() => setMenu(!menu)}>☰ Menu — {world.data?.world.name ?? ""}</button>
        {world.loading && !world.data ? <Loading /> : page}
      </main>
    </div>
  );
}

function App() {
  const { path, query } = useRoute();
  useEffect(() => { if (path[0] !== "w") document.title = "World Building"; window.scrollTo(0, 0); }, [path.join("/")]); // eslint-disable-line react-hooks/exhaustive-deps
  // Entrer dans un monde ouvre ses textes (sans ajouter d'étape à l'historique).
  const worldRoot = path[0] === "w" && path[1] && path.length === 2;
  useEffect(() => { if (worldRoot) location.replace(`#/w/${path[1]}/documents`); }, [worldRoot, path[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  let content;
  if (worldRoot) content = null;
  else if (path[0] === "w" && path[1]) content = <WorldLayout key={path[1]} wid={Number(path[1])} path={path.slice(2)} query={query} />;
  else if (path[0] === "read" && path[1]) content = <Reader wid={Number(path[1])} id={path[2] ? Number(path[2]) : null} />;
  else if (path[0] === "aide") content = <Help />;
  else if (path[0] === "import") content = <div className="hero"><p><a href="#/">← Mes mondes</a></p><h1>Importer un monde</h1><ImportPanel /></div>;
  else content = <Home />;
  return <>{content}<Toaster /></>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
