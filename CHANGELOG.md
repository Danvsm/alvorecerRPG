# Changelog

Todas as mudanças relevantes concluídas neste projeto são registradas aqui. Itens que ainda dependem de validação permanecem fora da lista de entregas concluídas.

## Em desenvolvimento — 2026-09-22

### Entregue

- Projeto Android híbrido criado em `android-app`, preservando o Next.js/Vercel como núcleo e o Supabase como backend.
- WebView sem aparência de navegador, sessão web preservada, bloqueio nativo de captura e gravação de tela e permissões Android para câmera, microfone, fotos, vídeos e localização.
- Galeria remota privada do Mestre com índice incremental local, miniaturas WebP, metadados, solicitação do original no painel e envio automático pelo aparelho autorizado.
- Fila persistente com WorkManager, restrição de rede e retomada após retorno de conectividade, abertura do aplicativo, reinício do aparelho e atualização do APK.
- Tabelas e buckets privados sem acesso direto de jogador; painel e solicitações de original restritos ao Mestre, com token de dispositivo armazenado cifrado no Android.
- Migration `master_mobile_gallery` aplicada no Supabase e `alvorecer-api` versão 22 publicada.
- APK de teste `0.1.0` compilado e assinado pelo GitHub Actions.
- TypeScript e build de produção aprovados. A nova cobertura Android passou; permanece uma falha anterior e não relacionada no teste textual do Perfil.

## Em desenvolvimento — 2026-09-21

### Entregue

- MVP de chamada de voz 1x1 integrado ao chat direto com WebRTC, solicitação protegida de microfone, aceitar, recusar, cancelar, encerrar, mute, áudio remoto, duração e tratamento básico de falha/desconexão.
- Sinalização de chamada isolada em `direct_calls` e `direct_call_signals`, com RLS, RPCs autenticadas e Realtime próprio, sem acionar `campaign_events` ou recarregar a campanha inteira.
- Chamada recebida com overlay mobile e push de prioridade alta; `alvorecer-push` versão 10 ACTIVE e Service Worker revisão 8.
- Validação automatizada do MVP concluída com 98/98 testes, TypeScript e build de produção aprovados.
- Gravação e TURN permanecem como próximas etapas, não como funcionalidades concluídas.

## Em desenvolvimento — 2026-09-18

### Entregue

