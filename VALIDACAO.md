# Validação do Alvorecer

## Gates automatizados

```bash
npm run typecheck
npm test
npm run build
```

Resultado esperado: TypeScript sem erro, 21 testes aprovados e geração das rotas `/`, `/api/auth`, `/api/admin`, `/convite/[token]` e `/dev`.

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

## Continuação autenticada — 14/09/2026, 05:49 UTC

O deploy de `b7e12c5` terminou em `READY`. A limpeza respondeu HTTP 200 na
execução das 02:30 UTC, sem timeout. A imagem ainda não venceu: a remoção física
será conferida por tarefa agendada para 14/09 às 23:30 em America/Sao_Paulo.

Verificações feitas diretamente no domínio publicado como **darkvsm**:

- Login e papel de jogador confirmados; menus administrativos não aparecem.
- A mensagem de Pink e sua imagem carregaram; a imagem tem largura natural de
  480 px. A leitura da conversa zerou o contador de mensagens não lidas.
- Resposta de teste enviada para a conversa selecionada **Pink**, aparecendo no
  histórico do chat como darkvsm. A abertura da resposta na conta Pink ainda falta.
- As duas notificações de teste foram marcadas como lidas e o contador zerou.
- Perfil e coleção carregaram; salvar novamente a moldura Lua manteve-a equipada.
- Comunidade, ranking e perfil público de Pink abriram. Uma publicação de teste
  no mural foi salva e exibida com autoria darkvsm.
- Combate mostrou os inimigos ocultos apenas com estado e "Vida exata não revelada".
- Ficha e progressão carregaram; sem XP disponível, os 11 botões de compra de
  atributos estavam desabilitados. Nenhum recurso, XP ou saldo foi gasto.

Correções incrementais decorrentes dessa observação:

- Formatar os valores estruturados do histórico (XP disponível, XP total e nível)
  em vez de mostrar `[object Object]`, com rótulos para os novos eventos.
- Limpar destinatário/identidade do chat ao sair ou mudar de campanha e remontar
  o chat ao trocar conta/identidade para não herdar estado da sessão anterior.

Após as correções, 16/16 testes, TypeScript e build passaram. Ainda é necessário
confirmar o novo deploy e o histórico corrigido, exercitar a troca de conta no
site, validar os demais comandos administrativos e a atualização simultânea entre
contas. Mobile não foi validado: a API deste navegador não expõe redimensionamento
e a tentativa de zoom não mudou a largura da página.

## Redesign do Combate — 14/09/2026, 22:45 UTC

Commit publicado: `28c42266fec6fb788501f517d1087907c07eae5b`.
Deploy: `dpl_BusR9Upd4Wuq27mjJosFFQjeaunD`, produção, estado `READY`.

- `npm run typecheck`: aprovado.
- `npm test`: 19/19 aprovados, incluindo seleção segura do comando de Vida para Mestre/jogador e rejeição de zero/fracionários.
- `npm run build`: aprovado; seis rotas geradas.
- Como darkvsm no domínio publicado: cabeçalho, Aliados, Inimigos, cards compactos, ausência de Neutros, ocultação de Vida e restrição dos controles renderizaram corretamente.
- O modal exibiu campo numérico livre e apenas `Perdeu Vida` para o jogador. A perda de 1 ponto foi confirmada no banco: 15/80 → 14/80, evento `delta -1`, motivo `Combate`.
- O jogador não recebeu `Ganhou Vida` nem engrenagem. O teste automatizado do RPC existente continua rejeitando delta positivo de jogador, além da proteção na seleção de comando do frontend.
- Nenhum consumível, XP, Dracmas, inventário, sala, participante ou `reveal` foi alterado nesse teste.
- Não houve erro de runtime na Vercel nos 30 minutos posteriores ao deploy.

Ainda pendente:

1. Repetir visualmente em viewport efetiva próxima de 390×844. A automação desta rodada usou 1080×1920; nela não houve overflow horizontal (`scrollWidth <= clientWidth`), mas mobile permanece inválido.
2. Entrar como Pink/Mestre e confirmar a engrenagem, quantidade livre, `Perdeu Vida` e `Ganhou Vida` em qualquer participante. A solicitação segura de credenciais foi recusada nesta rodada.
3. Executar Realtime em duas sessões simultâneas para o novo controle de Vida.
4. Exercitar visualmente os cenários de 2 aliados, 4 aliados e vários inimigos; a prévia local já contém 4 + 4 participantes, mas não houve navegador local disponível para a inspeção.

## Avatar do personagem pelo Mestre — 15/09/2026, 03:30 UTC

- Em Personagens, selecionar `darkvsm` e confirmar outro avatar alterou somente o personagem selecionado.
- O avatar de `darkvsm` mudou de `Novinha` para `Ladino`; a identidade Pink permaneceu com `Monge`.
- O banco registrou a ação `avatar_select` com o `character_id` de `darkvsm` às 03:29:20 UTC.
- O fluxo de Perfil continua separado e direcionado a `identity_action/avatar`; o fluxo de Personagens usa `game_action/avatar_select`.
- `npm run typecheck`, 21/21 testes e `npm run build` passaram antes do deploy final.
