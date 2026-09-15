# Validação do Alvorecer

## Gates automatizados

```bash
npm run typecheck
npm test
npm run build
```

Resultado esperado: TypeScript sem erro, 28 testes aprovados e geração das rotas `/`, `/api/auth`, `/api/admin`, `/convite/[token]` e `/dev`.

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

## Exclusão de Personagem do Mundo — 15/09/2026, 05:54 UTC

- O arquivo `20260915043804_delete_world_characters.sql` possui o mesmo conteúdo da migration já aplicada no Supabase, confirmado pelo MD5 `acffd1ca56a91483efa42a87dbee8b5d`.
- O teste PostgreSQL local confirmou que jogador não pode chamar `delete_world_character`.
- O mesmo teste confirmou que nem Pink pode usar a função contra identidade ou personagem pertencente a jogador.
- Pink excluiu um Personagem do Mundo de teste e os vínculos de conversa, mensagens, mídia temporária, objeto no Storage, comentário e cosméticos foram removidos.
- A ficha e a identidade social do jogador de teste permaneceram existentes depois da exclusão.
- `npm test`: 24/24 aprovado.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado, com as seis rotas esperadas.
- Não testado: interação visual do diálogo, execução contra o Supabase real e deploy da interface.

## Correção da remoção no Storage — 15/09/2026, 06:25 UTC

- A tentativa publicada falhou antes de qualquer exclusão relacional porque o Supabase bloqueia `delete` direto em `storage.objects`; a transação foi revertida.
- A migration `20260915062327_fix_world_character_storage_deletion` está aplicada no Supabase real.
- As rotinas `prepare_delete_world_character` e `finalize_delete_world_character` têm `EXECUTE` somente para `service_role`; a RPC anterior não existe mais.
- A Edge Function `alvorecer-api` versão 9 está `ACTIVE` e remove os caminhos retornados pela preparação por `storage.from("chat-media").remove(...)`.
- O teste PostgreSQL local cobre Mestre excluindo NPC e seus vínculos, jogador rejeitado e identidade/ficha do jogador preservadas.
- `npm test`: 24/24 aprovado. `npm run build`: aprovado. `npm run typecheck`: aprovado em execução sequencial após o build.
- Não testado: exclusão de um NPC real no Supabase e comportamento visual no site. Esses itens ficam para a validação manual do usuário após o deploy.

## Administração de avatares, 15/09/2026, 15:15 UTC

Validação automatizada concluída:

1. Pink cria avatares pelo RPC administrativo existente.
2. Jogador A seleciona um avatar disponível e o catálogo passa a informar `Em uso` com seu username.
3. Jogador B recebe erro ao selecionar o mesmo avatar pelo fluxo de identidade ou diretamente por `game_action/avatar_select`.
4. Quando A troca de avatar, o anterior volta a `Disponível` e B consegue selecioná-lo.
5. Bloquear um avatar já usado preserva o vínculo atual e impede nova seleção por outro jogador.
6. Exclusividade rejeita outro jogador e aceita o jogador definido.
7. Compartilhamento permite que A e B usem o mesmo avatar.
8. Jogador não executa `admin_avatar_action`, nem cria, bloqueia, compartilha ou desbloqueia por chamada direta.
9. Pink seleciona avatar ocupado ou bloqueado sem liberar essa exceção aos jogadores.
10. Alterar pela ficha mantém `social_identities`, `characters.avatar_id` e `characters.image` sincronizados.

Evidências técnicas:

- `npm test`: 26/26 aprovado.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado, seis rotas geradas.
- Supabase real: migration aplicada, Edge Function versão 13 `ACTIVE`, 15 avatares preservados e nenhuma ocupação múltipla preexistente.
- GitHub/Vercel: commit `0fd02d62d9183d4c8e175136a71c33aa1974721e`, deploy de produção `dpl_ACLqh8LAWN5TQXdBZev3xv43xW7J`, estado `READY`.
- Não testado: interação visual, layout em celular e uso dos controles contra avatares reais. A validação manual será feita pelo usuário no site publicado.

## Molduras de Avatar, 15/09/2026, 16:30 UTC

Validação técnica concluída:

