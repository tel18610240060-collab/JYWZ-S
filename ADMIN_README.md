# 管理后台使用说明

## 一、数据库管理工具（Adminer）

### 访问地址
- **URL**: http://localhost:8081
- **服务器**: `mysql`
- **用户名**: `root`
- **密码**: `root`
- **数据库**: `quit_smoking_king`

### 功能特性
- ✅ 查看和管理所有数据库表
- ✅ 执行SQL查询
- ✅ 修改表结构（添加/删除字段、修改索引）
- ✅ 查看和编辑数据
- ✅ 导入/导出数据（SQL、CSV格式）
- ✅ 管理数据库用户和权限

### 使用步骤
1. 打开浏览器访问 http://localhost:8081
2. 在登录页面输入：
   - 系统：选择 `MySQL`
   - 服务器：`mysql`
   - 用户名：`root`
   - 密码：`root`
   - 数据库：`quit_smoking_king`
3. 点击"登录"即可进入数据库管理界面

## 二、管理后台系统

### 访问地址
- **登录页**: http://localhost:8787/admin/login.html
- **管理后台**: http://localhost:8787/admin/index.html

### 默认密码
- 默认密码：`admin123`
- 可通过环境变量 `ADMIN_PASSWORD` 修改

### 功能模块

#### 1. 仪表盘
- 总体统计（用户数、打卡数、帖子数等）
- 段位分布图表
- 用户增长趋势图

#### 2. 用户管理
- 用户列表（支持分页）
- 搜索功能（昵称、OpenID）
- 段位筛选
- 查看用户详情
- 编辑用户信息（昵称、戒烟日期、累计天数等）
- 删除用户
- 查看用户打卡记录
- 查看用户帖子

#### 3. 打卡管理
- 打卡记录列表
- 按日期范围筛选
- 查看打卡详情（心情、笔记、图片）
- 删除打卡记录

#### 4. 内容管理
- 帖子列表
- 查看帖子详情
- 删除帖子
- 评论列表
- 删除评论

#### 5. 数据统计
- 同日戒烟统计
- 按戒烟日期统计用户数、失败数、幸存数
- 平均打卡天数

#### 6. 系统管理
- 数据导出（用户、打卡、帖子）
- 支持JSON和CSV格式
- 抖音开放平台token管理

### API接口文档

所有API接口都需要在请求头中携带管理员token：
```
X-Admin-Token: <your_token>
```

#### 认证接口
- `POST /api/admin/auth/login` - 管理员登录
- `POST /api/admin/auth/logout` - 登出
- `GET /api/admin/auth/me` - 当前管理员信息

#### 用户管理
- `GET /api/admin/users` - 用户列表（支持分页、搜索、筛选）
- `GET /api/admin/users/:id` - 用户详情
- `PUT /api/admin/users/:id` - 更新用户信息
- `DELETE /api/admin/users/:id` - 删除用户
- `GET /api/admin/users/:id/checkins` - 用户打卡记录
- `GET /api/admin/users/:id/posts` - 用户帖子

#### 打卡管理
- `GET /api/admin/checkins` - 打卡记录列表
- `GET /api/admin/checkins/:id` - 打卡详情
- `DELETE /api/admin/checkins/:id` - 删除打卡记录

#### 内容管理
- `GET /api/admin/posts` - 帖子列表
- `GET /api/admin/posts/:id` - 帖子详情
- `DELETE /api/admin/posts/:id` - 删除帖子
- `GET /api/admin/comments` - 评论列表
- `DELETE /api/admin/comments/:id` - 删除评论

#### 数据统计
- `GET /api/admin/stats/overview` - 总体统计
- `GET /api/admin/stats/ranks` - 段位分布
- `GET /api/admin/stats/same-day` - 同日戒烟统计
- `GET /api/admin/stats/trends` - 趋势数据

#### 系统管理
- `GET /api/admin/system/douyin-tokens` - 抖音token列表
- `POST /api/admin/system/export` - 数据导出

## 三、配置说明

### 修改管理员密码

在 `docker-compose.yml` 或 `.env` 文件中添加：
```yaml
environment:
  ADMIN_PASSWORD: your_secure_password
```

或在启动时设置环境变量：
```bash
ADMIN_PASSWORD=your_password docker-compose up
```

### 修改数据库管理工具端口

编辑 `docker-compose.yml`：
```yaml
adminer:
  ports:
    - "8082:8080"  # 修改左侧端口号
```

## 四、安全建议

1. **生产环境**：
   - 修改默认管理员密码
   - 使用HTTPS
   - 限制管理后台访问IP
   - 定期备份数据库

2. **数据库管理工具**：
   - 生产环境建议移除或限制访问
   - 使用防火墙限制访问IP
   - 使用强密码

3. **API安全**：
   - Token有效期24小时
   - 使用HTTPS传输
   - 定期轮换密码

## 五、常见问题

### Q: 忘记管理员密码怎么办？
A: 可以通过环境变量 `ADMIN_PASSWORD` 重置，或直接修改代码中的默认密码。

### Q: 数据库管理工具无法连接？
A: 检查：
1. MySQL服务是否正常运行
2. 服务器名称是否正确（应为 `mysql`）
3. 用户名密码是否正确（root/root）

### Q: 管理后台页面404？
A: 确保：
1. API服务正常运行
2. 文件已正确复制到容器内
3. 静态文件路径正确

### Q: API返回401未授权？
A: 检查：
1. 是否已登录并获取token
2. 请求头是否包含 `X-Admin-Token`
3. Token是否过期（24小时）

## 六、开发说明

### 文件结构
```
tt-miniapp-server/
├── src/
│   ├── middleware/
│   │   └── adminAuth.js      # 管理员认证中间件
│   └── routes/
│       └── admin.js          # 管理后台API路由
├── public/
│   └── admin/
│       ├── index.html        # 管理后台主页面
│       ├── login.html         # 登录页面
│       ├── css/
│       │   └── admin.css     # 样式文件
│       └── js/
│           ├── api.js        # API封装
│           └── admin.js      # 主逻辑
└── docker-compose.yml        # 包含adminer服务
```

### 扩展功能

如需添加新功能：
1. 在 `src/routes/admin.js` 中添加API路由
2. 在 `public/admin/js/api.js` 中添加API调用方法
3. 在 `public/admin/js/admin.js` 中添加前端逻辑
4. 在 `public/admin/index.html` 中添加页面元素
