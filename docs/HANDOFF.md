# Handoff — Alvorecer RPG

Atualizado em 18/09/2026, 00:18 UTC.

Este documento consolida o estado real anteriormente registrado em `VALIDACAO.md` e as verificações de infraestrutura feitas antes desta continuação. Ele não declara a validação final concluída.

## Infraestrutura atual

- GitHub: `Danvsm/alvorecerRPG`.
- Vercel: projeto `alvorecer-rpg-vsm`, ID `prj_QaxFObeWPJ8w0urfdzYICRDwIlHs`, equipe `team_CnaWIE2ArNb8Rmus0NWgv4Hr`.
- Produção: `https://alvorecer-rpg-vsm.vercel.app`.
- Supabase: projeto `alvorecer`, Project Ref `wsihnbrnqdnmidjvjchn`, região `sa-east-1`, estado `ACTIVE_HEALTHY`.
- Edge Function principal: `alvorecer-api`, ativa, versão 15, `verify_jwt=false`.
- Não criar outro projeto Vercel, Supabase ou banco para esta continuação.

## Código e deploy

- Branch: `main`.
- Commit-base confirmado antes desta conclusão: `c574419f2cb8cf8df365fdd54a01d31660ab9e35`.
- Versão do pacote: `1.3.0`.
- Deploy Vercel do commit-base: `dpl_58hHEnqmhuZDhG6RZT4edqXYYW8i`.
- Estado confirmado: `READY`, alvo `production`, origem GitHub `Danvsm/alvorecerRPG`, ref `main`.
- Commits de documentação criados nesta continuação: `9ccc68a09b1e2a4b96af8dc0f45b246ad3c94c16` (`docs/HANDOFF.md`) e `276f6690ccd04bba53a3994a50daeaac4892a8a5` (`CHANGELOG.md`).
- O commit `276f6690ccd04bba53a3994a50daeaac4892a8a5` chegou a `READY` em produção no deploy `dpl_7PQZSrt1rhFSmkuTrCvSGmJ8AjxC`.
- O handoff com as evidências atuais foi publicado no commit `7fffe8a703046003cb3d3143a7e4d3696e23b232` e chegou a `READY` no deploy `dpl_4xiimSLR5ccrJFw4gTAjxGwjvH4y`.
- A administração de avatares foi publicada no commit `0fd02d62d9183d4c8e175136a71c33aa1974721e` e chegou a `READY` no deploy `dpl_ACLqh8LAWN5TQXdBZev3xv43xW7J`.

## Banco, migrations e função

- As 41 migrations registradas estão aplicadas no Supabase real.
- A última migration aplicada é `20260918001929_restrict_stories_to_user_identities`.
- A migration `delete_world_characters`, que já estava aplicada no Supabase, foi recuperada para o Git sem alterar seu SQL. O conteúdo local e o registro remoto possuem o mesmo MD5: `acffd1ca56a91483efa42a87dbee8b5d`.
- A migration `orkutista_stories` mantém o cron autenticado `alvorecer-chat-media-cleanup` a cada minuto e preserva o timeout de `pg_net` em 60 segundos para limpar chat e Stories.
- A chamada de limpeza usa o endpoint `/functions/v1/alvorecer-api/media-cleanup` e autenticação guardada no Vault.
- A Edge Function `alvorecer-api` está ativa na versão 15.
- A migration corretiva remove a RPC antiga e divide a operação em preparação e finalização, ambas acessíveis somente por `service_role`. A remoção física ocorre entre essas etapas pela API oficial do Storage.

## Entregas concluídas

- Aplicação Next.js real com Supabase Auth, RLS, Realtime, Storage privado, Vault e proxy seguro para a Edge Function.
- Stories do Orkutista com imagem otimizada, sequência por autor, visto/não visto, visualizador em tela cheia, expiração em 24 horas e exclusão pelo autor ou Mestre.
- Login por username, mestre inicial, criação de jogador e convite de uso único.
- Ficha, recursos calculados, atributos dinâmicos, vantagens, inventário, consumíveis, lojas e Dracmas em centavos.
- Galeria privada de avatares, perfis, cosméticos, notificações, comunidade, mural e chat direto com imagem temporária.
- Administração de XP, Dracmas, vantagens, inventário e dados do jogador.
- Criaturas reutilizáveis, NPCs, minions, salas e participantes de combate, com ocultação de valores numéricos.
- Histórico e auditoria dos comandos sensíveis.
- Timeout da limpeza de mídia temporária corrigido; uma execução posterior respondeu HTTP 200.
- No commit `42292c7`, valores estruturados do histórico passaram a ser formatados em vez de exibirem `[object Object]`.
- No commit `42292c7`, destinatário/identidade do chat são limpos ao sair ou trocar campanha, e o chat é remontado ao trocar conta/identidade.
- No commit `28c4226`, a página Combate foi reorganizada em cards compactos, grade mobile de duas colunas, seções Aliados/Inimigos e controles administrativos centralizados na engrenagem.
- O fluxo atual não oferece mais Neutros nem renderiza a seção, preservando os registros antigos no banco sem migration destrutiva.
- O ajuste de Vida passou a aceitar quantidade inteira livre; o Mestre recebe perda/ganho e o jogador recebe somente perda no próprio personagem. Os comandos e as validações server-side existentes foram preservados.
- Os assets fornecidos para espadas, estandartes, coroa, brasão e wallpaper foram otimizados para WebP e usados diretamente na interface.
- A troca de avatar no painel Personagens agora mantém destinos separados: o Mestre altera somente o personagem selecionado, enquanto Perfil continua alterando somente a identidade própria.
- Pink/Mestre pode solicitar no perfil público da Comunidade a exclusão definitiva de um Personagem do Mundo, com confirmação simples por `Cancelar` ou `Excluir`.
- O endpoint administrativo rejeita jogadores, e as duas rotinas do banco repetem a validação do Mestre e da identidade-alvo. Ao excluir um Personagem do Mundo, remove conversas, mensagens, mídia temporária, comentários e cosméticos vinculados sem atingir personagens de jogadores.

## Testes já concluídos

### Automatizados

- `npm test`: 71/71 testes aprovados no estado atual.
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

- Validar manualmente no celular o novo feed do Orkutista: criação com foto e legenda, curtir/descurtir, comentários, curtidas em comentários e respostas de um nível.

