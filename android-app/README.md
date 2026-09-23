# Alvorecer Android

Camada Android nativa que abre o Alvorecer publicado na Vercel e mantém a galeria privada do Mestre sincronizada.

## Compilação

O workflow `Android APK` gera gratuitamente um APK de depuração. Quando o secret `GOOGLE_SERVICES_JSON_BASE64` existe no GitHub, a compilação inclui FCM silencioso. Sem esse arquivo, a fila continua sendo recuperada por WorkManager, abertura do aplicativo, retorno ao primeiro plano, rede disponível e reinício do aparelho, mas não recebe o despertar imediato do Firebase.

O arquivo `google-services.json` nunca deve ser commitado.

Para habilitar o aviso ao celular em segundo plano quando um original for solicitado, configure
o secret `GOOGLE_SERVICES_JSON_BASE64` nas Actions deste repositório e as variáveis
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` na Edge
Function do Supabase. A compilação avisa quando o arquivo Android estiver
ausente. Mesmo com Firebase, a entrega pode atrasar por economia de bateria.
Sem essa configuração, abra o Alvorecer no aparelho para consultar o
pedido imediatamente; a consulta periódica em segundo plano tem intervalo
mínimo de 15 minutos e pode atrasar por economia de bateria do Android.

## Garantias da fila

- SQLite preserva o índice local da galeria.
- Supabase preserva as solicitações de original.
- `BOOT_COMPLETED` e `MY_PACKAGE_REPLACED` reprogramam os trabalhos.
- WorkManager repete trabalhos interrompidos quando rede e sistema permitem.
- Abrir ou retomar o aplicativo solicita execução imediata.
- O mesmo pedido possui um ID único e não cria solicitações ativas duplicadas.
- Não existe notificação visual para a galeria.
