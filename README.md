## tt-miniapp-server（生产版：MySQL 持久化）

### 能力范围

- **登录**：`/api/auth/login`（服务端调用 code2session，签发 token，落库）
- **用户设置**：`/api/users/me`（戒烟日期/地区/性别/烟价/支数…）
- **打卡**：`/api/checkins`（按日期唯一，支持最近 7 天）
- **同日戒烟群组**：quit_date 作为 `group_key`，支持帖子/评论/收藏
- **好友群组（自建）**：当前用“已注册用户排行 + 关注”实现，可替换为抖音开放平台关系链能力

> 注意：抖音开放平台的“账号数据授权”需要小程序端 `tt.showDouyinOpenAuth`；本后端提供的是你自建社交关系/数据持久化层。

### 环境变量

- `PORT`：服务端口（默认 8787）
- `MODE`：`mock|prod`
- `DOUYIN_APPID` / `DOUYIN_SECRET`：**仅 prod** 需要
- `IS_SANDBOX`：`1` 沙盒(`open-sandbox.douyin.com`)，`0` 生产(`developer.toutiao.com`)
- `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`

示例见 `.env.example`

### 本地启动（docker-compose）

在本目录执行：

```bash
docker compose up --build
```

会自动：
- 启动 MySQL
- 执行迁移 `node scripts/migrate.js`
- 启动 API `node index.js`

### 手动迁移

```bash
npm run migrate
```

### 火山云部署建议（简版）

- **MySQL**：建议使用火山云 RDS MySQL（或 VKE + MySQL，但更推荐 RDS）
- **API**：用镜像部署到火山引擎容器服务（VKE/镜像仓库），配置环境变量指向 RDS
- **健康检查**：访问 `GET /health`（会 ping DB）
- **敏感信息**：`DOUYIN_SECRET`、`DB_PASSWORD` 用密钥/环境变量注入，不进镜像与仓库
