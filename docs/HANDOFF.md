# Handoff — Alvorecer RPG

Atualizado em 14/09/2026, 17:15 UTC.

Este documento consolida o estado real anteriormente registrado em `VALIDACAO.md` e as verificações de infraestrutura feitas antes desta continuação. Ele não declara a validação final concluída.

## Infraestrutura atual

- GitHub: `Danvsm/alvorecerRPG`.
- Vercel: projeto `alvorecer-rpg-vsm`, ID `prj_QaxFObeWPJ8w0urfdzYICRDwIlHs`, equipe `team_CnaWIE2ArNb8Rmus0NWgv4Hr`.
- Produção: `https://alvorecer-rpg-vsm.vercel.app`.
- Supabase: projeto `alvorecer`, Project Ref `wsihnbrnqdnmidjvjchn`, região `sa-east-1`, estado `ACTIVE_HEALTHY`.
- Edge Function principal: `alvorecer-api`, ativa, versão 8, `verify_jwt=false`.
- Não criar outro projeto Vercel, Supabase ou banco para esta continuação.

## Código e deploy

- Branch: `main`.
- Commit-base confirmado: `42292c73ddc8c031c483ecfc738a2473b16f8909`.
- Versão do pacote: `1.3.0`.
- Deploy Vercel do commit-base: `dpl_33qJLEyhMB38knJMuDTzbf6DMEXX`.
- Estado confirmado: `READY`, alvo `production`, origem GitHub `Danvsm/alvorecerRPG`, ref `main`.
- Commits de documentação criados nesta continuação: `9ccc68a09b1e2a4b96af8dc0f45b246ad3c94c16` (`docs/HANDOFF.md`) e `276f6690ccd04bba53a3994a50daeaac4892a8a5` (`CHANGELOG.md`).
- O commit `276f6690ccd04bba53a3994a50daeaac4892a8a5` chegou a `READY` em produção no deploy `dpl_7PQZSrt1rhFSmkuTrCvSGmJ8AjxC`.
- Esta atualização do handoff gerará um novo commit exclusivamente documental; confirmar seu deploy antes de encerrar.

## Banco, migrations e função

- As 24 migrations registradas estão aplicadas no Supabase real.
- A última migration aplicada é `20260914021916_chat_media_cleanup_timeout`.
- A migration mantém o cron `alvorecer-chat-media-cleanup` a cada 15 minutos e aumenta o timeout de `pg_net` para 60 segundos.
- A chamada de limpeza usa o endpoint `/functions/v1/alvorecer-api/media-cleanup` e autenticação guardada no Vault.
- A Edge Function `alvorecer-api` está ativa na versão 8.

## Entregas concluídas

- Aplicação Next.js real com Supabase Auth, RLS, Realtime, Storage privado, Vault e proxy seguro para a Edge Function.
- Login por username, mestre inicial, criação de jogador e convite de uso único.
- Ficha, recursos calculados, atributos dinâmicos, vantagens, inventário, consumíveis, lojas e Dracmas em centavos.
- Galeria privada de avatares, perfis, cosméticos, notificações, comunidade, mural e chat direto com imagem temporária.
- Administração de XP, Dracmas, vantagens, inventário e dados do jogador.
- Criaturas reutilizáveis, NPCs, minions, salas e participantes de combate, com ocultação de valores numéricos.
- Histórico e auditoria dos comandos sensíveis.
- Timeout da limpeza de mídia temporária corrigido; uma execução posterior respondeu HTTP 200.
- No commit `42292c7`, valores estruturados do histórico passaram a ser formatados em vez de exibirem `[object Object]`.
- No commit `42292c7`, destinatário/identidade do chat são limpos ao sair ou trocar campanha, e o chat é remontado ao trocar conta/identidade.

## Testes já concluídos

### Automatizados

- `npm test`: 16/16 testes aprovados.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado.
- Rotas esperadas geradas: `/`, `/api/auth`, `/api/admin`, `/convite/[token]` e `/dev`.

### Supabase e produção

- Deploys dos commits `cc1c80a`, `b7e12c5` e `42292c7` chegaram a `READY`.
- Login e telas administrativas abriram como Pink/Mestre.
- Como darkvsm/jogador: papel e restrições de menu confirmados.
- Mensagem e imagem de Pink apareceram para darkvsm; imagem com 480 px de largura natural.
- Leitura da conversa zerou o contador e uma resposta de darkvsm para Pink foi enviada.
- Notificações foram marcadas como lidas.
- Perfil, coleção, comunidade, ranking e perfil público abriram; a moldura Lua permaneceu equipada após salvar.
- Uma publicação de teste no mural foi salva com autoria darkvsm.
- Como jogador, inimigos ocultos mostraram apenas estado e “Vida exata não revelada”.
- Ficha e progressão carregaram; sem XP disponível, os 11 botões de compra estavam desabilitados.
- Os scripts reais anteriores validaram login, criação, convite de uso único, isolamento RLS, recursos, multiplicadores, Dracmas, compras, consumíveis, criaturas, ocultação da vida, Realtime nos dois sentidos, Storage privado e credenciais cifradas.
- O cron de limpeza respondeu HTTP 200 após o aumento do timeout.

