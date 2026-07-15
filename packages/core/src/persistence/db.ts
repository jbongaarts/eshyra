import Database from 'better-sqlite3';

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function withTransaction<T>(db: Db, fn: (db: Db) => T): T {
  const txn = db.transaction(fn);
  return txn(db);
}
