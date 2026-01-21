const fs = require('fs')
const path = require('path')
const { getPool } = require('../src/db/pool')

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitForDb(pool, { timeoutMs = 60000, intervalMs = 1000 } = {}) {
  const start = Date.now()
  // eslint-disable-next-line no-console
  console.log('[migrate] waiting for mysql...')

  while (true) {
    try {
      const conn = await pool.getConnection()
      try {
        await conn.query('SELECT 1')
        // eslint-disable-next-line no-console
        console.log('[migrate] mysql is ready')
        return
      } finally {
        conn.release()
      }
    } catch (e) {
      if (Date.now() - start > timeoutMs) {
        // eslint-disable-next-line no-console
        console.error('[migrate] mysql not ready, last error:', e.message || e)
        throw e
      }
      await sleep(intervalMs)
    }
  }
}

function splitSqlStatements(sqlText) {
  // 1) 去掉 "--" 行注释（保留语句内容）
  const withoutLineComments = sqlText
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')

  // 2) 按分号切分（本项目迁移文件不包含存储过程/触发器等复杂语句）
  return withoutLineComments
    .split(/;\s*\n|;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function main() {
  const pool = getPool()
  await waitForDb(pool)

  const dir = path.join(__dirname, '..', 'migrations')
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        filename VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_filename (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `)

    const [appliedRows] = await conn.query('SELECT filename FROM schema_migrations')
    const applied = new Set(appliedRows.map((r) => r.filename))

    for (const f of files) {
      if (applied.has(f)) continue

      const sql = fs.readFileSync(path.join(dir, f), 'utf-8')
      const stmts = splitSqlStatements(sql)

      for (const stmt of stmts) {
        try {
          await conn.query(stmt)
        } catch (e) {
          // 如果列或索引已存在，忽略错误（允许重复执行迁移）
          if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_DUP_KEYNAME') {
            console.log(`[migrate] Column/index already exists, skipping: ${e.sqlMessage}`)
            continue
          }
          // 如果外键不存在，忽略错误（允许重复执行迁移）
          if (e.code === 'ER_CANT_DROP_FIELD_OR_KEY' || e.code === 'ER_DROP_INDEX_FK' || (e.message && e.message.includes('Unknown key'))) {
            console.log(`[migrate] Foreign key does not exist, skipping: ${e.sqlMessage}`)
            continue
          }
          // MySQL 不支持 DROP FOREIGN KEY IF EXISTS 语法，需要先检查是否存在再删除
          if (e.code === 'ER_PARSE_ERROR' && e.sqlMessage && e.sqlMessage.includes('IF EXISTS')) {
            console.log(`[migrate] SQL syntax not supported (IF EXISTS), skipping: ${e.sqlMessage}`)
            continue
          }
          throw e
        }
      }

      await conn.query('INSERT INTO schema_migrations(filename) VALUES(?)', [f])
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${f}`)
    }

    await conn.commit()
    // eslint-disable-next-line no-console
    console.log('[migrate] done')
  } catch (e) {
    await conn.rollback()
    // eslint-disable-next-line no-console
    console.error('[migrate] failed:', e)
    process.exitCode = 1
  } finally {
    conn.release()
    await pool.end()
  }
}

main()