## Ainda falta testar

- A entrega e leitura do chat nos dois sentidos estão confirmadas no banco: darkvsm leu as mensagens de Pink e Pink leu a resposta de darkvsm. Ainda falta confirmar visualmente a apresentação da resposta na interface.
- Exercitar novamente a troca de conta no site publicado e confirmar visualmente que conversa, destinatário e identidade não vazam entre sessões.
- Confirmar na interface publicada a formatação corrigida do histórico.
- Concluir um teste interativo de combate entre Pink e jogador, incluindo atualização simultânea mestre → jogador e jogador → mestre.
- Validar os comandos administrativos restantes com dados de teste identificáveis, sem afetar dados reais.
- Revisar layout mobile em largura próxima de 390 px: navegação, cards, formulários, chat e combate sem rolagem horizontal.
- Após `2026-09-15 02:13:29 UTC`, confirmar `chat_media.deleted_at` e a ausência física do objeto no bucket `chat-media`. Uma verificação condicional horária foi agendada a partir de 14/09 16:30 em `America/Sao_Paulo` para o registro-alvo.
- Confirmar que os commits de documentação/correção desta continuação também chegam a `READY` no projeto Vercel correto.

## Bugs conhecidos

- Não há bug funcional aberto confirmado neste momento.
- Corrigidos em `42292c7`: histórico exibindo `[object Object]` e estado do chat herdado ao trocar sessão/campanha.
- Riscos ainda não encerrados: regressão visual mobile, troca de conta, sincronização interativa entre duas sessões e remoção física da imagem temporária.
- Limitação operacional desta continuação: o ambiente atual não expõe navegador interativo. A integração TinyFish foi localizada e sugerida, mas ainda não está instalada/conectada. Qualquer item não comprovável por API, banco ou inspeção de código permanece explicitamente como não testado.
- Há duas salas antigas de teste `Verificação ...` ainda ativas, além da sala vazia `combate`; são artefatos identificáveis de validações anteriores e devem ser encerrados/arquivados pela interface após o teste interativo, não tratados como bug do produto.

## Próximo passo exato

1. Instalar/conectar TinyFish para disponibilizar navegador automatizado nesta conversa.
2. No domínio publicado, entrar primeiro como Pink, conferir visualmente a resposta de darkvsm e o histórico formatado; sair e entrar como darkvsm para validar a troca de sessão sem herança de chat.
3. Com Pink e jogador em sessões distintas, alterar um recurso pelo mestre, gastar um recurso pelo jogador e observar a atualização Realtime nas duas telas; depois encerrar/arquivar as salas `Verificação ...` remanescentes.
4. Repetir os mesmos fluxos em viewport de 390 px e confirmar ausência de rolagem horizontal em navegação, cards, formulários, chat e combate.
5. Aguardar a verificação condicional da mídia-alvo após 14/09/2026 23:13:29 em São Paulo; exigir `deleted_at` preenchido, objeto ausente e HTTP 200 do cron.
6. Corrigir somente problemas reproduzidos, repetir os gates quando houver alteração de código e atualizar este documento com evidências finais.


## Continuação verificada — 14/09/2026, 17:15 UTC

- O domínio de produção respondeu HTTP 200 com o cabeçalho de viewport mobile e os cabeçalhos de segurança esperados.
- O commit documental `276f6690ccd04bba53a3994a50daeaac4892a8a5` está em `READY` no projeto Vercel correto.
- A Vercel não registrou erros de runtime nas últimas 24 horas.
- Pink e darkvsm possuem login recente em produção. O banco confirma que ambos leram todas as mensagens recebidas na conversa entre eles; Pink marcou como lida, às 06:13 UTC, a resposta enviada por darkvsm às 05:45 UTC.
- Depois do deploy de `42292c7`, o histórico registra ações reais pela interface: darkvsm gastou Vida, Mana e Fôlego; Pink removeu participantes de combate e executou transferências. Não houve erro de banco nessas ações.
- A sincronização visual simultânea entre duas telas continua não comprovada neste ambiente.
- Revisão mobile estática concluída: CSS publicado contém breakpoints em 760 px e 380 px, grids responsivos, formulários empilhados, diálogo limitado ao viewport, combate em uma coluna e chat com largura `min(390px, calc(100vw - 24px))`. Nenhum defeito foi encontrado por inspeção; o teste visual em 390 px continua pendente.
- Às 17:06 UTC, a imagem-alvo ainda estava dentro do prazo, com `deleted_at` nulo e objeto presente, como esperado. A expiração é 15/09/2026 às 02:13:29 UTC.
- As 20 respostas do cron observadas entre 12:15 e 17:00 UTC foram HTTP 200, sem timeout nem erro, com `removed: 0` e `pending: 0`, coerente com não haver mídia vencida naquele intervalo.
- Uma verificação condicional horária foi criada para confirmar a remoção lógica e física da imagem-alvo depois da expiração.
- Nenhum novo bug de código foi reproduzido; portanto, não foi feita correção especulativa.
