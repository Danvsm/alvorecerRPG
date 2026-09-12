"use client";
import { browserDb } from "./client";
export async function uploadItemImage(file: File, campaign: string) {
  if (
    file.size > 5 * 1024 * 1024 ||
    !["image/webp", "image/jpeg", "image/png"].includes(file.type)
  )
    throw new Error("Use WebP, JPG ou PNG de até 5 MB");
  const image = await createImageBitmap(file);
  if (image.width * image.height > 16000000) {
    image.close();
    throw new Error("A imagem excede 16 megapixels");
  }
  const scale = Math.min(1, 320 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(
      (b) =>
        b ? res(b) : rej(new Error("Não foi possível converter a imagem")),
      "image/webp",
      0.78,
    ),
  );
  if (blob.type !== "image/webp" || blob.size > 262144)
    throw new Error("Não foi possível otimizar a imagem para WebP");
  const path = `${campaign}/${crypto.randomUUID()}.webp`;
  const { error } = await browserDb()
    .storage.from("item-media")
    .upload(path, blob, { contentType: "image/webp" });
  if (error) throw error;
  return path;
}
