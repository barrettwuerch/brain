export function makeRag({ env, logger }) {
  if (env.RAG_PROVIDER === 'pgvector') {
    throw new Error('pgvector RAG not implemented yet (Phase 2). Set RAG_PROVIDER=none for MVP.');
  }
  return {
    async search(query) {
      void logger;
      return {
        ok: true,
        provider: 'none',
        query,
        results: [],
      };
    },
  };
}
