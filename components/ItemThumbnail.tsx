"use client";
import { useEffect, useState } from "react";
import { browserDb } from "@/lib/client";
import { versionedImageUrl } from "@/lib/image-cache";
export default function ItemThumbnail({
  path,
  name,
}: {
  path?: string | null;
  name: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let valid = true;
    if (path)
      browserDb()
        .storage.from("item-media")
        .createSignedUrl(path, 3600)
        .then(({ data }) => {
          if (valid) setUrl(versionedImageUrl(data?.signedUrl, path));
        });
    return () => {
      valid = false;
    };
  }, [path]);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={name}
      width={64}
      height={64}
      style={{ objectFit: "contain", borderRadius: 6 }}
      loading="lazy"
      onError={() => setUrl("")}
    />
  );
}
