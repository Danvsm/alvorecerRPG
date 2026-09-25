import type { Metadata } from "next";
import JogarLanding from "./JogarLanding";

export const metadata: Metadata = {
  title: "Alvorecer RPG | A Promessa do Amanhecer",
  description:
    "Conheça Alvorecer e manifeste seu interesse em participar de uma próxima mesa de RPG.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function JogarPage() {
  return <JogarLanding />;
}
