import { notFound } from "next/navigation";
import DevPreview from "@/components/DevPreview";

export default function DevPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_DEV_PREVIEW !== "true"
  )
    notFound();
  return <DevPreview />;
}
