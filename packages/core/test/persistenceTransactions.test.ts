import { describe, expect, it } from 'vitest';
import { openDatabase, withTransaction } from '../src/persistence/db.js';

function dbWithValues() {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE value_log (value TEXT NOT NULL)');
  return db;
}

describe('withTransaction nested savepoints', () => {
  it('rolls back only a caught inner failure', () => {
    const db = dbWithValues();
    withTransaction(db, (outer) => {
      outer.prepare('INSERT INTO value_log VALUES (?)').run('A');
      try {
        withTransaction(outer, (inner) => {
          inner.prepare('INSERT INTO value_log VALUES (?)').run('B');
          throw new Error('inner failure');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
      outer.prepare('INSERT INTO value_log VALUES (?)').run('C');
    });
    expect(
      db.prepare('SELECT value FROM value_log ORDER BY rowid').all(),
    ).toEqual([{ value: 'A' }, { value: 'C' }]);
    db.close();
  });

  it('rolls back the outer transaction for an uncaught inner failure', () => {
    const db = dbWithValues();
    expect(() =>
      withTransaction(db, (outer) => {
        outer.prepare('INSERT INTO value_log VALUES (?)').run('A');
        withTransaction(outer, (inner) => {
          inner.prepare('INSERT INTO value_log VALUES (?)').run('B');
          throw new Error('inner failure');
        });
      }),
    ).toThrow('inner failure');
    expect(db.prepare('SELECT value FROM value_log').all()).toEqual([]);
    db.close();
  });
});
