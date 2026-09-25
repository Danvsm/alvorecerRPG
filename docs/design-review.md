# Revisão de UI/UX — setembro de 2026

## Direção

Fantasia editorial na divulgação; interface escura, sóbria e legível na operação
da mesa. Dourado orienta navegação e contexto, enquanto cores de recursos,
perigo, combate e estados de jogo continuam com seu significado original.
Conteúdo, regras, autenticação e contratos com o banco não foram alterados.

## Ajustes

- Sistema compartilhado de superfícies, bordas, sombras e estados de foco.
- Login, convites e confirmação com uma superfície mais definida e campos confortáveis.
- Menu com alvos de 44px e seleção indicada por cor, fundo e marcador lateral.
- Painéis, estatísticas e fichas com hierarquia e espaçamento consistentes.
- Comunidade, biblioteca e perfis: leitura, tipografia e controles refinados sem
  substituir a arte ou redesenhar a estrutura de feed/chat.
- Inscrições: contatos tocáveis, respostas maiores e datas/status legíveis.
- Landing: títulos com entrelinha menos apertada, cards 2x2 mais legíveis,
  pacote completo destacado, navegação desktop e formulário com foco entre etapas.
- D20 vetorial com o mesmo traço dos demais ícones.
- Microinterações apenas em elementos relevantes. Entradas por CSS são melhoria
  progressiva; não há biblioteca de animação, listener de cursor ou parallax contínuo.
- Movimento reduzido desativa efeitos; hover com movimento é restrito ao mouse.

## Limites da validação

A landing foi observada no navegador remoto. O navegador não acessa localhost;
as áreas privadas foram revisadas pelo código, sem login ou alteração de dados.
Não afirmar teste visual integral de todos os estados autenticados. Revisar no
celular real entre 360 e 430px e em uma sessão de Mestre/Jogador antes de produção.

## Regressões a conferir

- Abrir/fechar menu e navegar por ficha, comunidade, carteira, combate e perfil.
- Manter recursos, dados de jogo, ações de chat e envio de inscrição operantes.
- Percorrer as quatro etapas, voltar sem perder dados e usar teclado.
- Confirmar leitura de status e notas em Inscrições.
- Testar preferência do sistema por movimento reduzido.

O acabamento compartilhado fica em `app/design-system.css`, importado depois
do CSS legado. As regras são escopadas por `.app` e `.auth`; a landing usa seu
próprio CSS Module. Isso evita reescrever os layouts narrativos existentes.
