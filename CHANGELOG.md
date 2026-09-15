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
- Gates automatizados aprovados após as últimas correções: 21/21 testes, TypeScript e build.
- Correção da troca de avatar no painel Personagens: a seleção agora usa `game_action/avatar_select` com o personagem escolhido, sem alterar a foto da identidade do Mestre.
- Deploy de produção do commit `42292c73ddc8c031c483ecfc738a2473b16f8909` confirmado como `READY` no projeto `alvorecer-rpg-vsm`.
- Deploy de produção do redesign no commit `28c42266fec6fb788501f517d1087907c07eae5b` confirmado como `READY` no projeto `alvorecer-rpg-vsm`.

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
