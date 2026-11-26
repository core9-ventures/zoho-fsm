export type Statement = { sql: string; params?: (string | number | null)[] };

/** What the rest of the app needs from the phone database (the SQLite plugin implements it on the phone). */
export type Db = {
  /** Runs SQL that returns nothing (tables, deletes). */
  exec: (sql: string) => Promise<void>;
  /** Several statements in one transaction: all of them happen, or none. */
  batch: (statements: Statement[]) => Promise<void>;
  /** Rows of a SELECT. */
  all: <T = Record<string, unknown>>(sql: string, params?: (string | number | null)[]) => Promise<T[]>;
};
