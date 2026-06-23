# Native 动作日志(Native Action Logging)

**日期**:2026-06-23
**状态**:设计待审
**目标项目**:Gemini-Nexus(MV3 Chrome 扩展)

## 1. 目标

让 Claude(通过本机 Bash)能读取 Gemini-Nexus 扩展运行时**所有关键动作**的结构化日志,用于调试、观测、事后回溯。不追求秒级实时,事后能 `tail/grep` 完整历史即可。

## 2. 范围

**覆盖(全动作埋点)**:
- 浏览器控制动作:`click` / `fill` / `fill_form` / `scroll` / `navigate` / `extract` / `hover` / `upload` / `keypress` 等——记录开始、结果、耗时、错误
- 工具调用循环(`background/handlers/session/prompt/tool_loop.js`):每轮的工具名、参数摘要、LLM 返回状态、耗时
- 光标(`background/control/cursor_controller.js`):`move`(目标坐标、moveSequence)、`show`、`hide`
- 关键消息收发(chrome.runtime / chrome.tabs)
- LLM API 请求(模型、渠道、耗时、HTTP 状态、token 数、错误)
- 所有 `catch` 与异常路径

**非目标**:
- 不记每一行微状态(只记"动作"粒度)
- 不做实时流式推送(事后回溯)
- 不替代开发者 console,只做面向观测的统一日志

## 3. 架构与数据流

```
任意动作
  → createLogger(module).info(msg, ctx)
  → 格式化行 "[ISO] [LEVEL] [module] msg {json}"
       ├─ console.*（保留,开发者可见)
       └─ background: port.postMessage({level,module,msg,ts,ctx})
              → chrome.runtime.connectNative("com.gemini_nexus.logger")
              → 本地 host 脚本 append → ~/Library/Logs/gemini-nexus.log

content script / sidepanel 动作
  → chrome.runtime.sendMessage({type:"native_log", ...})
  → background 代发(同上)
```

**为什么日志不会丢**:动作发生时 service worker 必然是醒的(它正在处理该动作),`connectNative` 端口此刻必然可用。SW 空闲休眠时不产生动作,无日志可丢。SW 因生命周期重启期间的小缓冲在重连后补发。

## 4. 组件

### 4.1 `shared/logger.js`(统一 logger)
- 导出 `createLogger(module: string)` → `{ debug, info, warn, error }`
- 每次调用:
  1. 构造条目 `{ts: ISO, level, module, msg, ctx}`
  2. `console[level](formatted)`(保留现有 console 行为)
  3. 若 native 日志**已开启**(读缓存配置):按上下文发送
     - background:`nativePort.send(entry)`
     - content / sidepanel:`chrome.runtime.sendMessage({type:"native_log", entry})`
- **脱敏**:当配置 `includeSensitive === false`(默认),对 `ctx` 调用 `redact(ctx)`:移除 `prompt` / `content` / `text` / `body` / `apiKey` / `authorization` / `key` 等键的值(替换为 `<redacted:N字>`),保留元数据(模型、耗时、状态、token 数等)

### 4.2 `background/native_logger_port.js`(端口管理)
- `getPort()`:lazy 连接 `chrome.runtime.connectNative("com.gemini_nexus.logger")`;缓存 port
- `send(entry)`:若 port 不存在或已断开则重连;`port.postMessage(entry)`;失败入内存小缓冲(上限 200 条),下次重连补发
- 监听 `port.onDisconnect`:清空缓存 port、设需重连标志
- 监听 `chrome.runtime.onMessage` `type:"native_log"`:代 content/sidepanel 发送
- 读配置(`chrome.storage.local`)决定是否实际发送、级别阈值、脱敏

### 4.3 `scripts/native-logger/host.js`(native host,Node)
- 从 stdin 读 Chrome native messaging 帧(4 字节 LE uint32 长度 + UTF-8 JSON)
- 解析 `{ts, level, module, msg, ctx}`,格式化为一行,append 到 `~/Library/Logs/gemini-nexus.log`
- **轮转**:写前检查大小,>10MB 时把 `.log` 重命名为 `.log.1`(覆盖旧 `.1`),新建 `.log`
- `stderr` 写 host 自身错误(供诊断);不向 stdout 回消息(单向)
- 进程退出/stdin 关闭时 flush