1. Pink cria e edita moldura com arquivo, coleção, raridade, origem, segredo, exclusividade, ordem, escala, posição e efeitos.
2. O upload autenticado gravou um WebP transparente de 221.962 bytes no bucket privado `avatar-frames`.
3. O preview usa o mesmo componente proporcional que renderiza a moldura equipada no Perfil.
4. Jogador sem concessão recebe `Moldura bloqueada` ao chamar o RPC diretamente.
5. Concessão individual e múltipla cria um vínculo ativo por jogador e uma notificação por novo vínculo.
6. Repetir a mesma concessão ativa não duplica propriedade nem notificação.
7. Remover uma concessão equipada apaga o equipamento antes de registrar a remoção; o avatar permanece válido sem moldura.
8. Segredo é aplicado no RPC: antes da concessão o jogador recebe `???`, sem descrição, arte ou efeitos.
9. Operações administrativas diretas por jogador recebem `Somente Pink`.
10. Arquivar ou desativar remove equipamentos daquela moldura; reativar preserva histórico e configuração.
11. Os efeitos são limitados a dois e partículas a doze no componente; `prefers-reduced-motion` desativa animações.
12. O CSS usa uma única medida base e transformações proporcionais para tamanhos diferentes.

Evidências:

- `npm test`: 28/28 aprovado.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado, seis rotas geradas.
- Supabase real: migrations `avatar_frames_administration` e `avatar_frames_audit_indexes` aplicadas.
- Exemplo real: `Guardião Violeta`, coleção `Alvorecer`, raridade Épica, Glow + brilho deslizante, sem concessões a jogadores.
- Não testado: aparência final, encaixe, animações e responsividade em aparelhos reais; fluxo visual completo de concessão/equipamento no domínio publicado. O usuário fará essa validação manual.

## Image Cache — 15/09/2026

- Não existia Service Worker, manifesto PWA ou cache de imagens concorrente; o registro novo é único e global.
- O worker intercepta somente `GET` cujo destino é `image` e exclui explicitamente o bucket temporário `chat-media`.
- Primeiro carregamento: MISS, download e persistência em `alvorecer-images-v1`.
- Segundo carregamento e renovação do token assinado: HIT na mesma versão, sem novo download imediato.
- Cinco componentes concorrentes são atendidos pela mesma promessa de rede por chave canônica.
- Mudança do parâmetro `v` cria uma nova entrada sem limpar as demais imagens.
- Após uma hora, a versão local aparece primeiro e a revalidação ocorre em segundo plano; falha de rede preserva a imagem local.
- Resposta 404/410 na revalidação elimina a imagem e os metadados correspondentes.
- A invalidação por caminho remove somente o arquivo alterado ou excluído.
- O teste com 301 imagens manteve as 300 mais recentes e descartou a mais antiga.
- A ativação apagou caches antigos `alvorecer-images-*` e preservou um cache de outro sistema.
- A aplicação não usa Base64 nem `localStorage` para arquivos de imagem.
- Cabeçalhos locais confirmados: `/image-cache-sw.js` usa `no-cache, no-store, must-revalidate`; assets de combate usam `public, max-age=86400, stale-while-revalidate=604800`.
- O navegador headless disponível não possuía o binário Chromium, portanto o teste visual local real em 390×844 e desktop permanece para o deploy e para a conferência manual.
- Gates: `npm run typecheck` aprovado, `npm test` 43/43 aprovado e `npm run build` aprovado.
- Produção: commit `6b56727ba7b2806418d890105e19c598ee5ad95d`, deploy `dpl_ASbJmsmPArpvQ8dabCb4ePytJBFB` em estado `READY`; worker e asset de combate responderam HTTP 200 com os cabeçalhos configurados e não havia erro de runtime nos 30 minutos consultados.
- A tentativa de complementar a checagem visual pelo navegador conectado foi bloqueada antes de iniciar porque a conta da integração não possui o modo estrito habilitado; nenhum dado do jogador foi alterado.
- Regressão corrigida: o `connect-src` do worker agora contém somente `'self'` e `https://wsihnbrnqdnmidjvjchn.supabase.co`. O cabeçalho local foi conferido e um teste impede remover essa origem específica novamente.
