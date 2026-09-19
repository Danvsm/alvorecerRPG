# Tipografia do Alvorecer

A interface combina DM Sans e Lora. As duas fontes são carregadas em
`app/layout.tsx` com `next/font`, hospedadas junto com a aplicação e expostas
por duas variáveis de tema em `app/globals.css`.

| Papel | Variável | Aplicação |
| --- | --- | --- |
| Interface | `--font-ui` | DM Sans em navegação, abas, botões, formulários, usernames, bio, publicações, comentários, mensagens, estatísticas e telas administrativas. |
| Narrativa | `--font-display` | Lora no nome em destaque do perfil, nome da campanha, apresentação do login, marca textual e títulos dos editores de histórias e publicações. |

DM Sans mantém a leitura próxima de uma rede social contemporânea. Lora traz
um caráter literário aos destaques do universo, sem usar letras góticas nem
aplicar ornamentação a textos que precisam ser lidos rapidamente.

## Hierarquia

- Texto contínuo: peso 400, entrelinha de 1,55 a 1,6. Publicações usam 16 px
  como base, inclusive no celular. Bio e legenda não recebem itálico automático.
- Nomes de usuário e ações: pesos 500 ou 600. Títulos utilitários permanecem
  em DM Sans; a fonte de narrativa não deve ser aplicada a todos os headings.
- Destaques narrativos: Lora 500, com espaçamento discreto e tamanho responsivo.
- Números de recursos e estatísticas: DM Sans com algarismos tabulares para
  evitar deslocamento visual quando o valor muda.
- Não comprimir textos longos com espaçamento negativo. Rótulos do perfil
  podem quebrar linha no celular em vez de encolher excessivamente.

Para trocar uma fonte, altere seu carregamento no layout e sua variável de
tema. Componentes devem usar os papéis sem definir famílias isoladamente.
As imagens da marca, a paleta, os cosméticos e a estrutura das telas continuam
independentes da tipografia.
