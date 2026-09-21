# Conexão das chamadas de voz

## Correção de 21/09/2026

O banco registrou chamadas encerradas cerca de 16 segundos após atender com
`Falha na conexão WebRTC`. A versão anterior oferecia apenas servidores STUN,
sem TURN. A ausência de relay impede áudio em algumas combinações de NAT,
redes móveis e firewalls, mesmo quando a negociação SDP funciona.

Esta atualização:

- Obtém a configuração ICE em `/api/calls/ice`, autenticada com o JWT do usuário.
- Usa a RLS existente para exigir acesso a uma chamada ativa antes de fornecer
  credenciais temporárias. Não usa service role.
- Integra Cloudflare Realtime TURN, com credenciais de 4 horas emitidas pelo
  servidor e reaproveitadas por até 5 minutos por usuário/chamada.
- Mantém STUN quando TURN ainda não foi configurado. Isso não resolve NAT
  restritivo: a ativação abaixo continua necessária.
- Tolera interrupções de 3 segundos e faz uma tentativa de ICE restart. Dá
  até 35 segundos para a recuperação, em vez de desligar imediatamente.
- Aceita novas ofertas de recuperação e ignora respostas de tentativas antigas.
- Não encerra a chamada por causa de um único candidato ICE incompatível.
- Reconcilia sinais ao conectar/reconectar o Realtime, consulta sinais a cada
  2,5 segundos enquanto o áudio não está conectado e confere o estado da chamada
  a cada 5 segundos durante uma chamada. Não faz polling de sinais com áudio conectado.
- Exibe `Conectando áudio...` / `Reconectando áudio...` até a conexão real.
- Preserva o botão existente para liberar reprodução quando o navegador bloqueia autoplay.

## Ativação com Metered, provedor escolhido

Na Vercel, projeto `alvorecer-rpg-vsm`, em **Settings > Environment Variables >
Production**, configure `METERED_TURN_USERNAME` e `METERED_TURN_CREDENTIAL` com
os valores `username` e `credential` do painel Metered. Faça um novo deploy.

Quando esses dois valores estão presentes, a aplicação usa Metered com as rotas
UDP/TCP na porta 80, UDP na 443 e TLS/TCP na 443. Uma configuração parcial é
recusada, em vez de voltar silenciosamente para STUN. Metered tem prioridade
sobre a configuração alternativa Cloudflare.

Os valores não ficam no repositório nem no bundle público. A rota autenticada
entrega as credenciais TURN aos participantes de uma chamada ativa, como exige
o protocolo WebRTC. Neste modo, a validade das credenciais é a definida na
Metered; a aplicação não emite credenciais temporárias próprias.

O cadastro das variáveis e a validação manual entre aparelhos são necessários
para considerar a retransmissão ativada. Os testes locais usam credenciais
fictícias e não validam a conta ou a franquia da Metered.

## Alternativa: ativação com Cloudflare

1. No Cloudflare Dashboard, abra **Realtime > TURN** e crie uma TURN key.
   Consulte as condições de uso/cobrança da própria conta antes de habilitar.
2. Na Vercel, projeto existente `alvorecer-rpg-vsm`, configure em
   **Settings > Environment Variables > Production**:
   - `TURN_KEY_ID`: identificador da TURN key.
   - `TURN_KEY_API_TOKEN`: token dessa TURN key.
3. Faça um novo deploy para carregar as variáveis.

Não use prefixo `NEXT_PUBLIC_` e não coloque o token permanente em arquivos
versionados. O browser recebe somente username/credential temporários, necessários
ao protocolo TURN. O endpoint não devolve o token permanente nem credenciais Supabase
administrativas. O áudio continua sendo transportado por WebRTC, não pelo banco.

Referência oficial: https://developers.cloudflare.com/realtime/turn/generate-credentials/

## Validação

Os testes locais cobrem negociação inicial, respostas duplicadas/atrasadas,
ICE restart, candidatos inválidos, interrupção breve, timeout, credenciais TURN
e autorização da rota (inclusive após revogação de acesso com configuração em cache).
Os testes de negociação usam um peer simulado e não comprovam áudio entre aparelhos.

Depois de configurar TURN, validar manualmente com dois aparelhos, um em Wi-Fi
e outro na rede móvel: áudio nos dois sentidos por pelo menos 2 minutos, mute,
alto-falante, troca de rede e encerramento. O usuário optou por fazer os testes
na aplicação publicada. Nenhuma conta real foi usada nos testes automatizados.

Sem as credenciais TURN do provedor configuradas, a retransmissão não está ativada.
Nenhuma migration, política RLS ou Edge Function foi alterada nesta correção.