- A entrega e leitura do chat nos dois sentidos estão confirmadas no banco: darkvsm leu as mensagens de Pink e Pink leu a resposta de darkvsm. Ainda falta confirmar visualmente a apresentação da resposta na interface.
- Exercitar novamente a troca de conta no site publicado e confirmar visualmente que conversa, destinatário e identidade não vazam entre sessões.
- Confirmar na interface publicada a formatação corrigida do histórico.
- Concluir um teste interativo de combate entre Pink e jogador, incluindo atualização simultânea mestre → jogador e jogador → mestre.
- Validar os comandos administrativos restantes com dados de teste identificáveis, sem afetar dados reais.
- Revisar layout mobile em largura próxima de 390 px: navegação, cards, formulários, chat e combate sem rolagem horizontal.
- Validar a nova engrenagem e o ajuste de Vida como Pink/Mestre no site publicado. A solicitação segura de credenciais não foi concluída nesta rodada.
- Validar manualmente a confirmação e a remoção do Personagem do Mundo na interface publicada, incluindo a remoção física das mídias pela Storage API.
- Validar manualmente a galeria administrativa de avatares, filtros, ações recolhíveis, troca de avatar e responsividade em celulares de tamanhos diferentes.
- Confirmar que os commits de documentação/correção desta continuação também chegam a `READY` no projeto Vercel correto.

## Bugs conhecidos

- A primeira implementação da exclusão de Personagem do Mundo tentava apagar `storage.objects` diretamente por SQL e falhava com `Direct deletion from storage tables is not allowed`. A correção já está aplicada no Supabase e na Edge Function, mas ainda aguarda publicação do frontend e validação manual.
- Corrigidos em `42292c7`: histórico exibindo `[object Object]` e estado do chat herdado ao trocar sessão/campanha.
- Corrigido em `2422568`: Alterar avatar em Personagens chamava o fluxo da identidade do Mestre e, na primeira correção, o RPC incorreto. O fluxo publicado agora usa `game_action/avatar_select` com o `character_id` selecionado.
- Riscos ainda não encerrados: regressão visual mobile, troca de conta e sincronização interativa entre duas sessões.
- Limitação operacional desta continuação: o ambiente atual não expõe navegador interativo. A integração TinyFish foi localizada e sugerida, mas ainda não está instalada/conectada. Qualquer item não comprovável por API, banco ou inspeção de código permanece explicitamente como não testado.
- Há uma sala antiga de teste `Verificação ...` ainda ativa, além da sala vazia `combate`; são artefatos identificáveis de validações anteriores e devem ser encerrados/arquivados pela interface após o teste interativo, não tratados como bug do produto.

## Próximo passo exato

1. Publicar o commit desta conclusão e confirmar o deploy `READY` no projeto Vercel correto.
2. Validar manualmente como Pink a confirmação e a remoção de um Personagem do Mundo descartável. Confirmar também que o jogador não recebe o controle.
3. No domínio publicado, entrar primeiro como Pink, conferir visualmente a resposta de darkvsm e o histórico formatado; sair e entrar como darkvsm para validar a troca de sessão sem herança de chat.
4. Com Pink e jogador em sessões distintas, alterar um recurso pelo mestre, gastar um recurso pelo jogador e observar a atualização Realtime nas duas telas; depois encerrar/arquivar as salas de teste remanescentes.
5. Repetir os mesmos fluxos em viewport de 390 px e confirmar ausência de rolagem horizontal em navegação, cards, formulários, chat e combate.
6. Corrigir somente problemas reproduzidos, repetir os gates quando houver alteração de código e atualizar este documento com evidências finais.

## Molduras de Avatar e efeitos, 15/09/2026, 16:30 UTC

- O sistema existente de cosméticos foi ampliado para molduras com arte privada, raridade, coleção dinâmica, origem informativa, visibilidade, segredo, ativação, arquivamento, ordem, exclusividade, escala, posição X/Y e até dois efeitos leves configuráveis.
- O componente reutilizável `AvatarFrame` combina avatar, moldura e efeitos em tamanhos proporcionais. O Perfil passou a usá-lo; a Comunidade não foi redesenhada nesta rodada.
- Pink administra a galeria pelo Perfil: upload PNG/WebP convertido para WebP transparente, preview antes de salvar, edição, duplicação, teste local em Pink, filtros, criação de coleção, concessão individual ou múltipla, consulta de donos/usuários, remoção, arquivamento, reativação e exclusão segura quando não existe histórico.
- Jogadores veem e equipam somente molduras concedidas. Molduras visíveis sem concessão aparecem bloqueadas; molduras secretas retornam do backend com nome `???`, sem descrição, arte ou efeitos até a concessão.
- O backend valida todas as operações administrativas, exclusividade e raridade Mestre. Remover uma concessão ou arquivar/desativar uma moldura equipada remove primeiro o equipamento e mantém o avatar normal.
- Concessões registram data e Mestre responsável; remoções registram data e responsável. A chave existente impede propriedade duplicada. Uma notificação é criada apenas em nova concessão ou reconcessão posterior a uma remoção.
- O bucket privado `avatar-frames` aceita PNG/WebP de até 1 MB. Upload e exclusão exigem Mestre ativo; leitura respeita campanha, visibilidade, segredo e propriedade.
- A arte enviada pelo usuário foi otimizada para WebP transparente de 221.962 bytes e cadastrada pelo fluxo autenticado do Pink como `Guardião Violeta`, raridade Épica, coleção `Alvorecer`, com Glow e brilho deslizante. Ela não foi concedida a nenhum jogador.
- `npm test` passou em 28/28, `npm run typecheck` passou e `npm run build` gerou as seis rotas esperadas.
- Não foram feitos teste visual detalhado, revisão manual em celular, concessão real a jogador nem validação visual dos efeitos no domínio publicado. Esses itens permanecem para o usuário.
- Próximo passo recomendado: o usuário validar no celular o editor, o encaixe da arte, os efeitos, a coleção, concessão/equipamento e o topo do Perfil, enviando screenshots apenas dos ajustes necessários.

## Concorrência na exclusão de Personagem do Mundo — 15/09/2026, 17:00 UTC

- A finalização agora trava a identidade e as conversas do NPC antes de conferir as mídias vinculadas.
- O banco compara os caminhos atuais com os arquivos que a Edge Function realmente removeu. Se surgir mídia nova durante a operação, o NPC não é apagado nessa tentativa.
- A Edge Function versão 14 repete preparação, remoção pelo Storage e finalização até três vezes antes de retornar um erro recuperável.
- A RPC de finalização continua restrita a `service_role`; `authenticated` não possui permissão de execução.
- O teste PostgreSQL simula uma mídia criada entre preparação e finalização, confirma que a primeira finalização preserva o NPC e que a segunda remove tudo após limpar o novo arquivo.
- `npm test`: 28/28; `npm run typecheck`: aprovado; `npm run build`: aprovado.

