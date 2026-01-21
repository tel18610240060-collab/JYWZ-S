require('dotenv').config()

function env(name, def = '') {
  const v = process.env[name]
  return v == null || v === '' ? def : v
}

const config = {
  NODE_ENV: env('NODE_ENV', 'development'),
  PORT: Number(env('PORT', '8787')),
  MODE: env('MODE', 'mock'), // mock | prod

  // Douyin code2session
  DOUYIN_APPID: env('DOUYIN_APPID', ''),
  DOUYIN_SECRET: env('DOUYIN_SECRET', ''),
  IS_SANDBOX: env('IS_SANDBOX', '1'),

  // MySQL
  DB_HOST: env('DB_HOST', '127.0.0.1'),
  DB_PORT: Number(env('DB_PORT', '3306')),
  DB_USER: env('DB_USER', 'root'),
  DB_PASSWORD: env('DB_PASSWORD', 'root'),
  DB_NAME: env('DB_NAME', 'quit_smoking_king'),
  DB_CONN_LIMIT: Number(env('DB_CONN_LIMIT', '10')),

  // session
  SESSION_TTL_DAYS: Number(env('SESSION_TTL_DAYS', '30')),

  // douyin relation chain (not always publicly available; keep fallback enabled)
  ENABLE_DOUYIN_RELATION: env('ENABLE_DOUYIN_RELATION', '0') // 0|1
}

module.exports = { config }
