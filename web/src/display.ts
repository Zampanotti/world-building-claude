import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";

/**
 * Préférences d'affichage propres à cet appareil (navigateur), communes à tous
 * les mondes. Les polices sont embarquées dans l'application ; le navigateur ne
 * télécharge que celle qui est utilisée.
 */
export const FONTS = [
  { id: "literata", label: "Literata", family: '"Literata Variable", Georgia, serif', note: "Serif moderne, faite pour la lecture longue sur écran." },
  { id: "source-serif", label: "Source Serif", family: '"Source Serif 4 Variable", Georgia, serif', note: "Serif sobre et éditoriale, plus compacte." },
  { id: "inter", label: "Inter", family: '"Inter Variable", system-ui, sans-serif', note: "Sans empattements, très moderne, façon outil de notes." },
  { id: "classique", label: "Classique", family: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif', note: "Police d'origine, style livre ancien (polices du système)." },
] as const;

export type FontId = (typeof FONTS)[number]["id"];
const KEY = "wb-font";

export function getFont(): FontId {
  try { const v = localStorage.getItem(KEY); if (FONTS.some((f) => f.id === v)) return v as FontId; } catch { /* stockage indisponible */ }
  return "literata";
}

/** Applique la police des textes (variable CSS --serif). */
export function applyFont(id: FontId = getFont()) {
  const f = FONTS.find((x) => x.id === id) ?? FONTS[0];
  document.documentElement.style.setProperty("--serif", f.family);
}

export function setFont(id: FontId) {
  try { localStorage.setItem(KEY, id); } catch { /* stockage indisponible : réglage pour cette visite seulement */ }
  applyFont(id);
}
