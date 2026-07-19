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

## 当前工作流

1. Windows 计划任务 `AndyServerMonitor` 每分钟以创建 DPAPI 凭据的同一用户后台运行一次监控器。
2. 监控器并行检测 ICMP、SSH 22、RPC 135、SMB 445、RDP 3389，并更新本地 `last-state.json` 与 `monitor.log`。
3. 连续三次全部不可达才确认 `OFFLINE`；恢复可达、确认离线、Linux/Windows 切换会进入本地邮件告警流程。
4. 稳定状态每 120 秒通过 HTTPS/HMAC 上报一次；确认离线、恢复在线或系统切换时绕过间隔并立即上报。
5. Worker 校验签名后，将最新报告写入 KV 的 `SERVER_STATUS/latest`。Worker 不会主动连接 Andy 本机，也不会发送邮件。
6. 网页每次加载、自动刷新或点击“刷新服务器状态”时，调用 `GET /api/server-status`，从 KV 获取最新**已经上报**的数据并渲染。

## STALE 状态的含义

`STALE` 表示 Worker 中保存的最近一条报告已经超过 **5 分钟**没有更新。

- 它不等于服务器 `OFFLINE`，也不会触发邮件；它只表示网页无法确认状态是否仍然新鲜。
- 可能原因包括 Andy 本机的计划任务未执行、本机网络或 HTTPS 上报异常、Worker/KV 暂时故障，或主力机已关机。
- 在正常稳定运行时，上报间隔为 120 秒，因此报告通常不会进入 `STALE`。
- `ONLINE` 与 `OFFLINE` 由 Andy 本机对目标服务器的实际探测得出；`STALE` 由 Worker 根据“最后上报时间”得出。

当前刷新按钮会立即绕过浏览器缓存读取 KV，但它不能让未对外开放的 Andy 本机在点击瞬间运行新一轮检测。若需要“点击后强制检测”，需要增加受保护的本机入站通道（例如 Cloudflare Tunnel），或采用下一次计划任务读取刷新请求的方式（最长约一分钟）。

## 职责边界

### Andy 本机监控器

文件：`D:\myApps\ServerMonitor\andy_server_monitor.py`

- 由 Windows 计划任务 `AndyServerMonitor` 使用 `pythonw.exe` 每分钟后台运行。
- 负责所有实际检测、状态持久化、离线确认、系统切换判断与邮件通知。
- SMTP 凭据与 Worker 上报密钥都保存为当前 Windows 用户的 DPAPI 凭据文件，不保存明文密码或密钥。
- 上报失败不会阻止本地检测或邮件通知。
- `monitor.log` 达到 `10 MiB` 后，会在下一次每分钟监控启动时自动清空；不保留轮转副本。

### Cloudflare Worker

- 只接收已经完成的检测结果，不会主动连接局域网服务器，也不会读取 Andy 本机日志或文件。
- `POST /api/server-report`：校验 HMAC 后把最新数据写入 KV。
- 稳定状态每 120 秒写入一次 KV；确认离线、恢复在线或系统切换时立即上报，降低 KV 写入量。
- `GET /api/server-status`：从 KV 读取最新数据供网页使用；超过五分钟未更新时显示 `STALE`。
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