### 4.4 `scripts/install-native-logger.mjs`(安装器,Node)
- 复制 `host.js` 到 `~/.gemini-nexus/native-logger.js`,赋可执行权限
- 生成 native messaging host manifest,写到 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.gemini_nexus.logger.json`:
  ```json
  {
    "name": "com.gemini_nexus.logger",
    "description": "Gemini Nexus action logger",
    "type": "stdio",
    "path": "/Users/<user>/.gemini-nexus/native-logger.js",
    "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
  }
  ```
- **扩展 ID**:`<EXTENSION_ID>` 优先从 `manifest.json` 的 `key` 字段自动算(对公钥 DER 做 SHA256,取前 16 字节,每字节 mod 32 + 映射 `a-p`)。失败则提示用户从 `chrome://extensions` 复制 ID 传入
- 幂等:重复运行覆盖旧文件
- 卸载模式 `--uninstall`:删除 host 与 manifest

### 4.5 `manifest.json` 改动
- `permissions` 加 `"nativeMessaging"`

## 5. 埋点清单(落点)

| 区域 | 文件 | 记录点 |
|---|---|---|
| 浏览器控制 | `background/control/actions/**` | 每个动作 start / result / error + 耗时 |
| 动作执行器 | `background/control/action_waiter.js` | 等待结果、超时 |
| 工具循环 | `background/handlers/session/prompt/tool_loop.js` | 每轮工具名、参数摘要、状态、耗时 |
| 光标 | `background/control/cursor_controller.js` | move / show / hide + moveSequence |
| LLM API | `services/**` 或 API 适配层 | 请求(模型/渠道)、响应状态、token、耗时、error |
| 消息 | 关键 `chrome.runtime.onMessage` 处理器 | 收发事件 |
| 错误 | 所有 `catch` | 抛出点、消息 |

埋点用各模块顶部 `const log = createLogger("module.path")`,替换或补充现有 `console.*`。

## 6. 日志格式与级别

- 行格式:`[2026-06-23T12:34:56.789Z] [INFO] [browser_control.click] 点击元素 {selector:"...",ms:120,ok:true}`
- `ctx` 序列化为单行 JSON(紧凑,key 排序),便于 grep
- 级别:`debug` / `info` / `warn` / `error`,默认记录阈值 `info`(可在设置调)
- 异常栈:`error` 级 ctx 带 `stack`,多行用 `\n` 转义为单行

## 7. 配置(存 `chrome.storage.local`)

| 键 | 默认 | 说明 |
|---|---|---|
| `nativeLogEnabled` | `false` | 总开关,**默认关** |
| `nativeLogLevel` | `"info"` | 最低记录级别 |
| `nativeLogIncludeSensitive` | `false` | 是否记录 prompt 正文/密钥,**默认脱敏** |

设置页(`settings/index.html` + `index.js`)新增「Native 动作日志」分组:开关 + 级别下拉 + 「含敏感正文」开关 + 显示日志文件路径。

## 8. 安装流程(一次性)

1. `node scripts/install-native-logger.mjs`(Claude 执行)→ 落 host、写 host manifest
2. 扩展 `manifest.json` 加 `nativeMessaging` 权限 → 重新打包 → `chrome://extensions` reload
3. 打开设置页,开启「Native 动作日志」
4. 之后触发任意动作 → `~/Library/Logs/gemini-nexus.log` 持续 append
5. Claude:`tail -n 500 ~/Library/Logs/gemini-nexus.log` 或 `grep`

## 9. 文件改动清单

**新增**:
- `shared/logger.js` + `shared/logger.test.js`
- `background/native_logger_port.js` + `.test.js`
- `scripts/native-logger/host.js` + `host.test.js`
- `scripts/install-native-logger.mjs` + `.test.js`
- `docs/native-action-logging-design.md`(本文件)