## Continuação verificada — 14/09/2026, 17:15 UTC

- O domínio de produção respondeu HTTP 200 com o cabeçalho de viewport mobile e os cabeçalhos de segurança esperados.
- Os commits documentais `276f6690ccd04bba53a3994a50daeaac4892a8a5` e `7fffe8a703046003cb3d3143a7e4d3696e23b232` chegaram a `READY` no projeto Vercel correto.
- A Vercel não registrou erros de runtime nas últimas 24 horas.
- Pink e darkvsm possuem login recente em produção. O banco confirma que ambos leram todas as mensagens recebidas na conversa entre eles; Pink marcou como lida, às 06:13 UTC, a resposta enviada por darkvsm às 05:45 UTC.
- Depois do deploy de `42292c7`, o histórico registra ações reais pela interface: darkvsm gastou Vida, Mana e Fôlego; Pink removeu participantes de combate e executou transferências. Não houve erro de banco nessas ações.
- A sincronização visual simultânea entre duas telas continua não comprovada neste ambiente.
- Revisão mobile estática concluída: CSS publicado contém breakpoints em 760 px e 380 px, grids responsivos, formulários empilhados, diálogo limitado ao viewport, combate em uma coluna e chat com largura `min(390px, calc(100vw - 24px))`. Nenhum defeito foi encontrado por inspeção; o teste visual em 390 px continua pendente.
- Às 17:06 UTC, a imagem-alvo ainda estava dentro do prazo, com `deleted_at` nulo e objeto presente, como esperado. A expiração é 15/09/2026 às 02:13:29 UTC.
- As 20 respostas do cron observadas entre 12:15 e 17:00 UTC foram HTTP 200, sem timeout nem erro, com `removed: 0` e `pending: 0`, coerente com não haver mídia vencida naquele intervalo.
- Uma verificação condicional horária foi criada para confirmar a remoção lógica e física da imagem-alvo depois da expiração.
- Nenhum novo bug de código foi reproduzido; portanto, não foi feita correção especulativa.

## Redesign do Combate — 14/09/2026, 22:45 UTC

- O commit `28c42266fec6fb788501f517d1087907c07eae5b` foi publicado em `main` e chegou a `READY` no deploy de produção `dpl_BusR9Upd4Wuq27mjJosFFQjeaunD`.
- `npm run typecheck`, 19/19 testes e `npm run build` passaram antes da publicação. O build gerou as seis rotas esperadas, incluindo `/dev`.
- O teste publicado autenticado como darkvsm confirmou: cabeçalho novo, ausência de Neutros, seções Aliados/Inimigos, cards compactos, Vida inimiga oculta, ausência de engrenagem para jogador e `Ajustar Vida` apenas no próprio personagem.
- O modal do jogador mostrou campo numérico livre e somente `Perdeu Vida`. A perda mínima autorizada foi persistida de 15/80 para 14/80; o evento de auditoria registrou `delta: -1` e motivo `Combate`.
- O aumento manual não aparece ao jogador. Os testes automatizados também comprovam que a camada de comando bloqueia esse pedido e que o RPC `resource` rejeita delta positivo para jogador.
- A viewport efetiva da automação publicada foi 1080×1920. Nela, `scrollWidth` ficou abaixo de `clientWidth` e não houve overflow; isso não substitui o teste solicitado em aproximadamente 390×844, que continua pendente.
- A prévia de desenvolvimento contém quatro aliados e quatro inimigos para exercitar a grade, mas a validação visual dessa prévia não foi concluída porque o ambiente local não disponibilizou um binário Chromium.
- O teste autenticado Pink/Mestre continua pendente: o formulário seguro de credenciais foi recusado nesta rodada. Não declarar ganho/perda do Mestre nem engrenagem como validados em produção até repetir com essa conta.
- A Vercel não registrou erros de runtime nos 30 minutos após o deploy e o teste autenticado.

## Correção da foto do personagem — 15/09/2026, 03:30 UTC

- O commit `f28527b6b2d6d321469efb4b1539d905f7ad03a5` separou o destino do seletor de avatar entre Perfil e Personagens.
- A tentativa manual seguinte revelou que `avatar_select` pertence a `game_action`, não a `game_command`; o ajuste final foi publicado no commit `24225683790311962bb114bf65da4f0a772a9aaf`.
- `npm run typecheck`, 21/21 testes e `npm run build` passaram. O teste de banco incluído comprova que o Mestre pode selecionar o avatar de um personagem específico sem alterar outro personagem.
- O deploy de produção `dpl_Cc3gxD8hc7VpE2Rj3uwWysNwX8XL` chegou a `READY` no projeto correto.
- Validação manual confirmada pelo usuário: `darkvsm` mudou do avatar `Novinha` para `Ladino`, enquanto a identidade Pink permaneceu com `Monge`.
- O banco registrou `avatar_select` para `darkvsm` às 03:29:20 UTC e manteve o `avatar_id` da identidade Pink inalterado. Nenhuma migration foi necessária.

## Exclusão de Personagem do Mundo — 15/09/2026, 05:54 UTC

- A migration `20260915043804_delete_world_characters` foi recuperada exatamente do histórico do Supabase para o Git. Nenhuma alteração de banco foi executada nesta conclusão.
- A ação foi adicionada ao perfil público de Personagens do Mundo na Comunidade e é oferecida somente a Pink/Mestre.
- A confirmação possui apenas `Cancelar` e `Excluir`, sem texto obrigatório.
- O teste local comprovou que jogador recebe `Somente Pink`, que uma identidade de jogador recebe `Personagem do mundo inválido` e que a exclusão do NPC remove seus vínculos preservando a ficha e a identidade do jogador.
- `npm test` passou em 24/24, `npm run typecheck` passou e `npm run build` gerou as seis rotas esperadas.
- Não foram executados teste visual, teste no Supabase real ou deploy da interface. A migration já estava aplicada no Supabase antes desta conclusão.

## Correção da exclusão de Personagem do Mundo — 15/09/2026, 06:25 UTC

