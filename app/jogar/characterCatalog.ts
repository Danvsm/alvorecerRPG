export type CharacterEntry = {
  name: string;
  image: string;
  description: string;
  source?: string;
};

const manual = "Alvorecer · Manual Básico v1.2";

export const classes: CharacterEntry[] = [
  { name: "Lutador", image: "/jogar/classes/lutador.png", description: "O Lutador transforma o próprio corpo em uma arma. Especialista em combate corpo a corpo, combina força, técnica e domínio marcial para enfrentar inimigos de frente." },
  { name: "Assassino", image: "/jogar/classes/assassino.png", description: "O Assassino vive da precisão, furtividade e preparação. Ele prefere atacar quando o inimigo menos espera, utilizando emboscadas, venenos, marcas e golpes cuidadosamente planejados.", source: manual },
  { name: "Arqueiro-Guerreiro", image: "/jogar/classes/arqueiro.png", description: "O Arqueiro-Guerreiro transforma Dalva em armas de energia, criando seu próprio Arco de Dalva e suas flechas. É um combatente de longo alcance capaz de combinar precisão, mobilidade e técnicas especiais.", source: manual },
  { name: "Suporte", image: "/jogar/classes/suporte.png", description: "O Suporte mantém seus aliados de pé quando a batalha parece perdida. Cura, protege, fortalece e interfere no combate para fazer todo o grupo lutar melhor." },
  { name: "Cavaleiro Tank Celestial", image: "/jogar/classes/tank-celestial.png", description: "O Cavaleiro Tank Celestial é a muralha do grupo. Especializado em resistência, proteção e controle da linha de frente, ele intercepta ataques e força os inimigos a enfrentá-lo antes de alcançar seus aliados.", source: manual },
  { name: "Arcano", image: "/jogar/classes/arcano.png", description: "O Arcano dedica sua existência ao estudo da magia. Manipula Dalva para criar feitiços, controlar elementos, distorcer fenômenos e desenvolver técnicas mágicas próprias.", source: manual },
  { name: "Necromante", image: "/jogar/classes/necromante.png", description: "O Necromante domina aquilo que permanece depois da morte. Ele utiliza resíduos de Dalva, cadáveres e vínculos espirituais para criar servos e manipular forças ligadas à morte.", source: manual },
  { name: "Druida", image: "/jogar/classes/druida.png", description: "O Druida possui uma ligação profunda com a natureza e seus ciclos. Pode assumir formas selvagens, controlar plantas, invocar companheiros e utilizar o poder natural para atacar, proteger e sobreviver." },
  { name: "Monge", image: "/jogar/classes/monge.png", description: "O Monge transforma corpo, mente e Dalva em uma única arma. Desarmado, utiliza golpes rápidos, técnicas marciais e controle da própria energia para superar adversários muito mais armados.", source: manual },
  { name: "Bárbaro", image: "/jogar/classes/barbaro.png", description: "O Bárbaro transforma a própria fúria em poder. Quanto mais intensa fica a batalha, mais recursos ele acumula para aumentar seu potencial ofensivo, resistir aos ferimentos e continuar lutando.", source: manual },
  { name: "Bardo", image: "/jogar/classes/bardo.png", description: "O Bardo transforma arte em poder. Música, canto, dança, poesia e interpretação podem fortalecer aliados, enfraquecer inimigos e mudar o rumo de uma batalha através da Inspiração.", source: manual },
  { name: "Bruxo / Pactuário", image: "/jogar/classes/bruxo.png", description: "O Pactuário recebe poder através de um pacto com um Patrono. Suas habilidades podem assumir formas completamente diferentes, mas todo poder possui um preço, e o personagem aprende a transformar esse contrato em vantagem.", source: manual },
  { name: "Cavaleiro/Guerreiro", image: "/jogar/classes/cavaleiro.png", description: "O Cavaleiro/Guerreiro é o combatente marcial versátil, especializado em armas, defesa, posicionamento e domínio do campo de batalha. Ele pode desenvolver diferentes estilos de combate conforme suas escolhas durante a progressão." },
];

