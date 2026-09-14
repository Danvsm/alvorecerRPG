# Handoff — Alvorecer RPG

Atualizado em 14/09/2026 (UTC).

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
- O SHA de ponta mudará com a criação deste handoff e do changelog; confirmar o novo deploy antes de encerrar.

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

- Abrir como Pink a resposta já enviada por darkvsm e validar o fluxo completo nos dois sentidos.
- Exercitar a troca de conta no site publicado e confirmar que conversa, destinatário e identidade não vazam entre sessões.
- Confirmar na interface publicada a formatação corrigida do histórico.
- Concluir um teste interativo de combate entre Pink e jogador, incluindo atualização simultânea mestre → jogador e jogador → mestre.
- Validar os comandos administrativos restantes com dados de teste identificáveis, sem afetar dados reais.
- Revisar layout mobile em largura próxima de 390 px: navegação, cards, formulários, chat e combate sem rolagem horizontal.
- Após `2026-09-15 02:13:29 UTC`, confirmar `chat_media.deleted_at` e a ausência física do objeto no bucket `chat-media`.
- Confirmar que os commits de documentação/correção desta continuação também chegam a `READY` no projeto Vercel correto.

## Bugs conhecidos

- Não há bug funcional aberto confirmado neste momento.
- Corrigidos em `42292c7`: histórico exibindo `[object Object]` e estado do chat herdado ao trocar sessão/campanha.
- Riscos ainda não encerrados: regressão visual mobile, troca de conta, sincronização interativa entre duas sessões e remoção física da imagem temporária.
- Limitação operacional desta continuação: o ambiente atual não expõe navegador interativo; qualquer item não comprovável por API, banco ou inspeção de código deve permanecer explicitamente como não testado até haver sessão visual disponível.

## Próximo passo exato

1. Criar `CHANGELOG.md` somente com entregas concluídas.
2. Confirmar o deploy dos commits de documentação no projeto Vercel existente.
3. Consultar o registro da imagem temporária e o objeto no Storage depois da expiração; conferir também a resposta HTTP do cron.
4. Assim que houver navegador interativo, entrar primeiro como Pink, abrir a resposta de darkvsm, sair e entrar como jogador para validar a troca de sessão.
5. Com Pink e jogador em sessões distintas, concluir o combate Realtime e revisar a interface em 390 px.
6. Corrigir apenas problemas reproduzidos, repetir os gates e atualizar este documento com evidências finais.
