# Repository-only database records
- Re-presenting a product manually always clears stopped_at, because panel and overlay exclude stopped rows even when is_current is true.
- SQL in this directory is documentary, not journaled migration history; preserve production pg_get_functiondef verbatim and never execute it against production during a repository-only recording task.
- Run the presentation regression with `bash src/test/runLiveShownReappear.sh`; it uses an isolated PostgreSQL cluster, synthetic dependencies and ROLLBACK, never real event data.