export const races: CharacterEntry[] = [
  { name: "Humano", image: "/jogar/racas/humano.webp", description: "Versáteis e determinados, os Humanos compensam suas limitações com adaptação, persistência e a capacidade de continuar avançando mesmo quando tudo parece perdido." },
  { name: "Anão", image: "/jogar/racas/anao.webp", description: "Resistentes e fortes, os Anões carregam uma tradição de forja, mineração, engenharia e combate. São conhecidos pela tenacidade e pela capacidade de suportar aquilo que derrubaria outros." },
  { name: "Elfo Cinzento", image: "/jogar/racas/elfo-cinzento.webp", description: "Ligados a armas ancestrais e antigas tradições, os Elfos Cinzentos desenvolvem um vínculo único com seu armamento. Suas armas carregam runas, memórias, juramentos e histórias de gerações.", source: manual },
  { name: "Elfo da Floresta", image: "/jogar/racas/elfo-floresta.webp", description: "Habitantes e guardiões das florestas antigas, os Elfos da Floresta possuem sentidos aguçados e uma percepção especial do ambiente. São excelentes exploradores, arqueiros e guerreiros ligados à natureza.", source: manual },
  { name: "Elfo Negro", image: "/jogar/racas/elfo-negro.webp", description: "Para os Elfos Negros, seus próprios impulsos podem se transformar em poder. Cada personagem escolhe seus Pecados e aprende a transformar essas características em habilidades únicas, sem que sua origem determine sua moralidade.", source: manual },
  { name: "Selvagem", image: "/jogar/racas/selvagem.webp", description: "Guiados por um instinto aguçado, os Selvagens possuem uma forte conexão com seus sentidos e com os perigos do ambiente. Suas comunidades existem em diferentes regiões e não seguem uma única cultura.", source: manual },
  { name: "Meio-Diabólico", image: "/jogar/racas/meio-diabolico.webp", description: "Descendentes de divindades do Polo Negativo, os Meio-Diabólicos carregam uma linhagem divina que se manifesta ao longo da vida. Essa herança não determina quem eles são nem o caminho que escolherão.", source: manual },
  { name: "Meio-Celestial", image: "/jogar/racas/meio-celestial.webp", description: "Herdeiros de divindades do Polo Positivo, os Meio-Celestiais carregam uma poderosa linhagem divina. Sua origem pode conceder manifestações extraordinárias, mas seu destino continua pertencendo a eles.", source: manual },
  { name: "Titã Elemental", image: "/jogar/racas/tita-elemental.webp", description: "Nascidos de diferentes clãs elementais, os Titãs Elementais manipulam seu elemento através da Dalva. Fogo, água, terra, raio e ar podem assumir inúmeras formas nas mãos de quem domina esse poder." },
  { name: "Nebuloso", image: "/jogar/racas/nebuloso.webp", description: "Algumas vidas começam quando um corpo recebe uma nova história. Os Nebulosos estabelecem uma relação única com seu Casco, assimilando características e construindo uma identidade própria ao redor dessa nova existência.", source: manual },
  { name: "Meio-Gigante", image: "/jogar/racas/meio-gigante.webp", description: "Há criaturas que utilizam armas. Um Meio-Gigante já nasceu sendo uma. Seu corpo colossal transforma força, resistência e os próprios punhos em instrumentos de combate capazes de enfrentar obstáculos enormes.", source: manual },
  { name: "Tiefling", image: "/jogar/racas/tiefling.webp", description: "Portadores de uma antiga herança infernal, os Tieflings manifestam características e poderes sobrenaturais que podem reaparecer através das gerações. Chifres, caudas e marcas variam, mas a herança não determina sua personalidade ou suas escolhas.", source: manual },
  { name: "Halfling", image: "/jogar/racas/halfling.webp", description: "Pequenos, rápidos e surpreendentemente difíceis de derrubar, os Halflings aprenderam a transformar tamanho, sorte e oportunidade em vantagens. Muitas vezes, aquilo que parece uma desvantagem é justamente sua maior arma." },
];
