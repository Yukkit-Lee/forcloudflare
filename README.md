# HainanU Parking & Server Dashboard

一个同时支持本地运行与 Cloudflare Workers 部署的轻量面板项目：

- 停车管理：查询车牌停车信息、生成缴费入口。
- 服务器状态：展示监控器上报的最新连通性、系统推断、端口、Ping 与状态变更时间。

线上地址：<https://winbtu.xyz>

## 架构

```text
本地浏览器 ──> Express（code/server.js） ──> 停车服务

Andy Windows 计划任务（每分钟）
  ├─ Ping + SSH 22 + RPC 135 + SMB 445 + RDP 3389
  ├─ 本地状态持久化、告警邮件
  └─ HTTPS/HMAC 上报
                   ↓
Cloudflare Worker（code/worker.js）──> Workers KV（SERVER_STATUS/latest）
                   ↓
              第二个服务器状态面板
```

Worker 只保存和读取最新状态，**不会**主动访问局域网服务器、读取本机文件或发送 SMTP 邮件。

为适配 Workers KV 免费额度，本机仍每分钟检测，但稳定状态仅每 120 秒上报一次；确认离线、恢复在线或系统切换会立即上报。线上数据超过五分钟未更新时显示 `STALE`。

## 目录说明

```text
code/
  dashboard.html              本地 Express 使用的页面
  server.js                   本地 Express 服务与停车代理
  worker.js                   Cloudflare Worker（含线上页面和 API）
  wrangler.toml               Worker 与 KV 绑定配置
  DEPLOY_SERVER_PANEL.md      服务器状态面板部署步骤
SERVER_MONITOR_ARCHITECTURE.md 监控器与 Worker 的技术说明
progress.txt                  历史开发记录
```

本机监控器部署在项目目录外：`D:\myApps\ServerMonitor`。

## 本地运行

需要 Node.js。

```powershell
cd code
npm install
npm start
```

默认访问地址为 `http://localhost:3000`。本地版的 `/api/server-status` 会直接读取 Andy 监控器生成的 `last-state.json`；可用环境变量 `SERVER_MONITOR_STATE_FILE` 覆盖文件路径。

## Cloudflare 部署

本项目使用一个 Cloudflare Worker：`forcloudflare`，以及一个 Workers KV 命名空间绑定：`SERVER_STATUS`。

GitHub 与 Cloudflare Workers 已连接时，推送 `main` 分支会自动部署。首次设置或修改绑定时，参考 [code/DEPLOY_SERVER_PANEL.md](code/DEPLOY_SERVER_PANEL.md)。

线上接口：

- `GET /api/health`：Worker 健康检查。
- `POST /api/server-report`：接收本机监控器的 HMAC 签名状态上报。
- `GET /api/server-status`：返回 KV 中的最新服务器状态。

## 服务器监控与告警

监控器每分钟检测一次目标服务器：

| 检测项 | 端口/协议 | 用途 |
| --- | --- | --- |
| ICMP | Ping | 辅助判断主机是否可达 |
| SSH | TCP 22 | Linux 系统的重要特征 |
| RPC | TCP 135 | Windows 服务特征 |
| SMB | TCP 445 | Windows 文件服务特征 |
| RDP | TCP 3389 | Windows 远程桌面特征 |

邮件由 Andy 本机直接发送，Cloudflare 不参与：

- 连续 **3 次**（约 3 分钟）Ping 和全部配置端口均不可达：发送 **OFFLINE** 邮件。
- 已确认 OFFLINE 后任意检测重新可达：发送 **ONLINE recovery** 邮件。
- 已知 Linux 状态切换到 Windows：发送 Windows 进入通知。
- 已知 Windows 状态切换到 Linux：发送 Linux 进入通知。
- 邮件发送失败时，相应通知会保留为待发送并在后续周期重试；成功后清除待发送状态，避免重复告警。

系统类型基于开放端口的特征推断，不等价于登录操作系统后读取的系统信息。例如 SSH 可达且 RDP 不可达时判为 `LINUX_LIKELY`。

详细说明见 [SERVER_MONITOR_ARCHITECTURE.md](SERVER_MONITOR_ARCHITECTURE.md)。

## 安全与密钥

以下内容绝不能提交到 Git：

- SMTP 授权码。
- Cloudflare `INGEST_HMAC_KEY`。
- `smtp-credential.xml`、`web-report-credential.xml` 等 DPAPI 凭据文件。

Cloudflare 端将 `INGEST_HMAC_KEY` 配置为 Worker Secret；Andy 本机使用同一个值创建 DPAPI 凭据文件。上报内容通过 HTTPS 传输并以 HMAC-SHA256 签名。

## 验证

检查线上状态接口：

```powershell
Invoke-WebRequest https://winbtu.xyz/api/server-status -UseBasicParsing
```

测试本机 SMTP（只发送测试邮件，不改状态文件）：

```powershell
python "D:\myApps\ServerMonitor\andy_server_monitor.py" --test-email
```

检查本机上报日志：

```powershell
Get-Content "D:\myApps\ServerMonitor\monitor.log" -Tail 30
```

当 `monitor.log` 达到 10 MiB 时，监控器会在下一次周期启动时自动清空该文件。
