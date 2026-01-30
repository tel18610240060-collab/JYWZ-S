const mysql = require('mysql2/promise')
const { config } = require('../config')

let pool

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      waitForConnections: true,
      connectionLimit: config.DB_CONN_LIMIT,
      queueLimit: 0,
      timezone: 'Z',
      dateStrings: true
    })
  }
  return pool
}

async function ping() {
  const p = getPool()
  const conn = await p.getConnection()
  try {
    await conn.ping()
  } finally {
    conn.release()
  }
}

module.exports = { getPool, ping }
