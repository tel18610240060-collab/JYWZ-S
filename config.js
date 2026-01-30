function getEnv(name, def = '') {
  return process.env[name] == null || process.env[name] === '' ? def : process.env[name]
}

const config = {
  PORT: Number(getEnv('PORT', '8787')),
  MODE: getEnv('MODE', 'mock'), // mock | prod

  // 抖音小程序服务端登录（code2session）
  DOUYIN_APPID: getEnv('DOUYIN_APPID', ''),
  DOUYIN_SECRET: getEnv('DOUYIN_SECRET', ''),
  IS_SANDBOX: getEnv('IS_SANDBOX', '1') // 1=沙盒 open-sandbox.douyin.com；0=developer.toutiao.com
}

module.exports = { config }
