# Shy2Speak

面向 PC 与 Mobile 的英语口语练习 PWA。当前版本包含 YouTube 主题/章节/逐句练习、浏览器录音、学习数据统计、生词复习、磨耳朵、AI 服务设置，以及完全自托管的账号与学习同步服务。

## 架构

- `app`：Node.js 服务，同源提供 PWA 与 `/api`。
- `database`：PostgreSQL 17，保存用户、唯一昵称、会话、学习状态和主题/章节/句子快照。
- 浏览器继续本地优先保存；登录后同步到 NAS。Supabase 不再是运行依赖。
- 密码使用 Node.js `scrypt` 哈希；访问令牌 15 分钟过期，刷新令牌只以 SHA-256 哈希形式入库。

## 本机 Docker 启动

```bash
cp .env.example .env
# 编辑 .env，至少替换 POSTGRES_PASSWORD 与 AUTH_SECRET
docker compose up -d --build
curl http://127.0.0.1:8080/api/health
```

浏览器打开 `http://127.0.0.1:8080`。数据库自动迁移，数据保存在 `shy2speak-postgres` Docker 卷。

可用以下命令生成密钥：

```bash
openssl rand -hex 32
```

数据库密码与 `AUTH_SECRET` 应分别生成，且不要提交 `.env`。

## 绿联 NAS Docker 部署

`compose.ugreen.yml` 是不依赖 `.env` 的单文件直配模板，适合在绿联 Docker「项目 / Compose」界面粘贴。镜像工作流会发布 x86_64 与 ARM64 两种架构到：

```text
ghcr.io/chaoclaw/shy2speak:edge
```

部署步骤：

1. 打开 `compose.ugreen.yml`，分别将文件顶部的 `CHANGE_ME_DATABASE_PASSWORD` 和 `CHANGE_ME_WITH_RANDOM_AUTH_SECRET_AT_LEAST_32_CHARS` 替换为两组不同的随机值；可分别执行一次 `openssl rand -hex 32` 生成。
2. 在绿联 Docker 中新建 Compose 项目，粘贴修改后的完整文件；不需要再配置项目环境变量。端口默认是 `8080`，如有冲突只修改 `ports` 中冒号左侧的数字。
3. 启动项目，等待 `database` 变为 healthy、`app` 变为 running。
4. 打开 `http://NAS局域网IP:8080`；Docker 页面部署会自动使用同源 API，无需再填写数据库地址或浏览器密钥。

请勿把已经填写真实密码和密钥的副本提交到 Git；仓库只保存占位符模板。

浏览器麦克风与完整 PWA 安装要求安全上下文。局域网首次检查可使用 HTTP；正式使用录音时，请在绿联反向代理中为该容器配置 HTTPS 域名和证书。

如 GHCR 镜像尚未设为公开，需在绿联镜像仓库中登录 `ghcr.io`，或把本仓库克隆到 NAS 后使用 `compose.yml` 本地构建。

更新版本：

```bash
docker compose -f compose.ugreen.yml pull
docker compose -f compose.ugreen.yml up -d
```

备份数据库：

```bash
docker compose -f compose.ugreen.yml exec -T database pg_dump -U shy2speak shy2speak > shy2speak-backup.sql
```

## 邮件与短信

邮箱/手机号均支持密码注册与登录。验证码和邮箱找回需要相应发送渠道：

- 邮件：配置 `SMTP_HOST`、`SMTP_FROM`，以及服务商要求的 `SMTP_USER`、`SMTP_PASSWORD`。
- 短信：配置 `SMS_WEBHOOK_URL`；服务会 POST `{to, message, purpose}`。如网关需要 Bearer Token，再配置 `SMS_WEBHOOK_TOKEN`。

未配置渠道时，界面会明确提示，不会显示虚假的“发送成功”。

## 数据与服务边界

- 视频使用 `youtube-nocookie.com` 官方嵌入播放器，不重新分发受版权保护的视频或音频。
- `data/catalog.json` 保存课程结构。逐句稿会标记来源；未获得公开视频字幕时仍显示“待核对”，不会冒充准确字幕。
- 麦克风录音使用浏览器 `MediaRecorder`。只有配置真实评分端点并返回完整评分后，才保存 AI 分数。
- AI Key 只保存在当前浏览器标签页；生产环境后续可把指定厂商调用迁移到 NAS API 代理。
- GitHub Pages 仅作为离线 UI 预览；完整注册登录与同步请使用 Docker 地址。

## 开发与测试

```bash
npm ci
npm run check
python3 scripts/sync_youtube_captions.py --self-test
node tests/data-contract.cjs
node tests/backend-contract.cjs
node tests/ui-smoke.cjs
```

完整容器验证：

```bash
POSTGRES_PASSWORD=test-password AUTH_SECRET=test-secret-with-at-least-32-characters docker compose up -d --build
curl http://127.0.0.1:8080/api/health
docker compose down
```

详见 `docs/acceptance-cases.md`。