**修改**:
- `manifest.json`:加 `nativeMessaging` 权限
- `settings/index.html` / `settings/index.js`:加日志配置 UI
- `background/index.js`(或入口):初始化 native logger port、注册消息转发
- 第 5 节列出的各动作文件:埋点(逐步替换裸 `console.*`)

## 10. 隐私与安全

- **默认关 + 默认脱敏**:日志文件默认不存在;开启后也不含 prompt 正文与密钥
- host manifest 的 `allowed_origins` 锁定本扩展 ID,其他扩展无法连
- 日志文件路径固定 `~/Library/Logs/`,用户可见可删
- 文档提示用户:开启"含敏感正文"时日志会含对话内容,排障后建议关闭并删除文件

## 11. 测试策略

- **logger**:格式化、上下文探测(background vs content)、脱敏覆盖所有敏感键、级别过滤
- **native_logger_port**:lazy 连接、断开重连、缓冲补发(模拟 port.onDisconnect)
- **host.js**:framed JSON 解析(含分块到达)、append 正确性、>10MB 轮转、stderr 错误
- **install**:从 manifest `key` 算 ID 的正确性、生成的 host manifest 字段正确、幂等覆盖、`--uninstall`
- **集成(手动)**:装 host → 开开关 → 触发一次浏览器控制动作 → 验证文件出现预期行

## 12. 风险与边界

- **扩展 ID 算错**:安装器算 ID 失败时退回让用户手填;`allowed_origins` 不匹配会导致 `connectNative` 报错(有明确错误信息)
- **Node 未装**:host 与安装器依赖 Node(用户在做 JS 项目,已具备);若未装给出明确提示
- **SW 频繁重启**:缓冲补发保证不丢;最坏情况 SW 被强杀时极少量在途日志丢失(可接受,事后回溯场景)
- **日志体积**:10MB 轮转兜底;默认关进一步降低风险
- **平台**:本期仅 macOS(路径 `~/Library/...`);Linux/Windows 路径留待扩展(host manifest 路径与日志目录按平台分支)

## 13. 使用方式(实测)

**安装(一次性)**:
```sh
node scripts/install-native-logger.mjs        # 装 host + 写 NativeMessagingHosts manifest
chmod +x ~/.gemini-nexus/native-logger.js     # 让 host 可执行
npm run package:extension                      # 重新打包扩展
```
然后在 `chrome://extensions` reload Gemini Nexus。

**开启日志**(默认关):在 service worker console 或任意扩展页面 console 执行
```js
chrome.storage.local.set({ geminiNativeLogEnabled: true })
```
可选调级别:`chrome.storage.local.set({ geminiNativeLogLevel: 'debug' })`(默认 `info`)。

**读取**(Claude / 任意终端):
```sh
tail -n 500 ~/Library/Logs/gemini-nexus.log
grep '\[ERROR\]' ~/Library/Logs/gemini-nexus.log
```

**关闭**:`chrome.storage.local.set({ geminiNativeLogEnabled: false })`(sink 立即断开 native 端口)。

**卸载**:`node scripts/install-native-logger.mjs --uninstall`(删 host 与 manifest;日志文件保留,手动删)。

**实测状态**:host 端到端已验证可写文件(测试日志 `[2026-06-23T06:02:00.444Z] [INFO] [e2e-test] host connectivity ok {"ok":true}`);扩展产物含 `nativeMessaging` 权限与 `NativeLoggerSink`;扩展 ID 实测为 `ccmbheekkhlgfggi`。真实动作日志需 reload 扩展并触发浏览器控制动作后产生。

**与设计的偏差**:实现中复用了现有 `LogManager` + `setupConsoleInterception`(已含脱敏/分级/console 拦截),未新建 `shared/logger.js`。设置页正式 UI 开关列为后续(本期通过 `chrome.storage.local.set` 程序化开关)。storage key 实际为 `geminiNativeLogEnabled` / `geminiNativeLogLevel`(沿项目 `gemini` 前缀惯例,非第 7 节的简写名)。
