# Alvorecer RPG

Universo **Alvorecer**. Campanha inicial **A Promessa do Amanhecer**.

Aplicação real em Next.js 16, React 19, TypeScript e Supabase. A interface mantém a identidade aprovada no preview: fundo preto e grafite, vermelho escuro, cards diretos, leitura rápida e navegação responsiva.

## Estado atual

O projeto Supabase `alvorecer` está ativo em São Paulo. O banco, Auth, RLS, Realtime, Storage privado, Vault e a função de servidor `alvorecer-api` estão configurados. O aplicativo não possui fallback de demonstração nas telas reais.

O modo `/dev` continua disponível com `npm run dev`. Em produção ele retorna 404, a menos que `ENABLE_DEV_PREVIEW=true` seja definido.

## Funcionalidades

- Login por username e senha, sem email ou telefone do jogador.
- Mestre inicial, criação de jogador completa e cadastro por convite único e expirável.
- Credencial recuperável cifrada no Vault, disponível somente ao mestre pela função de servidor.
- Ficha com foto, classe, raça, informações livres, anotações, recursos, atributos, vantagens e inventário.
- Vida e Mana calculadas por atributo e multiplicador, com regra da campanha e substituição individual.
- Cálculo automático opcional, máximo manual e ajuste da vida atual somente quando o novo máximo é menor.
- Gastos de Vida, Mana e Fôlego pelo jogador; recuperação comum reservada ao mestre.
- Consumíveis genéricos com efeitos de recuperação, uso atômico, quantidade e histórico.
- Itens comuns, materiais, equipamentos, missões e consumíveis.
- Lojas com catálogo, preço, estoque opcional, compra atômica, saldo e inventário em tempo real.
- Miniaturas WebP privadas e retratos JPG, PNG ou WebP com regras de tamanho e propriedade.
- XP, dinheiro, vantagens e inventário administráveis, com compras de vantagem atômicas.
- Atributos UUID dinâmicos, inclusive atributos individuais, ordem, renomeação e arquivamento.
- Criaturas, NPCs e minions como modelos reutilizáveis.
- Combates com múltiplas instâncias, aliados, inimigos, neutros, ocultação de números e estado por cor.
- Eventos Realtime sem publicar valores secretos e consultas posteriores protegidas por RLS.
- Auditoria de recursos, máximos, saldo, compras, consumíveis, vantagens e credenciais.

## Desenvolvimento

Requisitos: Node.js 22 ou superior e um projeto Supabase.

1. Execute `npm ci`.
2. Copie `.env.example` para `.env.local`.
3. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` com valores públicos do projeto.
4. Aplique as migrations de `supabase/migrations/` na ordem registrada.
5. Publique `supabase/functions/alvorecer-api/` como Edge Function com `verify_jwt=false`. A função valida os tokens internamente porque também atende o login público por username.
6. Execute `npm run dev`.

O backend administrativo usa a service role fornecida automaticamente pelo ambiente da Edge Function. A chave nunca faz parte do frontend ou da configuração da Vercel. A chave de criptografia das credenciais é criada dentro do Supabase Vault.

## Comandos

- `npm run dev`: ambiente local e preview aprovado em `/dev`.
- `npm run typecheck`: validação TypeScript.
- `npm test`: testes PostgreSQL locais.
- `npm run build`: build de produção.

Os scripts `verify-live*.mjs` executam testes destrutivos controlados no projeto de validação e usam arquivos privados ignorados pelo Git. Eles não devem ser executados em uma campanha com dados reais sem preparar contas próprias de teste.

## Segurança

As tabelas expostas possuem RLS. O navegador recebe somente grants de leitura e chama `game_command` ou `game_action` para alterações. Essas funções conferem campanha, função do usuário, propriedade do personagem, catálogo, saldo, estoque e idempotência antes de gravar.

A função `combat_snapshot` remove Vida, Mana e Fôlego numéricos dos inimigos ocultos. O Realtime publica apenas a revisão da campanha, nunca a linha do combate ou a senha. Cofre, limites de login, recibos e reservas de cadastro permanecem sem políticas públicas deliberadamente.

A proteção de senha vazada do Supabase pode permanecer desativada enquanto a campanha aceitar senhas simples definidas pelo mestre. O sistema mantém limitação de tentativas e não expõe a identidade técnica do Supabase Auth.

## Estrutura

- `app/`: páginas reais e proxy HTTP para a Edge Function.
- `components/`: interface aprovada, ficha, recursos, consumíveis e lojas.
- `lib/`: cliente Supabase, proxy e otimização de imagens.
- `supabase/migrations/`: banco, funções atômicas, RLS, Realtime, Storage e Vault.
- `supabase/functions/alvorecer-api/`: login, convites e administração de credenciais.
- `tests/`: testes locais de consistência e permissões.
