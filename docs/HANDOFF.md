# Handoff — Alvorecer RPG

Atualizado em 15/09/2026, 16:30 UTC.

Este documento consolida o estado real anteriormente registrado em `VALIDACAO.md` e as verificações de infraestrutura feitas antes desta continuação. Ele não declara a validação final concluída.

## Infraestrutura atual

- GitHub: `Danvsm/alvorecerRPG`.
- Vercel: projeto `alvorecer-rpg-vsm`, ID `prj_QaxFObeWPJ8w0urfdzYICRDwIlHs`, equipe `team_CnaWIE2ArNb8Rmus0NWgv4Hr`.
- Produção: `https://alvorecer-rpg-vsm.vercel.app`.
- Supabase: projeto `alvorecer`, Project Ref `wsihnbrnqdnmidjvjchn`, região `sa-east-1`, estado `ACTIVE_HEALTHY`.
- Edge Function principal: `alvorecer-api`, ativa, versão 13, `verify_jwt=false`.
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

- As 29 migrations registradas estão aplicadas no Supabase real.
- A última migration aplicada é `20260915162348_avatar_frames_audit_indexes`.
- A migration `delete_world_characters`, que já estava aplicada no Supabase, foi recuperada para o Git sem alterar seu SQL. O conteúdo local e o registro remoto possuem o mesmo MD5: `acffd1ca56a91483efa42a87dbee8b5d`.
- A migration `chat_media_cleanup_timeout` mantém o cron `alvorecer-chat-media-cleanup` a cada 15 minutos e aumenta o timeout de `pg_net` para 60 segundos.
- A chamada de limpeza usa o endpoint `/functions/v1/alvorecer-api/media-cleanup` e autenticação guardada no Vault.
- A Edge Function `alvorecer-api` está ativa na versão 13.
- A migration corretiva remove a RPC antiga e divide a operação em preparação e finalização, ambas acessíveis somente por `service_role`. A remoção física ocorre entre essas etapas pela API oficial do Storage.

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
- No commit `28c4226`, a página Combate foi reorganizada em cards compactos, grade mobile de duas colunas, seções Aliados/Inimigos e controles administrativos centralizados na engrenagem.
- O fluxo atual não oferece mais Neutros nem renderiza a seção, preservando os registros antigos no banco sem migration destrutiva.
- O ajuste de Vida passou a aceitar quantidade inteira livre; o Mestre recebe perda/ganho e o jogador recebe somente perda no próprio personagem. Os comandos e as validações server-side existentes foram preservados.
- Os assets fornecidos para espadas, estandartes, coroa, brasão e wallpaper foram otimizados para WebP e usados diretamente na interface.
- A troca de avatar no painel Personagens agora mantém destinos separados: o Mestre altera somente o personagem selecionado, enquanto Perfil continua alterando somente a identidade própria.
- Pink/Mestre pode solicitar no perfil público da Comunidade a exclusão definitiva de um Personagem do Mundo, com confirmação simples por `Cancelar` ou `Excluir`.
- O endpoint administrativo rejeita jogadores, e as duas rotinas do banco repetem a validação do Mestre e da identidade-alvo. Ao excluir um Personagem do Mundo, remove conversas, mensagens, mídia temporária, comentários e cosméticos vinculados sem atingir personagens de jogadores.

## Testes já concluídos

### Automatizados

- `npm test`: 28/28 testes aprovados.
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

### Próximo passo do Image Cache

1. Abrir o site uma vez, recarregar e conferir `alvorecer-images-v1` em DevTools > Application > Cache Storage.
2. Trocar um avatar e confirmar que a nova imagem aparece sem limpar o cache inteiro.
3. Repetir em aproximadamente 390×844 e desktop; alternar entre duas contas e confirmar que não há imagem incorreta herdada.
