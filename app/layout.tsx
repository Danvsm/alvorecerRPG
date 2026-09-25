import "./globals.css";
import "./design-system.css";
import type { Metadata, Viewport } from "next";
import { DM_Sans, Lora } from "next/font/google";
import ImageCache from "@/components/ImageCache";

const interfaceFont = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});
const narrativeFont = Lora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-lora",
});
export const metadata: Metadata = {
  title: "Alvorecer RPG",
  description: "Fichas e combate de A Promessa do Amanhecer",
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090B",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${interfaceFont.variable} ${narrativeFont.variable}`}
    >
      <body>
        {children}
        <ImageCache />
      </body>
    </html>
  );
}
