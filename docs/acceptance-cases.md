# Shy2Speak 需求用例与自测基线

本文件区分“当前已实现”“需要用户设备验证”和“已接入但需要外部服务配置”，避免把演示状态误报为真实能力。

## 自动化验收

| 编号 | 场景 | 预期结果 | 自动化 |
| --- | --- | --- | --- |
| UI-01 | PC 打开 Practice | 视频与逐句跟读在同一卡片左右并排，无横向溢出 | `tests/ui-smoke.cjs` |
| UI-02 | Mobile 打开 Practice | 本章内容、预习、视频、逐句跟读依次排列；视频与英文上下相邻 | `tests/ui-smoke.cjs` |
| DATA-01 | 加载课程目录 | 播放列表、主题、章节、句子符合数据契约，ID 与时间段不重复 | `tests/data-contract.cjs` |
| DATA-02 | 加载 YouTube | 用户点击播放后挂载官方隐私增强播放器；运行时元数据可更新标题与频道 | `tests/ui-smoke.cjs`（网络夹具） |
| DATA-03 | 处理实际逐句字幕 | 授权环境读取公开视频英文字幕轨，优先人工字幕，其次自动字幕；按自然停顿生成不重叠句子并归入实际公开视频章节；未同步时界面明确标记待核对 | `scripts/sync_youtube_captions.py --self-test` |
| NAV-01 | 切换所有主页面 | 8 个页面均能激活，URL 与导航状态一致 | `tests/ui-smoke.cjs` |
| AUTH-01 | 选择手机号登录 | 邮箱与手机号先选方式，手机号使用独立 `tel` 输入 | `tests/ui-smoke.cjs` |
| AUTH-02 | 连接账号服务 | 填入绿联 NAS 地址后检查自托管 API 与 PostgreSQL；不需要浏览器数据库 Key | `tests/ui-smoke.cjs`（网络夹具） |
| AUTH-03 | 登录与同步 | 邮箱密码登录成功后写入学习状态与范围快照，并读取 NAS 资料 | `tests/ui-smoke.cjs`（网络夹具）+ `tests/api-integration.mjs`（真实容器） |
| AUTH-04 | 数据与安全契约 | 昵称大小写不敏感且全局唯一；密码用 scrypt；刷新令牌哈希入库；镜像以非 root 用户运行 | `tests/backend-contract.cjs` |
| DEPLOY-01 | 绿联 Docker 部署 | Compose 启动应用与 PostgreSQL，数据库 healthy 后 API 可用，重启后账号与学习数据仍存在 | Docker 集成测试 |
| AI-01 | 未配置 AI | 页面明确显示“待配置”，不显示虚假的连接成功 | `tests/ui-smoke.cjs` |
| A11Y-01 | Mobile 底部导航 | 无横向溢出，触控区域至少 44px，图标均有可访问名称 | `tests/ui-smoke.cjs` |
| PWA-01 | 离线重载 | Service Worker 缓存应用外壳与课程目录，断网刷新后概览仍可使用 | `tests/ui-smoke.cjs` |

## 设备与人工验收

| 编号 | 场景 | 操作 | 预期结果 |
| --- | --- | --- | --- |
| MIC-01 | 首次录音 | 在 HTTPS 页面点击“按住跟读”并允许麦克风 | 显示真实设备名称与声道；结束后显示真实时长与文件大小；立即释放麦克风 |
| MIC-02 | 拒绝权限 | 拒绝麦克风权限 | 明确提示到浏览器权限设置开启，不生成虚假分数 |
| YT-01 | 官方视频播放 | 在可访问 YouTube 的网络点击播放 | 使用 `youtube-nocookie.com` 官方嵌入播放器，并携带播放列表 ID |
| THEME-01 | 外观切换 | 切换日间/夜间及五种颜色主题 | 所有页面文字、卡片和控件保持可读；设置持久化 |
| LANG-01 | 语言与释义语言 | 切换中/英文界面及生词释义语言 | 两者互不混淆；英语原文不随释义语言改变 |
| AUDIO-01 | 导入本地音频 | 选择受支持的本地音频 | 从真实文件读取文件名、大小、类型和时长，不上传即能预览元数据 |
| AUDIO-02 | 课程磨耳朵 | 打开磨耳朵、播放课程音轨并调整顺序 | 加载 85 个真实主题；优先使用最低带宽纯音频流；显示音乐播放器与同步滚动歌词；与视频练习互斥；拖动顺序持久化 | `tests/ui-smoke.cjs`、`tests/backend-contract.cjs` |
| API-01 | 配置模型 | 输入真实 OpenAI-compatible 地址与 Key 并测试 | 发出真实 `/models` 请求；仅测试成功后显示“已验证”；Key 只保存在当前标签页 |
| API-02 | 配置语音评分 | 输入兼容评分端点与 Key，先以 GET 验证健康状态，再完成一次录音 | POST 上传音频与参考文本；仅在返回完整评分字段后写入句子/小节历史分数 |
| PPT-01 | AI 生成课件 | 配置兼容的转写与聊天模型，导入本地音频后生成 | 依次调用转写和聊天接口，解析 JSON Slide 并更新预览；错误不伪装成功 |

## 已接入但需要外部项目配置的用例

- 邮箱/手机号密码注册、登录与跨设备同步：由 NAS 中的 Shy2Speak API 和 PostgreSQL 提供，不依赖 Supabase。
- 验证码与密码找回：邮件需要 SMTP，短信需要 webhook 网关；未配置时服务返回明确错误。
- 全站唯一昵称：PostgreSQL 使用 `citext unique`；服务端事务处理并发冲突。
- 学习数据同步：本机优先记录，登录后同步完整状态，并按主题、小节、句子写入独立快照；所有查询从访问令牌解析用户 ID，不接受客户端指定其他用户。
- 发音 AI 评分：当前真实录音可用，但只有接入供应商评分接口后才保存真实分数。
- YouTube 官方字幕、章节和完整播放列表枚举：需要 YouTube Data API/授权字幕服务；当前视频本身为真实官方嵌入，练习稿明确标记“待核对”。
- 受版权保护视频下载：不实现绕过平台限制的下载；仅允许缓存用户自有或明确授权媒体。

## 运行自测

```bash
node tests/data-contract.cjs
node tests/backend-contract.cjs
node tests/ui-smoke.cjs
```
