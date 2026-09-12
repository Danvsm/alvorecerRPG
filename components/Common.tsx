import { BookOpen } from "lucide-react";
export function Brand({ logo }: { logo?: string }) {
  return (
    <div className="brand">
      <img src={logo || "/alvorecer-mark.svg"} alt="Alvorecer" />
      <span>
        ALVORECER<small>RPG • A PROMESSA DO AMANHECER</small>
      </span>
    </div>
  );
}
export function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <BookOpen size={28} />
      <p>{text}</p>
    </div>
  );
}
