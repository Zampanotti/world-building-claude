/**
 * Préparation des images dans le navigateur, sans bibliothèque : une photo trop
 * grande (côté > maxSide ou poids > 2 Mo) est réduite et convertie en JPEG.
 * Les GIF et les images transparentes sont envoyés tels quels.
 */
export async function prepareImage(file: File, maxSide = 2000): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const big = Math.max(bitmap.width, bitmap.height) > maxSide;
  if (!big && file.size <= 2 * 1024 * 1024) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (file.type !== "image/jpeg") {
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 255) return file; // transparence : on ne touche à rien
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.9));
}

export async function uploadImage(wid: number, file: File, maxSide = 2000): Promise<{ id: number; reused: boolean }> {
  const blob = await prepareImage(file, maxSide);
  const res = await fetch(`/api/worlds/${wid}/media?name=${encodeURIComponent(file.name)}`, { method: "POST", body: blob });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Envoi impossible.");
  return data;
}
