# 实验室服务器状态面板部署

本项目采用单 Cloudflare Worker + Workers KV 架构：

```text
andy 监控器 -- HMAC POST --> hainanu-parking Worker -- KV(latest) --> /board 第二面板
```

不使用 D1，也不需要第二个 Worker。KV 只保存最新服务器状态；完整运行日志继续保留在 Andy 本机 `D:\myApps\ServerMonitor\monitor.log`。

## 1. 创建 KV Namespace

在本项目目录执行：

```powershell
cd D:\myApps\ServerMonitor\web\proDir\proDir\code
npx wrangler kv namespace create SERVER_STATUS
```

把输出的 namespace ID 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "SERVER_STATUS"
id = "这里填写 namespace ID"
```

## 2. 设置 HMAC Secret

生成一个高强度随机字符串，并妥善保存。它需要同时用于 Cloudflare Worker 与 Andy 的 DPAPI 凭据文件。

```powershell
npx wrangler secret put INGEST_HMAC_KEY
```

不要把该密钥写入 `wrangler.toml`、Git、`config.json` 或聊天记录。

## 3. 部署 GitHub 项目

提交并推送本项目代码到 GitHub：

```powershell
git add code/dashboard.html code/server.js code/worker.js code/wrangler.toml code/.dev.vars.example code/DEPLOY_SERVER_PANEL.md progress.txt
git commit -m "feat: add laboratory server status panel backed by KV"
git push origin main
```

若 GitHub 已连接 Cloudflare Workers，推送会触发部署；否则在本目录执行：

```powershell
npx wrangler deploy
```

Worker URL 的上报地址是：

```text
https://<你的 Worker 域名>/api/server-report
```

## 4. 配置 Andy 上报

为创建 SMTP 凭据的同一 Windows 用户运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\myApps\ServerMonitor\New-WebReportCredential.ps1"
```

凭据窗口中，用户名可填写任意标签，密码填写与 `INGEST_HMAC_KEY` 完全相同的值。

编辑 `D:\myApps\ServerMonitor\config.json`：

```json
"web_report": {
  "enabled": true,
  "endpoint": "https://<你的 Worker 域名>/api/server-report",
  "credential_file": "D:\\myApps\\ServerMonitor\\web-report-credential.xml",
  "timeout_seconds": 10
}
```

随后手动运行一次监控器，检查 `monitor.log` 有 `Cloudflare Worker 上报成功`。访问 Worker 的 `/board`，第二面板将显示最新服务器状态。
