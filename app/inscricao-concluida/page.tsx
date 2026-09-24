import { CheckCircle2 } from "lucide-react";
import { Brand } from "@/components/Common";

export default function RegistrationCompletePage() {
  return (
    <main className="auth">
      <div className="auth-panel registration-complete">
        <Brand />
        <div className="auth-symbol registration-complete-icon">
          <CheckCircle2 size={46} />
        </div>
        <p className="eyebrow">CADASTRO FINALIZADO</p>
        <h1>Sua inscrição foi concluída.</h1>
        <p>
          Sua conta e seu personagem foram criados com sucesso.
        </p>
        <p className="muted">
          Agora abra o aplicativo Alvorecer e entre com o username e a senha
          que você acabou de criar.
        </p>
      </div>
    </main>
  );
}