- Publicações somente de texto concluídas no criador do feed, com editor em tela cheia fiel ao mockup, identidade ativa, selo `Apenas texto`, limite de 1.000 caracteres e publicação pelo botão de envio.
- Feed e Arquivos agora tratam posts com ou sem imagem sem solicitar URLs vazias ao Storage; excluir um post textual não cria fila de mídia nem arquivo órfão, mantendo as mesmas regras de autoria e Mestre.
- Migration `text_only_orkutista_posts` aplicada no Supabase real, com `image_path` opcional, limite textual protegido no banco e limpeza de Storage condicionada à existência de mídia.
- O criador de publicações do feed passou a abrir em tela cheia com uma primeira etapa inspirada no mockup: Galeria, Câmera e Escrita, usando os assets dourados e o cenário fornecidos.
- Galeria e Câmera agora seguem para uma segunda etapa dedicada, com foto em destaque, alternância de enquadramento, campo de legenda, atalho de emoji e ação dourada para publicar, preservando a compressão automática já existente.
- Notificações redesenhadas como uma experiência dark fantasy em tela cheia, com cabeçalho, retorno, ações circulares, filtros `Todas` e `Não lidas` e cards responsivos inspirados no mockup fornecido.
- A lista agora separa os avisos em `Hoje`, `Ontem` e `Mais antigas`, destaca itens não lidos e preserva as operações existentes de marcar como lida e limpar; a aba de menções não foi criada.
- Corrigida a limpeza de notificações: `Limpar notificações` agora descarta toda a lista visível do usuário na campanha, incluindo itens recentes, em vez de atingir somente registros com mais de 30 dias.
- A lista e o contador são atualizados localmente após a confirmação da RPC, sem recarregar todas as tabelas da campanha.
- A operação continua restrita no backend ao usuário autenticado e à campanha da qual ele é membro; a migration `clear_all_notifications` foi aplicada no Supabase real.
- Criador de Story redesenhado em tela cheia a partir do mockup fornecido, com cabeçalho ornamental, cards de Câmera, Galeria e Prévia, seção de recentes e ações fixas de cancelar/publicar.
- O botão Câmera solicita a câmera traseira quando o aparelho oferece suporte; Galeria abre o seletor nativo de fotos recentes sem tentar acessar arquivos privados sem autorização.
- A foto escolhida aparece em uma prévia antes da publicação e pode ser trocada, preservando o fluxo existente de uma imagem, otimização automática e upload protegido.
- Os três backgrounds enviados foram integrados ao criador e convertidos para WebP; juntos ocupam aproximadamente 108 KB no lugar de cerca de 6,5 MB em PNG.
- Stories agora podem ser curtidos e descurtidos, mantendo no banco no máximo uma curtida ativa por identidade e Story.
- O visualizador ganhou uma área de atividade com a lista unificada de quem visualizou e quem curtiu, reutilizando avatar, moldura e efeitos existentes.
- A atividade e seus contadores são privados para o autor do Story e Pink/Mestre; os demais jogadores veem somente o estado da própria curtida.
- As permissões são validadas nas RPCs, sem acesso direto à tabela de curtidas. A exclusão ou expiração do Story remove curtidas e visualizações em cascata.
- Migrations `story_likes_and_audience` e `story_likes_advisor_hardening` aplicadas no Supabase real.
- Feed do Orkutista paginado por cursor: mostra 5 publicações inicialmente e busca o próximo lote somente quando a pessoa se aproxima do fim da rolagem.
- Apenas as imagens do lote visível recebem URL assinada e entram no carregamento preguiçoso; o registro extra usado para detectar a próxima página não baixa imagem.
- Índice específico para a ordem paginada e migration `paginate_orkutista_feed` aplicados no Supabase real.
- Exclusão imediata de comentários e respostas sem confirmação: cada jogador pode remover somente o próprio conteúdo, enquanto Pink/Mestre pode remover comentários de qualquer autor.
- Autorização de exclusão validada no backend; apagar um comentário principal remove também respostas e curtidas relacionadas pelas cascatas existentes.
- Migration `delete_orkutista_comments` aplicada no Supabase real.
- Exclusão de publicação pelo menu de três pontos, sem confirmação, com autorização validada no backend.
- Jogadores podem excluir somente as próprias publicações; elas saem do feed imediatamente e ficam por 24 horas na nova página administrativa `Arquivos`, visível apenas para Pink/Mestre.
- A página `Arquivos` mostra foto, autor, username, data original, data da exclusão e tempo restante usando o prazo calculado pelo banco.
- Exclusões feitas por Pink/Mestre não passam por `Arquivos`: publicação, curtidas, comentários e respostas são removidos em cascata, e a imagem é apagada pela Storage API com fila automática contra arquivos órfãos.
- O cron por minuto agora elimina definitivamente publicações arquivadas vencidas e suas imagens; execução real confirmada com HTTP 200 e o novo bloco `posts` sem pendências.
- Migration `delete_orkutista_feed_posts` aplicada no Supabase real; Edge Function `alvorecer-api` versão 16 ativa.
- Stories reais no topo do Orkutista, mantendo o botão `+` inferior exclusivo para publicações do feed.
- Criação de Story por imagem com seleção, prévia, cancelamento e otimização automática para WebP de até 1 MB.
- Linha horizontal mobile com rolagem por toque, somente autores com Stories ativos e aro distinto para conteúdo visto ou não visto.
- Visualizador em tela cheia com avatar, moldura e efeitos existentes, horário relativo, progresso, avanço automático, toque para avançar/voltar e fechamento.
- Vários Stories do mesmo autor em sequência, seguidos automaticamente pelo próximo autor ativo.
- Visualizações idempotentes por identidade e autorização server-side contra publicação ou exclusão usando outra identidade.
- Exclusão pelo autor ou Pink/Mestre, com remoção do objeto pelo Storage API e fila automática de recuperação em caso de falha transitória.
- Expiração baseada no horário do banco em 24 horas; os Stories deixam a consulta imediatamente e o cron remove registros, visualizações e imagens a cada minuto.
- Migration `orkutista_stories` e endurecimento do advisor aplicados no Supabase real; Edge Function `alvorecer-api` versão 15 ativa e limpeza confirmada com HTTP 200.
- `npm test`: 72/72 aprovado; `npm run typecheck` e `npm run build`: aprovados.
- Validação visual e manual em celular permanece para o usuário após o deploy.

