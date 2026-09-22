# Alvorecer Android

Camada Android nativa que abre o Alvorecer publicado na Vercel e mantém a galeria privada do Mestre sincronizada.

## Compilação

O workflow `Android APK` gera gratuitamente um APK de depuração. Quando o secret `GOOGLE_SERVICES_JSON_BASE64` existe no GitHub, a compilação inclui FCM silencioso. Sem esse arquivo, a fila continua sendo recuperada por WorkManager, abertura do aplicativo, retorno ao primeiro plano, rede disponível e reinício do aparelho, mas não recebe o despertar imediato do Firebase.

O arquivo `google-services.json` nunca deve ser commitado.

## Garantias da fila

- SQLite preserva o índice local da galeria.
- Supabase preserva as solicitações de original.
- `BOOT_COMPLETED` e `MY_PACKAGE_REPLACED` reprogramam os trabalhos.
- WorkManager repete trabalhos interrompidos quando rede e sistema permitem.
- Abrir ou retomar o aplicativo solicita execução imediata.
- O mesmo pedido possui um ID único e não cria solicitações ativas duplicadas.
- Não existe notificação visual para a galeria.
