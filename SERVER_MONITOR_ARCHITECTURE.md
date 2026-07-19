# 服务器状态面板技术说明

## 用途

在停车管理面板的第二个卡片中展示 `192.168.1.100` 的最新服务器状态，包括连通性、推断的系统类型、端口、Ping、检测时间与最近状态变更时间。

## 架构

```text
Andy 本机计划任务（每分钟）
  ├─ 检测服务器：Ping、SSH 22、RPC 135、SMB 445、RDP 3389
  ├─ 本地更新 last-state.json 与 monitor.log
  ├─ 需要时直接通过 SMTP 发送邮件
  └─ HTTPS + HMAC 上报最新状态
                 ↓
Cloudflare Worker（forcloudflare）
  ├─ 校验 HMAC 签名
  └─ 写入 Workers KV：SERVER_STATUS / latest
                 ↓
网页第二面板 GET /api/server-status 并渲染
```

## 职责边界

### Andy 本机监控器

文件：`D:\myApps\ServerMonitor\andy_server_monitor.py`

- 由 Windows 计划任务 `AndyServerMonitor` 使用 `pythonw.exe` 每分钟后台运行。
- 负责所有实际检测、状态持久化、离线确认、系统切换判断与邮件通知。
- SMTP 凭据与 Worker 上报密钥都保存为当前 Windows 用户的 DPAPI 凭据文件，不保存明文密码或密钥。
- 上报失败不会阻止本地检测或邮件通知。

### Cloudflare Worker

- 只接收已经完成的检测结果，不会主动连接局域网服务器，也不会读取 Andy 本机日志或文件。
- `POST /api/server-report`：校验 HMAC 后把最新数据写入 KV。
- `GET /api/server-status`：从 KV 读取最新数据供网页使用；超过三分钟未更新时显示 `STALE`。
- 不参与 SMTP 发信，因此 Worker 部署、KV 故障或网页故障不会替代或关闭本机邮件通知。

## 配置和密钥

- Worker KV 绑定：`SERVER_STATUS`。
- Worker Secret：`INGEST_HMAC_KEY`，只能在 Cloudflare 的 Variables and Secrets 中作为 Secret 保存。
- 本机 DPAPI 密钥文件：`D:\myApps\ServerMonitor\web-report-credential.xml`。
- 本机上报地址：`https://winbtu.xyz/api/server-report`。
- 不要将 `INGEST_HMAC_KEY`、SMTP 授权码、任何 `*-credential.xml` 文件提交到 Git。

## 验证方法

1. 检查本机日志 `D:\myApps\ServerMonitor\monitor.log` 是否出现 `Cloudflare Worker 上报成功`。
2. 访问 `https://winbtu.xyz/api/server-status`，应返回 `source: worker-kv` 与最新状态 JSON。
3. 打开 `https://winbtu.xyz`，第二个面板应显示“服务器状态”。
4. 邮件链路独立测试：

   ```powershell
   python "D:\myApps\ServerMonitor\andy_server_monitor.py" --test-email
   ```

   此命令只发送测试邮件，不修改 `last-state.json`，也不影响后续切换告警。
