const { getPool } = require('./pool')

async function query(sql, params = []) {
  const pool = getPool()
  const [rows] = await pool.query(sql, params)
  return rows
}

async function exec(sql, params = []) {
  const pool = getPool()
  const [res] = await pool.execute(sql, params)
  return res
}

module.exports = { query, exec }
