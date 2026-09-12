# Validação do Alvorecer

## Gates automatizados

```bash
npm run typecheck
npm test
npm run build
```

Resultado esperado: TypeScript sem erro, 13 testes aprovados e geração das rotas `/`, `/api/auth`, `/api/admin`, `/convite/[token]` e `/dev`.

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