- A falha observada em produção foi confirmada: a RPC tentava excluir diretamente de `storage.objects`, operação proibida pelo Supabase Storage.
- A migration `fix_world_character_storage_deletion` foi aplicada no Supabase real como versão `20260915062327`. Ela remove a RPC antiga e cria etapas de preparação e finalização restritas a `service_role`.
- A Edge Function `alvorecer-api` versão 9 está `ACTIVE` e usa a Storage API no bucket `chat-media` antes de finalizar a exclusão relacional.
- A autorização permanece em duas camadas: o endpoint exige Mestre ativo e o banco valida novamente o ator e rejeita qualquer identidade que não seja NPC sem usuário.
- O advisor de segurança não lista mais `delete_world_character` como função executável por usuários autenticados. Os avisos restantes são anteriores e não foram alterados nesta correção focada.
- `npm test` passou em 24/24, `npm run build` passou e `npm run typecheck` passou quando executado após o build. A primeira execução paralela do typecheck colidiu com a regeneração de `.next`; a repetição sequencial foi aprovada.
- Não foi excluído nenhum Personagem do Mundo real nesta rodada e não houve teste visual. A validação manual no site publicado permanece com o usuário.

## Administração e uso único de avatares, 15/09/2026, 15:15 UTC

- A regra normal passou a ser um avatar por jogador. A exceção `Compartilhável` permite múltiplos jogadores e é controlada somente por Pink/Mestre.
- A migration `avatar_usage_administration` está aplicada no Supabase real. Ela adiciona bloqueio, compartilhamento e exclusividade, calcula o estado a partir dos vínculos reais e protege tanto `characters` quanto `social_identities` por triggers.
- A seleção trava a linha do avatar antes de verificar a ocupação. Assim, duas seleções concorrentes de um avatar de uso único não podem ser confirmadas para jogadores diferentes.
- Pink pode bloquear, desbloquear, compartilhar, restaurar uso único, definir ou remover exclusividade, arquivar, reativar, renomear e excluir pelo fluxo seguro já existente. O painel mostra miniatura, nome, estado, busca, filtro e usuários atuais por nome e username.
- Bloquear um avatar em uso não remove o vínculo atual. Arquivados deixam de aceitar novas seleções até serem reativados. Pink ignora bloqueio, exclusividade e ocupação, mas também precisa reativar um avatar arquivado.
- Jogadores continuam sem upload e sem ações administrativas. `admin_avatar_action` aceita somente `service_role`, valida novamente o Mestre informado e a Edge Function também exige sessão de Mestre ativa.
- A Edge Function `alvorecer-api` versão 13 está `ACTIVE` com o novo endpoint administrativo. O schema real confirmou as três colunas, as duas RPCs e os 15 avatares existentes; não havia avatar previamente usado por múltiplos jogadores.
- O teste PostgreSQL cobre criação por Pink, seleção por dois jogadores, liberação após troca, bloqueio sem remoção do vínculo, exclusividade, compartilhamento, tentativa direta de contorno, exceção de Pink e sincronização entre identidade, ficha e personagem.
- `npm test` passou em 26/26, `npm run typecheck` passou e `npm run build` gerou as seis rotas esperadas.
- Não foram feitos testes visuais extensos nem alterações em contas ou avatares reais. A aparência, o fluxo publicado e a responsividade permanecem para validação manual do usuário.
- O commit funcional publicado é `0fd02d62d9183d4c8e175136a71c33aa1974721e`. O deploy de produção correspondente é `dpl_ACLqh8LAWN5TQXdBZev3xv43xW7J`, estado `READY`, com o domínio principal associado sem erro de alias.

## Image Cache — 15/09/2026, validação local

- Foi integrado um único Service Worker em `/image-cache-sw.js`; antes desta alteração o projeto não possuía Service Worker/PWA/cache semelhante.
- O cache `alvorecer-images-v1` usa Stale While Revalidate, serve HIT imediatamente, revalida versões antigas em segundo plano e mantém a cópia local em falhas de rede.
- Requisições simultâneas da mesma URL/versionamento compartilham um único download. URLs assinadas do Supabase são canonizadas localmente sem o token, mas somente quando possuem o parâmetro de versão `v`.
- Avatares, molduras e itens recebem `v` baseado em `updated_at`, `created_at` ou caminho imutável. Novos uploads usam nomes UUID e `cacheControl: 31536000`.
- `chat-media` não é interceptado, preservando a expiração e a privacidade das imagens temporárias.
- Há metadados de acesso no próprio Cache Storage, limite aproximado de 300 imagens e remoção das menos recentes. Nenhum arquivo vai para banco, Base64 ou `localStorage`.
- Ao ativar uma nova versão, somente caches cujo nome começa com `alvorecer-images-` são limpos; caches de outros sistemas permanecem intactos.
- A exclusão de avatar/moldura invalida apenas o caminho correspondente no dispositivo atual. O logout também zera as URLs visuais mantidas em memória.
- Logs HIT/MISS/UPDATED/EVICTED são ativados apenas pelo registro de desenvolvimento.
- Validações: 10/10 testes específicos do worker, 43/43 na suíte completa, TypeScript e build aprovados.
- O servidor de produção local confirmou os cabeçalhos do worker e dos assets. O pacote Playwright estava presente, mas sem binário Chromium; a checagem visual real em mobile/desktop ficou pendente para o domínio publicado e para o usuário.
- Publicação concluída no commit `6b56727ba7b2806418d890105e19c598ee5ad95d`; deploy `dpl_ASbJmsmPArpvQ8dabCb4ePytJBFB` chegou a `READY`. O domínio principal respondeu HTTP 200 para o worker e para o asset de combate, e a consulta da Vercel não encontrou erros de runtime.
- A automação autenticada adicional não chegou a abrir uma sessão: a integração recusou o modo estrito por falta de habilitação da conta. Portanto, ela não alterou dados e não substitui o teste manual abaixo.
- O hotfix da CSP foi publicado no commit `5b9fae90540afc0f9d6eac23a2d15b9fe43bbc1a`; o deploy de produção `dpl_4gX3AVWd4smivqbqtusfqJaZbvxG` chegou a `READY`. A política agora permite somente `'self'` e o host específico `wsihnbrnqdnmidjvjchn.supabase.co` nas conexões do worker.

## Correção do carregamento de fotos e molduras, 15/09/2026, 23:05 UTC