## Em desenvolvimento — 2026-09-17

### Entregue

- Feed inicial real do Orkutista com publicação de uma foto e legenda.
- Seleção, prévia e otimização automática da foto para WebP de até 1 MB antes do envio ao Storage privado.
- Cards do feed com o componente central de avatar e moldura equipada, autoria, username, foto, legenda e contadores.
- Curtir e descurtir publicação com uma única curtida ativa por identidade.
- Comentários em painel responsivo, curtidas em comentários e respostas limitadas a um nível abaixo do comentário principal.
- Validação server-side da identidade autenticada; jogadores não podem publicar, comentar ou curtir como outra pessoa.
- Mestre continua podendo representar apenas sua identidade ou Personagens do Mundo sem usuário, preservando o controle existente de criação desses personagens.
- Migration `orkutista_feed` aplicada no Supabase real, com RLS, bucket privado e funções autenticadas.
- `npm test`: 69/69 aprovado; `npm run typecheck` e `npm run build`: aprovados.
- Validação visual e manual em celular permanece para o usuário após o deploy.

## 1.3.0 — 2026-09-14

### Entregue

- Experiência compacta e gestão segura da campanha.
- Perfis, carteira de Dracmas, atividade, feedback de sessão e ciclo de vida de contas.
- Exclusões seguras, histórico e reforço de segurança e desempenho.
- Progressão por XP, compra de vantagens e atributos dinâmicos.
- Identidades sociais, administração de jogadores, notificações, comunidade, mural e chat direto.
- Envio privado de imagens temporárias no chat, com reserva, Storage protegido e expiração.
- Administração de recompensas, XP, Dracmas, vantagens, inventário e dados do jogador.
- Criaturas, NPCs, minions e combates com múltiplas instâncias.
- Ocultação de valores numéricos de inimigos para jogadores, preservando o estado visual.
- Cosméticos de perfil, coleção, concessão e equipamento de molduras.
- Proteção de identidade social durante arquivamento e reativação.
- Cron autenticado para limpeza de mídia temporária.
- Timeout da limpeza ampliado para 60 segundos; chamada posterior confirmada com HTTP 200.
- Formatação dos valores estruturados no Histórico, incluindo XP disponível, XP total e nível.
- Limpeza do destinatário e da identidade do chat ao sair ou mudar de campanha.
- Remontagem do chat ao trocar conta ou identidade, evitando herança de estado da sessão anterior.
- Redesign mobile-first da página Combate com cards compactos, grade de dois participantes por linha em telas pequenas e seções exclusivas de Aliados e Inimigos.
- Remoção de Neutros do fluxo atual e da interface, sem migration destrutiva ou perda do suporte histórico no banco.
- Ajuste livre de Vida por modal: Mestre pode perder ou ganhar Vida de qualquer participante; jogador pode apenas perder Vida do próprio personagem, com bloqueio também na camada de comando e no backend existente.
- Cabeçalho dark fantasy e identificação das equipes usando os assets fornecidos, otimizados para WebP.
- Ações administrativas de sala, inclusão, gerenciamento, revelação e encerramento centralizadas na engrenagem exclusiva do Mestre.
- Consumíveis legítimos preservados em seção recolhível, sem misturá-los ao ajuste manual de Vida.
- Chat flutuante ancorado com espaço reservado na página Combate para não cobrir ações importantes no mobile.
- Gates automatizados aprovados após as últimas correções: 24/24 testes, TypeScript e build.
- Correção da troca de avatar no painel Personagens: a seleção agora usa `game_action/avatar_select` com o personagem escolhido, sem alterar a foto da identidade do Mestre.
- Exclusão definitiva de Personagens do Mundo pela Comunidade, disponível somente para Pink/Mestre, com confirmação simples e limpeza segura dos vínculos sociais e de mídia.
- Proteção no banco contra exclusão por jogador e contra qualquer tentativa de atingir personagens pertencentes a jogadores.
- Correção da exclusão de Personagem do Mundo para remover mídias pela API oficial do Supabase Storage, com preparação e finalização restritas a `service_role` e dupla validação de Mestre e alvo.
- Regra padrão de uso único de avatar por jogador, com trava transacional no banco para impedir dupla ocupação concorrente.
- Painel de avatares de Pink/Mestre com busca, filtros, estados reais, identificação dos usuários atuais, bloqueio, exclusividade, compartilhamento, arquivamento, reativação e exclusão segura.
- Proteção server-side de avatares bloqueados, exclusivos e ocupados, incluindo chamadas diretas, com exceção administrativa restrita a Pink e sincronização entre perfil, ficha e personagem.
- Administração completa de Molduras de Avatar pelo Pink, com upload privado, editor de posicionamento, raridades, coleções dinâmicas, origem, visibilidade, segredo, exclusividade, ordenação, duplicação, concessão múltipla, remoção e histórico administrativo.
- Componente proporcional de avatar + moldura + efeitos usado no Perfil, com Glow, brilho deslizante, pulso, aura, partículas e runas leves, limites de performance e suporte a `prefers-reduced-motion`.
- Proteção server-side para criação, edição, concessão, remoção e equipamento de molduras; conteúdo secreto sanitizado antes da concessão e equipamento removido com segurança quando o acesso deixa de existir.
- Exclusão de Personagem do Mundo protegida contra mídia criada durante a operação: a finalização trava as conversas, confere os arquivos realmente removidos e repete a limpeza quando detecta concorrência.
- Deploy de produção do commit `42292c73ddc8c031c483ecfc738a2473b16f8909` confirmado como `READY` no projeto `alvorecer-rpg-vsm`.
- Deploy de produção do redesign no commit `28c42266fec6fb788501f517d1087907c07eae5b` confirmado como `READY` no projeto `alvorecer-rpg-vsm`.
- Módulo Image Cache integrado sem criar um segundo PWA: Service Worker dedicado a imagens, estratégia Stale While Revalidate, deduplicação de downloads simultâneos, fallback offline e limite LRU aproximado de 300 imagens.
- URLs assinadas de avatares, molduras e itens recebem versão estável do ativo; a renovação do token não duplica a entrada local e uma alteração de arquivo gera somente um novo download.
- Imagens temporárias do chat permanecem fora do cache persistente. Logout limpa as URLs visuais em memória, e a ativação remove apenas versões antigas dos caches `alvorecer-images-*`.
- Novos uploads imutáveis em Storage recebem cache HTTP de um ano. O Service Worker nunca recebe cache HTTP duradouro; assets estáticos visuais recebem cache público com revalidação.
- Validação local do Image Cache: 10/10 cenários específicos, 43/43 testes totais, TypeScript e build de produção aprovados.
- Image Cache publicado no commit `6b56727ba7b2806418d890105e19c598ee5ad95d`; deploy de produção `dpl_ASbJmsmPArpvQ8dabCb4ePytJBFB` confirmado como `READY`, com os cabeçalhos esperados e sem erros de runtime no período da validação.
- Corrigida a CSP do Service Worker para permitir exclusivamente conexões ao projeto Supabase do Alvorecer; a política anterior bloqueava o download das fotos privadas no navegador depois que o worker assumia a requisição.
- URLs privadas de fotos, avatares e molduras agora são assinadas em lote e renovadas antes da expiração, ao retornar para o aplicativo e após falhas transitórias do Storage, preservando a chave estável do Image Cache.
- Service Worker de imagens atualizado para a revisão 2, com URL e caches versionados, para substituir também instalações antigas que preservavam a CSP defeituosa. A troca do controlador solicita imediatamente novas URLs visuais.
- Exibição global de avatar centralizada em `IdentityAvatar`: menu, ficha, Perfil, Comunidade, Combate, ranking, mensagens, carteira, mural e listas passam a acompanhar a moldura e os efeitos realmente equipados.
- Molduras secretas equipadas podem fornecer somente a arte e os efeitos necessários à apresentação pública, sem revelar nome, descrição, propriedade ou controles administrativos a outros jogadores.
- Combate atualizado com cards clicáveis e aba inferior animada para ajustar Vida, Mana e Fôlego; Pink pode reduzir ou recuperar qualquer participante, enquanto jogador pode apenas reduzir os próprios recursos.
- Navegação lateral recolhível no Combate, wallpaper sem moldura e superfícies visuais simplificadas para concentrar os cards nos participantes.
- Ações do Combate consolidadas em um menu de três pontos e faixas de Aliados/Inimigos refinadas com frases, wallpaper sutil e identificação cromática.
- Jogadores podem causar dano em inimigos pela área de Combate, com quantidade informada em uma única confirmação, proteção transacional no backend e retorno visual de impacto no card atingido.
- Na Comunidade, o balão flutuante de mensagens foi substituído por um indicador vermelho com a quantidade real de não lidas no item `Conversar` da navegação inferior.
- Cards de Aliados e Inimigos mantêm ordem determinística durante ataques e ajustes de recursos, sem trocar de posição quando o estado do participante muda.
- Comunidade redesenhada como uma rede social dark fantasy responsiva, com busca, destaques horizontais, filtros, áreas de descoberta, mensagens e ranking, preservando perfil público, mural e controles exclusivos do Mestre.
- Medalhas fornecidas pelo usuário integradas às cinco primeiras colocações do ranking de riqueza.
- Indicador de presença online para jogadores e Mestre baseado em heartbeat real, com consulta mínima protegida por campanha e sem expor sessões ou horários de atividade.
- Presença online corrigida para iniciar ao abrir o site e permanecer independente de toque ou teclado, sem alterar as métricas de atividade.
- Diretório da Comunidade ordenado por presença e riqueza real, sem filtro artificial de riqueza, e cabeçalho atualizado com o wallpaper dark fantasy fornecido.
- Formato global dos avatares configurável por Pink/Mestre entre circular e quadrado, com padrão circular, persistência no tema da campanha e sincronização para os jogadores.
- Comunidade refinada no estilo social dark fantasy Orkutista, com logo próprio, cabeçalho inspirado no mockup, destaques circulares maiores, composição visual de feed e barra inferior fixa com acesso a início, exploração, criação, conversa e perfil.
- Navegação da Comunidade separada entre Início, Explorar, Criar e Conversar, com Perfil social temporariamente desativado, header sem caixas nos ícones, barra inferior integrada à tela e correção do tamanho da foto dentro de molduras circulares.
- Falhas transitórias de conexão deixaram de exibir `TypeError: Failed to fetch`: leituras críticas possuem recuperação limitada, a carga duplicada do Realtime foi removida e a Comunidade ficou sem divisores no cabeçalho e nos stories.

### Estado de validação

- A entrega está publicada, mas a validação final ainda não foi encerrada.
- Permanecem fora do escopo de “concluído”: teste visual completo Pink/jogador, combate interativo em duas sessões, revisão mobile e confirmação da remoção física da imagem após expiração.
- O fluxo publicado do jogador foi revalidado após o redesign; a validação Pink/Mestre e a viewport real próxima de 390×844 ainda permanecem pendentes.

## 0.1.0 — 2026-09-12

### Entregue

- Versão inicial funcional do Alvorecer RPG.
- Aplicação Next.js integrada ao Supabase real.
- Autenticação por username e senha.
- Campanha, personagens, ficha, recursos, atributos, inventário e histórico.
- RLS, Realtime, Storage privado, Vault e Edge Function `alvorecer-api`.
- Avatares privados e transferências atômicas de Dracmas.
