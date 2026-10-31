import { useEffect, useState } from "react";

/**
 * Routage par fragment (#/…) : aucune configuration serveur nécessaire et
 * l'historique du navigateur sert de « retour ».
 */
export function parseHash(): { path: string[]; query: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, "");
  const [p, q] = raw.split("?");
  return { path: p.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? "") };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => { setRoute(parseHash()); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (href: string) => { location.hash = href.startsWith("#") ? href : "#" + href; };
