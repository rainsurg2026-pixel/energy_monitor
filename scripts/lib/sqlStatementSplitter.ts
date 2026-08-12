/**
 * Splits a migration file's raw SQL text into individual top-level statements,
 * respecting PostgreSQL lexical rules that a naive `sql.split(";")` breaks:
 * single/double-quoted strings (with doubled-quote escaping), line comments,
 * nestable block comments, and dollar-quoted bodies ($$...$$ / $tag$...$tag$),
 * inside which every character - including further quotes and semicolons -
 * is opaque text. This is what DO $$ ... $$ blocks and PL/pgSQL function
 * bodies rely on, and what a plain split-on-";" cannot tell apart from a
 * real statement boundary.
 *
 * Known limitation, inherited from Postgres itself: a dollar-quoted body
 * that contains its own delimiter text as a literal substring (e.g. a body
 * quoted with $$ that itself contains the two characters "$$") would close
 * early. None of this repository's migrations do that - every DO block here
 * uses a single, non-nested dollar-quote - so this is not exercised in
 * practice, but it is a real edge the caller should be aware of.
 */
export interface SqlStatement {
  text: string;
  /** 0-based offset of the statement's first non-whitespace character in the source. */
  start: number;
  /** 0-based offset, exclusive, of the statement's terminating ";" (or source end). */
  end: number;
}

const DOLLAR_TAG_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

export function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  const n = sql.length;
  let i = 0;
  let statementStart = -1;

  const markStart = (index: number): void => {
    if (statementStart === -1) statementStart = index;
  };

  while (i < n) {
    const ch = sql[i];

    if (ch === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }

    if (ch === "'") {
      markStart(i);
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    if (ch === '"') {
      markStart(i);
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }

    if (ch === "$") {
      const tagMatch = DOLLAR_TAG_RE.exec(sql.slice(i));
      if (tagMatch) {
        markStart(i);
        const delimiter = tagMatch[0];
        i += delimiter.length;
        const closeIndex = sql.indexOf(delimiter, i);
        i = closeIndex === -1 ? n : closeIndex + delimiter.length;
        continue;
      }
    }

    if (ch === ";") {
      if (statementStart !== -1) {
        const text = sql.slice(statementStart, i).trim();
        if (text.length > 0) statements.push({ text, start: statementStart, end: i });
      }
      statementStart = -1;
      i++;
      continue;
    }

    if (!/\s/.test(ch)) markStart(i);
    i++;
  }

  if (statementStart !== -1) {
    const text = sql.slice(statementStart, n).trim();
    if (text.length > 0) statements.push({ text, start: statementStart, end: n });
  }

  return statements;
}

/** Maps a PostgreSQL error's 1-based `position` (character offset into the submitted query text) to a statement index. Returns -1 if it falls outside every statement's range. */
export function statementIndexAtPosition(statements: readonly SqlStatement[], position: number): number {
  const offset = position - 1;
  for (let index = 0; index < statements.length; index++) {
    if (offset >= statements[index].start && offset <= statements[index].end) return index;
  }
  return -1;
}

export function previewStatement(text: string, maxLength = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}...` : collapsed;
}
