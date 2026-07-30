# 健身房上游接口日志

Cloudflare Worker 没有可持久写入的本地文件系统，因此线上运行日志实际保存在 D1 的 `gym_api_logs` 表中。本文件用于说明日志字段和查询方式。

## 记录范围

- `worker-cron`：Worker 每五分钟自动采集。
- `realtime-refresh`：用户在页面手动刷新当前在线人数。
- 成功、非 2xx HTTP 状态、超时、JSON 解析失败和人数缺失都会记录。
- 图表读取 D1 的请求不会再次访问上游接口，因此不会写入本表。

## 字段

- `requested_at`：UTC 请求时间。
- `request_date`：按 `Asia/Shanghai` 计算的日期。
- `request_type`：`worker-cron` 或 `realtime-refresh`。
- `upstream_status`：上游 HTTP 状态码；连接建立前失败或超时时为空。
- `success`：`1` 表示成功，`0` 表示失败。
- `duration_ms`：请求及解析耗时，单位为毫秒。
- `error_message`：失败原因，最长保存 500 个字符。

访问日志不保存用户手动刷新得到的在线人数；只有五分钟 Cron 会向 `gym_samples` 写入曲线采样。

## 查询

浏览最近 100 条：

```text
https://forcloudflare.442192699.workers.dev/api/gym/api-logs?limit=100
```

查询指定上海时区日期：

```text
https://forcloudflare.442192699.workers.dev/api/gym/api-logs?date=2026-07-30&limit=500
```

D1 控制台查询失败记录：

```sql
SELECT requested_at, request_type, upstream_status, duration_ms, error_message
FROM gym_api_logs
WHERE success = 0
ORDER BY requested_at DESC
LIMIT 100;
```