- A causa imediata de todas as imagens desaparecerem foi a CSP inicial do novo Service Worker: `default-src 'self'` bloqueava as conexões aos buckets privados do Supabase. O commit `5b9fae9` adicionou o host específico do projeto em `connect-src`.
- A inspeção também encontrou um defeito independente de duração: as URLs assinadas expiravam em uma hora e não eram renovadas enquanto a página permanecia aberta.
- O carregamento agora agrupa os arquivos por bucket e usa uma requisição em lote para `portraits` e outra para `avatar-frames`, evitando várias assinaturas simultâneas.
- As URLs são renovadas a cada 45 minutos, na renovação da sessão, ao recuperar foco, ao voltar do segundo plano e ao reconectar à internet. Falhas recebem nova tentativa após 15 segundos.
- O parâmetro estável de versão `v` foi preservado. Assim, a renovação do token continua apontando para a mesma entrada do Image Cache, e uma alteração real do arquivo cria outra versão.
- Uma imagem assinada que falhar é retirada da interface e provoca uma recuperação controlada, sem promessa rejeitada não tratada.
- Os buckets continuam privados. Nenhuma tabela, policy, RLS, migration ou arquivo do Storage foi alterado.
- O Supabase real possui 15 registros em `campaign_avatars` e 15 objetos correspondentes no bucket `portraits`; nenhum arquivo de avatar está ausente e todos os objetos consultados usam `image/webp`.
- A integração final com o Image Cache passou em 46/46 testes, `npm run typecheck` e `npm run build`.
- Não foi feita validação visual no celular nem foi mantida uma sessão aberta por mais de uma hora no domínio publicado. O usuário fará a confirmação visual após o deploy.

## Recuperação do Service Worker já instalado, 15/09/2026, 23:42 UTC

- O print enviado pelo usuário após o hotfix mostrou todos os avatares presos em `Carregando` no Chrome Android.
- A reprodução autenticada como Pink em uma sessão nova carregou os 15 avatares e a moldura diretamente dos buckets privados, com dimensões naturais válidas e nenhum placeholder. Isso confirmou que registros, arquivos, RLS, assinatura em lote e CSP atual estavam corretos para instalações novas.
- A causa residual era o ciclo de atualização do Service Worker. O hotfix anterior mudou apenas o cabeçalho CSP de `/image-cache-sw.js`; como o corpo do script permaneceu idêntico, navegadores que já possuíam a versão antiga não instalaram outro worker e conservaram a CSP que bloqueava o Supabase.
- O worker agora usa revisão explícita `2`, é registrado como `/image-cache-sw.js?v=2` e grava nos caches `alvorecer-images-v2` e `alvorecer-images-meta-v2`. A alteração do URL e do corpo força a instalação, enquanto a ativação remove os caches v1 e preserva caches de outros sistemas.
- A galeria escuta `controllerchange` e solicita novamente as URLs assinadas assim que o novo worker assume o cliente. Isso recupera fotos de perfil, avatares e molduras sem depender de uma limpeza manual do navegador.
- O `cacheNonce` aleatório foi removido das assinaturas. A chave local volta a depender somente do caminho e da versão real do arquivo, evitando uma nova entrada a cada renovação do token.
- `npm test` passou em 47/47, incluindo a revisão do worker e a remoção dos caches v1. `npm run typecheck` e `npm run build` passaram; as seis rotas esperadas foram geradas.
- Nenhuma tabela, policy, RLS, migration ou arquivo do Storage foi alterado. A confirmação final no Chrome Android do usuário permanece pendente para o deploy desta correção.

### Próximo passo do Image Cache

1. Abrir o site uma vez, recarregar e conferir `alvorecer-images-v2` em DevTools > Application > Cache Storage.
2. Trocar um avatar e confirmar que a nova imagem aparece sem limpar o cache inteiro.
3. Repetir em aproximadamente 390×844 e desktop; alternar entre duas contas e confirmar que não há imagem incorreta herdada.

## Exibição global de avatar e moldura, 16/09/2026, 04:15 UTC

- `IdentityAvatar` passou a ser o componente central para identidades reais. Ele resolve o avatar, consulta `cosmetic_equipment` e entrega ao `AvatarFrame` a moldura e os efeitos efetivamente equipados.
- `IdentityBadge` usa o componente central, e as renderizações que ainda exibiam imagem pura foram migradas: menu lateral, cabeçalho de personagem, ficha, carteira, mensagens e autores do mural.
- Comunidade, Combate, listas de jogadores e Perfil já usavam `IdentityBadge`. O ranking agora também usa o badge completo, mantendo avatar, moldura, efeitos, título e medalha a partir dos vínculos reais.
- A galeria de escolha continua mostrando somente a arte do avatar, pois representa o item selecionável e não uma identidade equipada. Imagens de itens, logotipo e mídia de chat também permanecem fora desta regra.
- A migration local `20260916040618_expose_equipped_avatar_frames.sql` foi aplicada no Supabase como `20260916041057_expose_equipped_avatar_frames`.
- O `frame_catalog` libera arte e efeitos de uma moldura secreta para outros membros somente quando ela está realmente equipada por uma identidade ativa. O nome continua `???`, a descrição continua oculta e nenhuma concessão ou permissão administrativa é ampliada.
- A leitura do arquivo no bucket privado usa uma função auxiliar em `alvorecer_private`, fora da API exposta, e repete a exigência de campanha, moldura ativa e equipamento real.
- O Supabase real confirmou a nova função, a policy do Storage e um vínculo de moldura equipada. Os advisors não apontaram alerta novo causado por esta migration; os avisos apresentados já existiam e permanecem fora desta entrega focada.
- `npm test`: 49/49 aprovado. `npm run typecheck`: aprovado. `npm run build`: aprovado, com as seis rotas esperadas.
- Não foi feita revisão visual extensa nem validação manual em celular. O usuário continuará responsável pelo ajuste fino de aparência, encaixe e responsividade após a publicação.

### Próximo passo recomendado

1. Validar manualmente no celular um jogador com moldura equipada no menu, Perfil, Ficha, Comunidade, Ranking, Mensagens e Combate.
2. Confirmar um jogador sem moldura nos mesmos pontos, verificando que apenas o avatar normal aparece.
3. Enviar prints somente dos tamanhos ou alinhamentos que precisarem de ajuste visual.

## UX do Combate com ajuste de recursos, 16/09/2026, 04:47 UTC

- O card inteiro do participante passou a abrir uma aba inferior animada. O botão separado `Ajustar Vida` foi removido.
- A aba permite selecionar Vida, Mana ou Fôlego por ícone, definir a quantidade com campo numérico e controles de menos/mais, aplicar perda e, para Pink/Mestre, aplicar recuperação.
- Pink/Mestre pode abrir a aba de qualquer aliado ou inimigo cujos dados estejam disponíveis. O jogador recebe a interação somente no próprio personagem e não recebe o botão de recuperação.
- O frontend usa um único helper para rotear os três recursos. Pink continua chamando `combat_update`; jogador continua chamando `resource` com o próprio `character_id`.
- A RPC existente já valida no backend o Mestre, a propriedade do personagem, os recursos aceitos e o bloqueio de delta positivo para jogador. Nenhuma migration, policy ou RLS foi alterada.
- Ao entrar no Combate, o menu lateral fica recolhido em desktop e celular. Uma seta no cabeçalho abre o mesmo menu como sobreposição; sair para outra página restaura a navegação normal.
- O wallpaper do cabeçalho ficou sem borda ou moldura, com transição inferior e uma linha discreta. Sala e títulos das equipes perderam superfícies de card; os cards visuais permanecem concentrados nos participantes.
- `npm test`: 49/49 aprovado. `npm run typecheck`: aprovado. `npm run build`: aprovado, com seis rotas geradas.
- Não foram feitos teste visual, teste mecânico no navegador ou validação manual em celular, por orientação do usuário.

