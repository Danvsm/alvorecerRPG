import type { Metadata } from "next";
import JogarLanding from "./JogarLanding";

const title = "Alvorecer | Venha jogar RPG";
const description =
  "Participe de A Promessa do Amanhecer, uma campanha presencial de RPG em Nova Iguaçu. Iniciantes são bem-vindos.";

export const metadata: Metadata = {
  metadataBase: new URL("https://alvorecer-rpg-vsm.vercel.app"),
  title,
  description,
  alternates: { canonical: "/jogar" },
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title,
    description,
    type: "website",
    locale: "pt_BR",
    siteName: "Alvorecer RPG",
    url: "/jogar",
    images: [
      {
        url: "/jogar/amanhecer-og.webp",
        width: 1200,
        height: 630,
        alt: "Aventureiros observam uma cidade fantástica ao amanhecer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/jogar/amanhecer-og.webp"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function JogarPage() {
  return <JogarLanding />;
}
