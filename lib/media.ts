"use client";
import { browserDb } from "./client";
export async function optimizedWebp(file: File, maximumEdge: number) {
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
  const scale = Math.min(1, maximumEdge / Math.max(image.width, image.height));
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
  return blob;
}

export async function uploadItemImage(file: File, campaign: string) {
  const blob = await optimizedWebp(file, 320);
  const path = `${campaign}/${crypto.randomUUID()}.webp`;
  const { error } = await browserDb()
    .storage.from("item-media")
    .upload(path, blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}

export async function uploadAvatarImage(file: File, campaign: string) {
  const blob = await optimizedWebp(file, 512);
  const path = `${campaign}/avatars/${crypto.randomUUID()}.webp`;
  const { error } = await browserDb()
    .storage.from("portraits")
    .upload(path, blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}

export async function uploadFrameImage(file: File, campaign: string) {
  if (
    file.size > 8 * 1024 * 1024 ||
    !["image/webp", "image/png"].includes(file.type)
  )
    throw new Error("Use PNG transparente ou WebP de até 8 MB");
  const image = await createImageBitmap(file);
  if (image.width * image.height > 16000000) {
    image.close();
    throw new Error("A imagem excede 16 megapixels");
  }
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    image.close();
    throw new Error("Não foi possível preparar a moldura");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Não foi possível converter a moldura")),
      "image/webp",
      0.88,
    ),
  );
  if (blob.type !== "image/webp" || blob.size > 1024 * 1024)
    throw new Error("A moldura otimizada excede 1 MB");
  const path = `${campaign}/frames/${crypto.randomUUID()}.webp`;
  const { error } = await browserDb()
    .storage.from("avatar-frames")
    .upload(path, blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}

async function postImageWebp(file: File) {
  if (
    file.size > 12 * 1024 * 1024 ||
    !["image/webp", "image/jpeg", "image/png"].includes(file.type)
  )
    throw new Error("Use WebP, JPG ou PNG de até 12 MB");
  const image = await createImageBitmap(file);
  if (image.width * image.height > 24000000) {
    image.close();
    throw new Error("A imagem excede 24 megapixels");
  }

  let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  let blob: Blob | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      image.close();
      throw new Error("Não foi possível preparar a foto");
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const quality = Math.max(0.68, 0.88 - attempt * 0.05);
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Não foi possível converter a foto")),
        "image/webp",
        quality,
      ),
    );
    if (blob.size <= 1024 * 1024) break;
    scale *= 0.82;
  }
  image.close();
  if (!blob || blob.type !== "image/webp" || blob.size > 1024 * 1024)
    throw new Error("Não foi possível reduzir a foto para menos de 1 MB");
  return blob;
}

export async function uploadCommunityArticleImage(
  file: File,
  campaign: string,
) {
  const blob = await postImageWebp(file);
  const path = `${campaign}/editorial/${crypto.randomUUID()}.webp`;
  const { error } = await browserDb()
    .storage.from("community-articles")
    .upload(path, blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}

export async function uploadMedalImage(file: File, campaign: string) {
  if (file.type !== "image/png")
    throw new Error("A medalha precisa ser enviada em PNG");
  if (file.size > 1024 * 1024)
    throw new Error("O PNG da medalha deve ter no máximo 1 MB");

  const image = await createImageBitmap(file);
  if (image.width * image.height > 16000000) {
    image.close();
    throw new Error("A imagem excede 16 megapixels");
  }
  image.close();

  const path = `${campaign}/medals/${crypto.randomUUID()}.png`;
  const { error } = await browserDb()
    .storage.from("avatar-frames")
    .upload(path, file, {
      contentType: "image/png",
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}

export async function uploadProfileWallpaper(file: File, campaign: string) {
  if (
    file.size > 1024 * 1024 ||
    !["image/webp", "image/jpeg", "image/png"].includes(file.type)
  )
    throw new Error("Use WebP, JPG ou PNG de até 1 MB");

  const image = await createImageBitmap(file);
  if (image.width * image.height > 24000000) {
    image.close();
    throw new Error("A imagem excede 24 megapixels");
  }

  let scale = Math.min(1, 1920 / Math.max(image.width, image.height));
  let blob: Blob | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      image.close();
      throw new Error("Não foi possível preparar o wallpaper");
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Não foi possível converter o wallpaper")),
        "image/webp",
        Math.max(0.7, 0.88 - attempt * 0.04),
      ),
    );
    if (blob.size <= 1024 * 1024) break;
    scale *= 0.86;
  }
  image.close();

  if (!blob || blob.type !== "image/webp" || blob.size > 1024 * 1024)
    throw new Error("Não foi possível reduzir o wallpaper para até 1 MB");

  const path = `${campaign}/wallpapers/${crypto.randomUUID()}.webp`;
  const { error } = await browserDb()
    .storage.from("profile-wallpapers")
    .upload(path, blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}

export async function uploadCommunityPostImage(
  file: File,
  campaign: string,
  actor: string,
) {
  const blob = await postImageWebp(file);
  const path = `${campaign}/${actor}/${crypto.randomUUID()}.webp`;
  const { error } = await browserDb()
    .storage.from("community-posts")
    .upload(path, blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}

export async function uploadCommunityStoryImage(
  file: File,
  campaign: string,
  actor: string,
) {
  const blob = await postImageWebp(file);
  const path = `${campaign}/${actor}/${crypto.randomUUID()}.webp`;
  const { error } = await browserDb()
    .storage.from("community-stories")
    .upload(path, blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}
