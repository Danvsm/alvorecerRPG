# Validação do Alvorecer

## Gates automatizados

```bash
npm run typecheck
npm test
npm run build
```

Resultado esperado: TypeScript sem erro, 16 testes aprovados e geração das rotas `/`, `/api/auth`, `/api/admin`, `/convite/[token]` e `/dev`.

## Testes no Supabase real

Os testes usam uma conta de mestre e duas contas de jogador independentes.

```bash
node --env-file=.env.local scripts/verify-live.mjs
node --env-file=.env.local scripts/verify-live-combat.mjs
node --env-file=.env.local scripts/verify-live-remainder.mjs
node --env-file=.env.local scripts/verify-live-storage.mjs
node --env-file=.env.local scripts/verify-live-credentials.mjs
node --env-file=.env.local scripts/verify-live-avatar-dracmas.mjs
```

Eles validam login, criação de jogador, convite de uso único, isolamento RLS, atributos, máximos calculados, multiplicador individual, limite do valor atual, Dracmas em centavos inteiros, transferências atômicas, galeria de avatares, poção, estoque, compra idempotente, criaturas, vida inimiga oculta, dois sentidos do Realtime, Storage privado e credenciais cifradas.

Alguns scripts criam catálogos e salas de teste com nomes identificáveis. Use o painel do mestre para arquivar esses registros após uma rodada de validação.

## Verificação de sessão

1. Abra o mestre no computador e o jogador em uma janela anônima ou outro aparelho.
2. Entre com contas diferentes.
3. Abra a mesma sala de combate.
4. Altere Vida pelo mestre e confirme a atualização do jogador.
5. Gaste Mana pelo jogador e confirme a atualização do mestre.
6. Use um consumível e confira recurso, inventário e Histórico.
7. Oculte a Vida de uma criatura e confirme que o jogador vê somente a cor.
8. Teste em uma largura próxima de 390 px e confirme navegação, cards e formulários sem rolagem horizontal.

## Retomada em produção — 14/09/2026 (parcial)

Base: `cc1c80a205a20127d7ac99a2c6b467442ee9a2b1`, branch `main`.
Domínio: `https://alvorecer-rpg-vsm.vercel.app`.

- Vercel confirmou esse commit em produção, estado `READY`.
- As 23 migrations anteriores constam no Supabase, incluindo as de progressão,
  identidade, mensagens, mídia temporária e ciclo de vida.
- Login no navegador confirmado como Pink/Mestre.
- Notificações, comunidade/ranking, perfil público, coleção/administração de
  cosméticos, Dados e combate renderizaram na conta do mestre. Isso verifica
  abertura/leitura, não todos os comandos de alteração dessas telas.
- Uma mensagem identificada como validação foi enviada por Pink a darkvsm pela
  interface. Uma imagem de teste foi enviada pelo seletor de arquivos e carregou
  no chat (480 px de largura natural); o Storage confirmou a presença do arquivo.
- O recebimento pela conta de jogador e a resposta ainda NÃO foram validados.
  A tentativa de login do jogador retornou "Username ou senha incorretos".
- O cron de limpeza estava ativo a cada 15 minutos, mas os retornos HTTP recentes
  indicavam timeout de 5000 ms. O sucesso do cron sozinho não comprova sucesso HTTP.
- A migration `chat_media_cleanup_timeout` foi aplicada e aumenta apenas o timeout
  HTTP para 60000 ms, preservando intervalo, destino e autenticação pelo Vault.
  A resposta HTTP após esse ajuste ainda precisa ser confirmada.
- A imagem de teste foi criada em 14/09/2026 às 02:13:29 UTC e expira em
  15/09/2026 às 02:13:29 UTC. A conexão SQL recusou a tentativa de antecipar sua
  expiração por ser somente leitura; o registro permaneceu com prazo de 24 horas.
  A tentativa de alterar a frequência do cron também foi recusada; continua em
  15 minutos. Não se confirmou ainda a remoção física da imagem.
- Após o ajuste: `npm test` passou em 16/16, `npm run typecheck` e
  `npm run build` passaram. Nenhum componente de interface foi modificado.

### Próximo passo, sem reiniciar a validação

1. Entrar como jogador por autenticação segura no navegador publicado.
2. Confirmar mensagem/imagem de Pink, responder e verificar recebimento como Pink.
3. Testar marcar notificações, mural, equipar/restaurar cosméticos e comandos de
   Dados/progressão/combate com dados de teste identificáveis.
4. Validar mobile e atualização em tempo real entre contas distintas.
5. Inspecionar retorno HTTP da limpeza (não apenas `cron.job_run_details`);
   após a expiração, conferir `chat_media.deleted_at` e ausência do objeto no Storage.
6. Confirmar o novo deploy associado à migration registrada no Git.