### Próximo passo recomendado para Combate

1. O usuário deve validar no celular o tamanho dos cards, o encaixe do wallpaper, a abertura do menu e a animação da aba inferior.
2. Testar como Pink perda e recuperação de Vida, Mana e Fôlego em aliado e inimigo.
3. Testar como jogador somente a perda dos três recursos no próprio personagem e enviar prints dos ajustes visuais necessários.

## Cabeçalhos de equipes e menu de ações do Combate, 16/09/2026, 05:02 UTC

- As três ações que ocupavam o lado direito do wallpaper foram consolidadas em um único botão de três pontos no próprio lado direito.
- A seta do lado esquerdo continua dedicada a abrir o menu principal do site.
- O menu de três pontos reúne Participantes, Histórico e Configurações. Configurações continua disponível somente para Pink/Mestre.
- As frases `Juntos somos mais fortes.` e `Eles não mostrarão piedade.` voltaram a aparecer também no layout mobile.
- Os títulos de Aliados e Inimigos receberam uma faixa curta com reutilização muito sutil do wallpaper, linha superior quase transparente e tons azul ou vermelho de baixa opacidade.
- Nenhuma mecânica, permissão, RPC, migration ou card de participante foi alterado.
- Não foi feita validação visual no navegador. O usuário fará a conferência pelo celular após o deploy.

## Dano do jogador contra inimigos, 16/09/2026, 15:57 UTC

- No painel do jogador, o card de um inimigo ativo abre uma aba inferior para informar uma quantidade inteira de dano e aplicar a ação com uma única confirmação.
- Depois da confirmação aceita pelo backend, a aba fecha e o card atingido recebe um tremor curto com destaque vermelho. O efeito respeita `prefers-reduced-motion`.
- Aliados não recebem a ação de dano. O ajuste dos próprios recursos do jogador e os controles completos de Pink/Mestre permanecem nos fluxos anteriores.
- A nova RPC `combat_damage` exige membro ativo com papel `player`, personagem próprio e não arquivado entre os aliados da mesma sala ativa, alvo com lado `enemy` e valor inteiro entre 1 e 100000.
- A redução é transacional e usa trava no participante e, quando o inimigo é um personagem, também no recurso real de Vida. O valor nunca fica abaixo de zero.
- A resposta da RPC não revela a Vida anterior, a Vida restante nem o dano efetivo de inimigos ocultos. O evento completo fica registrado no histórico administrativo como `combat_damage`.
- Chamadas diretas contra aliado, sala encerrada, campanha sem participação, jogador fora da sala, valor inválido ou uso da rota pelo Mestre são rejeitadas no backend.
- A migration local `20260916052558_combat_player_damage.sql` foi aplicada no Supabase real como `20260916155848_combat_player_damage`. A função ficou com `search_path=public`, execução liberada para `authenticated` e bloqueada para `anon`.
- Os advisors foram executados após a migration. O aviso genérico para RPCs `SECURITY DEFINER` inclui `combat_damage` porque sua execução autenticada é intencional; as verificações de campanha, papel, sala, atacante e alvo permanecem dentro da função. Os demais avisos já existentes não pertencem a esta entrega focada.
- `npm test` passou em 52/52, incluindo a integração entre card e RPC e os limites reais do banco. `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Não foram realizados teste visual, teste mecânico no navegador ou validação manual em celular, conforme orientação do usuário.

### Próximo passo recomendado para o dano

1. O usuário deve entrar como jogador, tocar em um inimigo, informar o dano e confirmar.
2. Conferir no celular o fechamento da aba, o tremor vermelho do card e a atualização do estado visual do inimigo.
3. Tentar tocar em um aliado e confirmar que a ação de dano não aparece.

## Ordem fixa dos cards do Combate, 16/09/2026, 16:12 UTC

- Aliados e Inimigos agora são ordenados por nome, com o identificador estável como desempate.
- Vida, Mana, Fôlego, estado de ferimento, revelação e animação de dano não participam da ordenação. Portanto, atacar ou ajustar recursos não muda a posição do card.
- A ordenação trabalha sobre uma cópia do array recebido e não altera o snapshot compartilhado pela aplicação.
- Nenhuma função, tabela, policy, RLS ou migration do Supabase foi alterada.
- O teste específico reproduz uma atualização de dano com entrada do snapshot em ordem diferente e confirma que a sequência final dos cards permanece idêntica.
- `npm test` passou em 53/53. `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Não foi feita validação visual ou mecânica no navegador. O usuário fará a conferência manual após o deploy.

### Próximo passo recomendado

1. Atacar sucessivamente inimigos diferentes no celular e confirmar que cada card permanece no mesmo lugar.
2. Conferir o mesmo comportamento quando um inimigo muda para Ferido ou Vida zerada.

## Comunidade dark fantasy e presença online, 16/09/2026, 16:50 UTC

- A Comunidade foi reorganizada como uma experiência social dark fantasy responsiva, mantendo a alteração restrita a essa página.
- O cabeçalho reúne wallpaper, apresentação, busca e as áreas Descobrir, Mensagens e Ranking. A galeria em destaque usa rolagem horizontal, enquanto o diretório usa busca, filtros e carregamento em grupos de 12 para evitar uma lista vertical ilimitada.
- As ações existentes foram preservadas: abrir perfil público e mural, iniciar conversa, escolher a identidade de publicação, criar Personagem do Mundo e solicitar sua exclusão definitiva quando Pink/Mestre estiver autenticado.
- Todos os avatares continuam passando pelo componente central `IdentityAvatar`, portanto avatar, moldura equipada e efeitos permanecem vinculados à identidade real.
- As cinco artes enviadas pelo usuário foram otimizadas para WebP e associadas do 1º ao 5º lugar do ranking de riqueza. Colocações posteriores continuam com indicação numérica.
- O status online usa `activity_sessions`, com janela de dois minutos compatível com o rastreador existente. A RPC retorna somente `user_id` e o booleano `online`; horários, duração e sessões completas continuam protegidos pela RLS.
- A função exige associação ativa à campanha, rejeita contas externas, não atribui presença a Personagens do Mundo e permite execução somente a `authenticated` e `service_role`. `anon` permanece sem acesso.
- A migration local `20260916163449_community_presence.sql` foi aplicada no Supabase real como `20260916164459_community_presence`.
- `npm test`: 55/55 aprovado. `npm run typecheck`: aprovado. `npm run build`: aprovado, com seis rotas geradas. `git diff --check`: aprovado.
- Os advisors foram executados após a migration. O aviso de RPC `SECURITY DEFINER` é esperado porque `community_presence` é uma API intencional para membros autenticados e valida a campanha dentro da função. Os demais avisos são anteriores e não foram alterados nesta entrega focada.
- Não foram feitos teste visual, teste mecânico no navegador nem revisão manual em celular, conforme orientação do usuário.

