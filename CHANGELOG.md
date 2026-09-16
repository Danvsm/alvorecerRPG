# Changelog

Todas as mudanças relevantes concluídas neste projeto são registradas aqui. Itens que ainda dependem de validação permanecem fora da lista de entregas concluídas.

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
