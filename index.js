const { config } = require('./src/config')
const { createApp } = require('./src/server')
const { startDailyCron } = require('./src/cron/dailyCheckinPenalty')

const app = createApp()

app.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[tt-miniapp-server] listening on ${config.PORT}, MODE=${config.MODE}`)
  
  // 启动定时任务
  startDailyCron()
})