### Próximo passo recomendado para a Comunidade

1. O usuário deve validar no celular o cabeçalho, as três áreas, a rolagem de destaques, os filtros e o encaixe das medalhas.
2. Abrir Pink e um jogador em sessões distintas e confirmar que a bolinha verde aparece e desaparece dentro da janela de até dois minutos.
3. Enviar prints somente dos ajustes visuais necessários.

## Presença imediata, ordem social e wallpaper da Comunidade, 16/09/2026, 17:08 UTC

- A causa da presença incorreta era o reaproveitamento de `activity_sessions`: a sessão só começava após uma interação e era encerrada depois de dois minutos sem toque ou teclado, mesmo com o site aberto.
- A presença online agora possui heartbeat próprio em `alvorecer_private.presence_sessions`. O primeiro `presence_ping` ocorre ao abrir o aplicativo, repete a cada 30 segundos e não interfere nas métricas de atividade já existentes.
- `community_presence` passou a consultar somente a sessão privada de presença, continua retornando apenas `user_id` e `online` e mantém a janela de expiração de dois minutos para quedas de conexão ou fechamento sem aviso.
- A interface recebe um evento local após o primeiro heartbeat e atualiza a bolinha verde imediatamente, sem esperar o próximo polling de 30 segundos.
- A tabela privada não possui acesso direto para `anon` ou `authenticated`. As RPCs exigem autenticação, associação ativa à campanha e impedem reutilizar o identificador de sessão por outra conta ou campanha.
- Em "Todos os jogadores", o estado padrão coloca perfis online primeiro e usa o ranking real de riqueza como ordem dentro de cada grupo. Sem usuários online, a sequência é integralmente a do ranking. Nenhum filtro de riqueza foi criado; os filtros de tipo continuam mudando a organização conforme solicitado.
- O wallpaper enviado foi otimizado de aproximadamente 2 MB em PNG para cerca de 30 KB em WebP e aplicado apenas ao cabeçalho da Comunidade, com posição responsiva no mobile.
- As migrations locais `20260916170031_community_live_presence.sql` e `20260916170404_community_presence_user_index.sql` foram aplicadas no Supabase real como `20260916170323_community_live_presence` e `20260916170422_community_presence_user_index`.
- A verificação real confirmou tabela privada, leitura pela RPC dedicada, execução permitida para `authenticated`, execução negada para `anon` e cobertura dos índices. O aviso de função `SECURITY DEFINER` é esperado porque as duas RPCs são APIs autenticadas com validação interna. Os demais avisos dos advisors são anteriores ou informativos.
- `npm test` passou em 58/58. `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Não foram realizados teste visual, teste mecânico no navegador nem validação manual em celular, conforme orientação do usuário.

### Próximo passo recomendado

1. Abrir Pink e um jogador em sessões distintas e conferir se as bolinhas surgem logo após entrar no site.
2. Conferir no celular o recorte do novo wallpaper e a ordem de "Todos os jogadores".
3. Enviar prints somente se algum ajuste visual for necessário.

## Formato global dos avatares, 16/09/2026, 17:40 UTC

- Avatares agora usam o formato circular como padrão em campanhas que ainda não possuem uma preferência salva.
- Pink/Mestre ganhou em `Configurações > Aparência` um controle imediato com as opções `Circular` e `Quadrado`.
- A preferência é armazenada em `campaigns.theme.avatar_shape`, reutilizando a operação `campaign` já existente em `game_command`. Nenhuma tabela, RLS ou migration nova foi necessária.
- A mudança controla uma variável CSS no contêiner da campanha e alcança o componente central `IdentityAvatar`, as fotos com moldura e a galeria de seleção sem duplicar lógica nas páginas.
- O modo `Quadrado` preserva o formato arredondado anterior. Molduras e efeitos continuam proporcionais e não são removidos ao trocar o formato.
- O carregamento da campanha passou a atualizar também o tema atual. Assim, o evento de campanha já existente propaga a escolha para as sessões de outros jogadores.
- A proteção administrativa foi confirmada no banco real: `anon` não executa `game_command`, usuários autenticados passam pela validação interna e a operação `campaign` permanece bloqueada para quem não é Mestre.
- `npm test` passou em 59/59. `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Não foram feitos teste visual no navegador, teste mecânico ou validação em celular. O usuário fará essa conferência após o deploy.

### Próximo passo recomendado

1. Pink deve alternar entre `Circular` e `Quadrado` em `Configurações > Aparência`.
2. Conferir no celular o avatar com e sem moldura no menu, Perfil, Comunidade e Combate.
3. Manter `Circular` selecionado se esse for o formato definitivo desejado.

## Redesign social Orkutista da Comunidade, 16/09/2026, 21:30 UTC

- A alteração ficou restrita à Comunidade e preservou busca, presença real, ranking, mensagens, perfil público, mural, filtros e controles exclusivos do Mestre.
- O logo Orkutista enviado pelo usuário foi incorporado ao novo cabeçalho. O cabeçalho possui botão do menu principal à esquerda e pesquisa e notificações à direita.
- A Comunidade passou a recolher a sidebar como sobreposição, da mesma forma que o Combate, sem alterar o menu nas demais páginas.
- A galeria `Em destaque` foi refeita no estilo stories e os avatares passaram de 88 px para um tamanho responsivo entre 104 e 118 px. Isso corrige a redução percebida depois da adoção do formato circular e mantém molduras e efeitos.
- Uma composição visual de feed dark fantasy reutiliza o wallpaper existente e a identidade real selecionada. Os ícones de interação nessa composição são somente visuais nesta etapa; nenhuma tabela, RPC ou contador artificial foi criado.
- A barra inferior fixa reúne `Início`, `Explorar`, `Criar`, `Conversar` e `Perfil`. `Conversar` usa o ícone de envio inspirado em mensagens diretas, no lugar do item visual chamado Comunidade.
- As ações da barra reaproveitam fluxos existentes: explorar rola até o diretório, criar abre o perfil/mural da identidade atual, conversar abre a lista de mensagens e perfil navega à página Perfil.
- Nenhuma migration, RLS, função ou dado do Supabase foi alterado.
- `npm test`: 60/60 aprovado. `npm run typecheck`: aprovado. `npm run build`: aprovado, com seis rotas geradas. `git diff --check`: aprovado.
- Não foram feitos teste visual no navegador, validação mecânica nem revisão em celular. A fidelidade final, espaçamentos e comportamento em aparelho real permanecem para a validação manual do usuário.

