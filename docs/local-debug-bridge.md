# Local Debug Bridge（本地调试桥）

Chrome MV3 扩展**不能**自己监听 TCP 端口。Gemini Nexus 通过 **Native Messaging Host** 在本机起一个 HTTP/SSE 服务，让本地工具（curl、脚本、AI agent）直接访问扩展运行时日志与状态。

```
本地客户端 (curl / agent)
        │  HTTP 127.0.0.1:17321
        ▼
native-logger host (Node)
        │  chrome.runtime.connectNative (stdio 帧协议)
        ▼
扩展 background service worker
```

## 安装

> 仅支持 macOS Chrome（安装路径硬编码 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`；Linux/Windows 需手动适配后使用）。

在项目根目录：

```bash
npm run native-logger:install
# 或: node scripts/install-native-logger.mjs
```

会写入：

- `~/.gemini-nexus/native-logger.js` — host 脚本
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.gemini_nexus.logger.json`

然后在 `chrome://extensions` **重新加载** Gemini Nexus（unpacked 开发包默认开启 native 日志）。

## HTTP API

默认只绑定 **`127.0.0.1:17321`**（本机 loopback）。Host 在扩展 `connectNative` 时启动；扩展禁用 native 日志或 SW 断开后进程退出，HTTP 随之关闭。

| 方法 | 路径                          | 说明                                                                                                    |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET  | `/health`                     | 桥是否在跑、扩展是否已连接                                                                              |
| GET  | `/logs?limit=100&level=error` | 内存环形缓冲中的最近日志                                                                                |
| GET  | `/logs/stream`                | SSE 实时流（含近期 backlog）                                                                            |
| GET  | `/status`                     | 经 RPC 查询扩展版本/日志数等                                                                            |
| GET  | `/sessions`                   | 会话列表。查询：`?q=`、`?limit=`、`?offset=`；`?messages=1` 返回全文；`?attachments=1` 保留 base64 附件 |
| GET  | `/sessions/:id`               | 单会话完整消息（含 tool / thoughts / sources）。`?attachments=1` 保留附件                               |
| GET  | `/records`                    | 一揽子导出：sessions（默认含全文）+ groups + logs。`?messages=0` 仅摘要；`?logs=0` 不要日志             |
| GET  | `/groups`                     | 会话分组                                                                                                |
| GET  | `/storage/keys`               | `chrome.storage.local` 键名与大致字节数                                                                 |
| POST | `/rpc`                        | body: `{"method":"…","params":{}}`（见下表）                                                            |

> **体积提示**：图片 / data URL 默认替换为 `[omitted base64 N chars]`，避免 Native Messaging 1MB 帧限制。需要原图时再加 `attachments=1`（可能失败或很慢）。

### 示例

```bash
# 健康检查
curl -s http://127.0.0.1:17321/health | jq .

# 最近错误
curl -s 'http://127.0.0.1:17321/logs?limit=50&level=error' | jq .

# 实时订阅
curl -N http://127.0.0.1:17321/logs/stream

# 扩展状态
curl -s http://127.0.0.1:17321/status | jq .

# 会话列表（摘要）
curl -s 'http://127.0.0.1:17321/sessions?limit=20' | jq .

# 搜索 + 全文
curl -s 'http://127.0.0.1:17321/sessions?q=browser&messages=1' | jq .

# 单会话完整过程
curl -s "http://127.0.0.1:17321/sessions/<SESSION_ID>" | jq .

# 一揽子记录（聊天 + 分组 + 日志）
curl -s 'http://127.0.0.1:17321/records?limit=50' | jq .

# RPC
curl -s -X POST http://127.0.0.1:17321/rpc \
  -H 'Content-Type: application/json' \
  -d '{"method":"get_session","params":{"id":"<SESSION_ID>"}}' | jq .
```

文件日志仍写入：`~/Library/Logs/gemini-nexus.log`。

## 环境变量

| 变量                        | 默认        | 说明                                                                        |
| --------------------------- | ----------- | --------------------------------------------------------------------------- |
| `GEMINI_NEXUS_BRIDGE_HOST`  | `127.0.0.1` | 监听地址。非 loopback 时**必须**设 token                                    |
| `GEMINI_NEXUS_BRIDGE_PORT`  | `17321`     | 端口                                                                        |
| `GEMINI_NEXUS_BRIDGE_TOKEN` | _(空)_      | 鉴权。请求头 `Authorization: Bearer <token>`、`X-Bridge-Token` 或 `?token=` |

若要从局域网访问，可在安装 host 后编辑 `~/.gemini-nexus/native-logger.js` 启动环境，或用 wrapper 设置：

```bash
export GEMINI_NEXUS_BRIDGE_HOST=0.0.0.0
export GEMINI_NEXUS_BRIDGE_TOKEN='your-long-secret'
```

**不要**在无 token 时把 host 绑到 `0.0.0.0`。

## 扩展侧开关

- Unpacked（开发加载）：默认 `geminiNativeLogEnabled: true`，启动即 `connectNative`。
- 商店包：默认关。在扩展 SW 控制台执行：

```js
chrome.storage.local.set({ geminiNativeLogEnabled: true });
```

然后 reload 扩展。

## 内置 RPC methods

| method             | 返回                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `ping`             | `{ pong: true, ts }`                                                                                                      |
| `get_logs`         | `{ logs: [...] }`（params: `limit`, `level`）                                                                             |
| `get_status`       | `{ version, name, unpacked, nativeLogEnabled, logCount, ts }`                                                             |
| `get_sessions`     | `{ total, offset, limit, sessions }`（params: `limit`, `offset`, `query`, `id`, `includeMessages`, `includeAttachments`） |
| `get_session`      | `{ found, session }`（params: `id` 必填, `includeAttachments`）                                                           |
| `get_groups`       | `{ groups }`                                                                                                              |
| `get_storage_keys` | `{ keys, sizes }`                                                                                                         |
| `get_records`      | `{ ts, sessions, groups, logs }`（params 同 sessions + `includeLogs`, `logLimit`）                                        |

可在 `background/index.js` 通过 `nativeLoggerSink.setRequestHandler(name, fn)` 继续扩展。

## 排障

1. `curl` 连不上：扩展未启用 native 日志，或尚未产生过连接（reload 扩展；打开侧边栏发一条消息让 SW 保持活跃）。
2. `/health` 里 `extensionConnected: false`：host 在跑但扩展还没 hello（检查 Native Messaging host 是否安装、扩展 ID 是否匹配）。
3. 端口占用：改 `GEMINI_NEXUS_BRIDGE_PORT` 后重新 `npm run native-logger:install` 并 reload 扩展。
4. 日志文件：`tail -f ~/Library/Logs/gemini-nexus.log`
