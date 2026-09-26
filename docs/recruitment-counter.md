# Contador público de recrutamento

O aviso em `/jogar` soma jogadores ativos cadastrados na campanha, inscrições recebidas e dez participantes reais sem conta confirmados pelo Mestre. A base fica em `RECRUITMENT_OFFLINE_PLAYERS`; deve diminuir se esses participantes criarem contas. O texto distingue jogadores e inscrições: não representa vagas ocupadas ou candidatos aprovados.

A atualização ocorre a cada 60 segundos enquanto a página está visível, ao voltar à aba e depois de enviar o formulário. Fechar mantém o aviso oculto durante a sessão da aba. O aviso também fica oculto enquanto o formulário está na tela. Falhas de consulta não exibem uma contagem inventada.

`public_recruitment_counts()` expõe apenas dois totais da campanha fixa, sem argumentos, identificadores ou respostas. A função usa `SECURITY DEFINER` e `search_path` vazio para não conceder acesso às tabelas privadas. Os avisos do advisor sobre execução anônima/autenticada são intencionais para esse agregado público; não há alteração de RLS ou concessão de SELECT nas inscrições. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

Validação: build de produção, testes do endpoint (soma, atualização, campos extras e falhas), permissões da função e da tabela privada.
