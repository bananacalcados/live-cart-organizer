/** Busca de comentários da live: sem depender de acento, maiúscula ou espaços duplicados. */

export const normalizeSearch = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

export interface CommentSearchFields {
  username: string;
  comment_text: string;
}

const cleanHandle = (h: string) => (h || "").replace(/^@/, "").trim().toLowerCase();

/**
 * "@fulano" procura só no @ do Instagram.
 * Qualquer outro texto procura no @ e no que a cliente escreveu.
 */
export const matchesSearch = (c: CommentSearchFields, term: string) => {
  if (!term) return true;
  const handle = cleanHandle(c.username);
  if (term.startsWith("@")) return handle.includes(term.slice(1));
  return handle.includes(term) || normalizeSearch(c.comment_text).includes(term);
};