### Próximo passo recomendado para a Comunidade

1. Validar no celular o tamanho dos avatares em destaque, o recorte do logo e do wallpaper e a barra inferior durante a rolagem.
2. Conferir a abertura do menu, pesquisa, notificações, conversa e perfil sem perda das funcionalidades anteriores.
3. Enviar prints dos ajustes de fidelidade necessários antes de iniciar curtidas, stories ou publicação de feed reais.

## Separação das áreas sociais e ajuste circular, 16/09/2026, 21:50 UTC

- Os ícones do cabeçalho da Comunidade ficaram sem borda, sem superfície própria e com fundo transparente.
- O Início não exibe mais `Em destaque`, `Ver todos` nem a faixa `Descobrir`, `Mensagens` e `Ranking`. Ele contém somente stories e a composição visual do feed.
- `Explorar` passou a substituir o conteúdo do Início por um diretório próprio. O ranking real permanece acessível dentro de Explorar por um controle compacto.
- `Conversar` também substitui o conteúdo e mostra somente a lista apropriada para iniciar mensagens.
- `Criar` reutiliza temporariamente o perfil/mural da identidade atual. O botão `Perfil` da barra inferior está desativado e não navega para o Perfil administrativo do jogador, aguardando o futuro design do perfil social.
- A barra inferior continua fixa, mas agora ocupa toda a largura da Comunidade, encosta na borda inferior e usa somente uma linha superior. Foram removidos margem lateral, contorno completo e cantos arredondados de caixa flutuante.
- Quando o formato global é circular, a foto de uma identidade com moldura usa inset de 4% em vez de 14%. Assim, a foto ocupa praticamente o mesmo diâmetro da versão sem moldura. O modo quadrado preserva o encaixe anterior de 14%.
- Busca, notificações, presença, mensagens, ranking, perfil público, mural, filtros e ações protegidas do Mestre continuam presentes. Nenhuma migration, RLS, RPC ou dado do Supabase foi alterado.
- `npm test`: 60/60 aprovado. `npm run typecheck`: aprovado. `npm run build`: aprovado, com seis rotas geradas. `git diff --check`: aprovado.
- Não foram feitos teste visual, teste mecânico no navegador ou validação em celular. O usuário fará essa conferência após o deploy.

### Próximo passo recomendado

1. Validar no celular os avatares com e sem moldura no story e confirmar se o diâmetro visual ficou equivalente.
2. Alternar entre Início, Explorar, Criar e Conversar e confirmar que somente uma área aparece por vez.
3. Conferir o header transparente e a barra inferior integrada à borda da tela.

## Mensagens não lidas na navegação da Comunidade, 16/09/2026, 22:02 UTC

- O balão flutuante de mensagens foi removido somente enquanto a página Comunidade está ativa. Nas demais páginas, ele continua disponível como antes.
- O item `Conversar` da barra inferior agora exibe uma bolinha vermelha com a quantidade real de mensagens diretas não lidas.
- O contador reutiliza o resultado já protegido da RPC `unread_messages`, calculado pelo `DirectChat`, e é compartilhado com a Comunidade sem criar consulta duplicada nem estado visual independente.
- O indicador fica oculto quando o total é zero e limita apenas a apresentação a `99+`; o valor real permanece preservado.
- Ao entrar na Comunidade, uma janela flutuante que estivesse aberta é fechada. A abertura de conversa pelo diretório continua usando o fluxo existente.
- Nenhuma migration, RLS, RPC ou dado do Supabase foi alterado.
- `npm test`: 61/61 aprovado. `npm run typecheck`: aprovado. `npm run build`: aprovado, com seis rotas geradas.
- Não foram feitos teste visual, teste mecânico no navegador ou validação em celular. O usuário fará essa conferência após o deploy.

### Próximo passo recomendado

1. Receber uma mensagem em outra sessão e conferir no celular se o número aparece no item `Conversar`.
2. Abrir a conversa, ler a mensagem e confirmar que o indicador desaparece.
3. Confirmar que não existe mais balão flutuante sobre a Comunidade.

## Recuperação de falha de rede e remoção dos divisores da Comunidade, 17/09/2026, 01:57 UTC

- A mensagem `TypeError: Failed to fetch` foi identificada como falha de transporte no navegador: a requisição não recebeu uma resposta HTTP. Não é uma mensagem de regra do banco ou de RLS.
- Na verificação do incidente, o projeto Supabase estava `ACTIVE_HEALTHY` e a Vercel não possuía erros de runtime registrados nas 24 horas anteriores.
- A tela principal carregava 29 tabelas e cinco RPCs de leitura em paralelo. Ao conectar o Realtime, essa carga completa era disparada uma segunda vez sem necessidade, aumentando a exposição a oscilações de rede.
- O carregamento duplicado após `SUBSCRIBED` foi removido. A carga inicial permanece imediata e as alterações seguintes continuam atualizadas pelos eventos Realtime.
- RPCs comprovadamente somente de leitura agora repetem até duas vezes apenas quando ocorre falha de transporte. Operações que alteram dados não são repetidas automaticamente, evitando duplicação de ações.
- Quando a conexão continua indisponível depois das tentativas, a interface apresenta uma mensagem compreensível em português no lugar do erro técnico cru.
- A linha inferior do cabeçalho e a linha inferior da área de stories da Comunidade foram removidas conforme o print enviado.
- Nenhuma migration, RLS, função ou dado do Supabase foi alterado.
- `npm test`: 66/66 aprovado. `npm run typecheck`: aprovado. `npm run build`: aprovado, com seis rotas geradas.
- Não foram feitos teste visual, simulação de queda real de rede no navegador ou validação em celular.

### Próximo passo recomendado

1. Validar no celular se o cabeçalho e os stories ficaram contínuos, sem linhas divisórias.
2. Observar o uso normal em troca de Wi-Fi e rede móvel e informar se a mensagem amigável ainda aparece com frequência.
