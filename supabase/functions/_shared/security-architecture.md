# Security entrypoints

- Every edge entrypoint wraps its unchanged handler with `withAccessLog`; persistence is asynchronous, excludes credentials/body/query token values, and has indefinite retention.
- New strict guards require a verified staff JWT or the exact service Authorization plus internal secret. Uncertain integration callers remain log-only pending a traced migration to avoid interrupting gateways, messaging and cron.
- Administrative action records identify authenticated callers server-side; anonymous/internal actions are never attributed to a guessed user. Browser login/logout claims are audit observations, not authoritative authentication-provider events.