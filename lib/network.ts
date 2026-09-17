type ReadResult = {
  error: unknown;
};

const fetchFailurePattern =
  /(?:failed to fetch|fetch failed|networkerror|network request failed|load failed)/i;

export function isTransientFetchFailure(error: unknown) {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
  return fetchFailurePattern.test(message);
}

export function readableErrorMessage(error: unknown) {
  if (isTransientFetchFailure(error))
    return "A conexão oscilou e não foi possível atualizar os dados. O sistema tentará novamente automaticamente.";
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return String(error || "Erro inesperado");
}

export async function retryNetworkRead<T extends ReadResult>(
  operation: () => PromiseLike<T>,
  retries = 2,
  delayMs = 350,
): Promise<T> {
  let response = await operation();
  for (
    let attempt = 0;
    attempt < retries && isTransientFetchFailure(response.error);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** attempt));
    response = await operation();
  }
  return response;
}
