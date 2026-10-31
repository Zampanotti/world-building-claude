import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLinks } from "../shared/richtext.ts";

test("éditeur : les liens sont isolés du texte et le balisage se recompose à l'identique", () => {
  const text = "La nuit était tombée sur [[1|Aldémar]].\n\nÀ [[3|Haute-Cendre]], [[6|Edric le Gris]] referma son registre. **Fin.**\n";
  const segs = splitLinks(text);
  assert.deepEqual(segs.filter((s) => s.kind === "link").map((s) => s.kind === "link" && [s.id, s.label]), [[1, "Aldémar"], [3, "Haute-Cendre"], [6, "Edric le Gris"]]);
  // Aucun code de lien ne reste dans les morceaux de texte affichés tels quels.
  for (const s of segs) if (s.kind === "text") assert.doesNotMatch(s.text, /\[\[\d+\|/);
  assert.equal(segs.map((s) => (s.kind === "text" ? s.text : s.raw)).join(""), text);
  // Liens collés, en début et en fin de texte ; texte sans lien ; balisage incomplet laissé tel quel.
  assert.deepEqual(splitLinks("[[1|A]][[2|B]]").map((s) => s.kind), ["link", "link"]);
  assert.deepEqual(splitLinks("sans lien"), [{ kind: "text", text: "sans lien" }]);
  assert.deepEqual(splitLinks(""), []);
  assert.deepEqual(splitLinks("[[ en cours"), [{ kind: "text", text: "[[ en cours" }]);
});
