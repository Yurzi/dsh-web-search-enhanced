# DSH 0.1.7-rc.1 适配记录

## 基线与交付版本

- 插件版本：**0.1.3**。
- 最低宿主版本：**0.1.7-rc.1**；所有直接 DSH 开发依赖精确固定为该版本，peer 下限同步提升。
- 对比上游：
  - dsh-v0.1.5-rc.2：fb2c4b9e698e30edb738bca4cf0618587db7d203。
  - dsh-v0.1.7-rc.1：46a7f68b0922371ce7144b668b90e377d8e799f4。
- 使用用户提供的上游源码只读审查；未修改上游 checkout，未修改运行中的 DSH 安装。

## 变更对照

以下上游链接固定到目标 tag，不依赖 main 分支漂移。

| 上游变化 / 依据 | 插件适配 |
| --- | --- |
| [SettingsForms](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/settings/settings/src/index.ts#L223-L277) 替代 SettingsProvider / installSection，按 profile entry 投影 volatile 字段 | [src/index.ts](../src/index.ts) 使用 Volatile Config、get()、internal/config 跨字段校验；configure({auto:false}) 避免重复生成设置页。动态更新不重挂载插件，搜索仍按 agent/request 冻结快照。 |
| [原生搜索 provider 的 volatile 用法](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/web/web-search-deepseek/src/index.ts#L46-L74)；settings.yaml 导入改为 Loader 就绪后写 profile | 删除插件直接改写 YAML 文件的逻辑；监听表单/volatile 更新，先验证、再迁凭据、最后 revision CAS 替换配置。缺凭据时保留旧值，重启或凭据重新挂载后重试。 |
| [ConfigForm / ConfigForms](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/client/ui-settings/src/client/config-form-types.ts) 替代 SettingsScope | [bindings.ts](../src/client/bindings.ts) 使用 hooks compartment + InjectFace，将服务限制在 apply 层；组件只接收框架 hook 与操作回调。mutate 返回 false 时保留草稿、不虚报成功。 |
| [第三方 bundle 配置槽](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/client/ui-plugin-manager/src/client/slot-contract.ts#L80-L102) | [client/index.tsx](../src/client/index.tsx) 使用 plugins.bundle.config，key 为插件包名，whileServed 管理设置服务可用性；保留先挂载 Remote 再注入 namespace 的生命周期。 |
| [会话 UI 的 projection hook](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/client/ui-session/src/client/index.ts#L163-L178) | 选择器改为 useProjection('modelSelection')；删除 sessions unknown 与内部 binding/faceOf 探测。保留跨会话迟到响应隔离、读写竞争保护及轮询/focus 兜底。 |
| [可配置模型目录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/llm/llm/src/index.ts#L473-L546) 使用具体实例 settingsNs/settingsPath | [session-model.ts](../src/dsh/session-model.ts) 从公开目录和 settings.describe() 定位 profile，不再调用 settings.get 或假定 llm-pi-ai 是固定实例名。执行仍使用 committed requestHeader，不能被下一轮 pending 模型选择覆盖。 |
| [Typert strict codec 惰性 create](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/typert/protocol/src/types.ts#L272) | [remote-contract.ts](../src/remote-contract.ts) 将 schema 属性迁移到 create()，保持严格请求/响应验证；没有为纯 JSON 结果虚构 binary 编码需求。 |
| [PtcRuntime](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/ptc-runtime/ptc-runtime/src/index.ts) 取代 CodeRuntime，resolve/run 分离 | 移除旧开发依赖；真实 Tools 的 native/PTC 集成测试使用新运行时 seam，覆盖 resolved cwd/timeout、会话隔离、请求冻结、取消与授权。代码执行基底和网络是测试 fixture，不等同真实进程沙箱验收。 |
| snapshotEvents 已废弃；Web provider / Credentials / Storage Domain 在此版本范围内接口未发生对应破坏 | 模型配对不再扫描旧 Session 事件；保留官方 Web provider 接口、Credentials、Storage Domain。配置 version 2、选择 domain version 1 不变，不重写宿主 Session 数据。 |

## 验证结果

在本仓库、Node v26.9.0 / pnpm 11.7.0 环境执行：

- CI=true pnpm install --frozen-lockfile：通过，锁文件与目标依赖可复现。
- pnpm run check：通过，依次 typecheck → build → test → verify:package。
- Vitest：**20 文件、295 测试通过，无跳过**。包括真实 Loader + profile + ConfigEditor + SettingsForms 的配置更新、CAS、迁移与重启恢复。
- node scripts/check-selector-ui.mjs：桌面、390px 窄屏、深色模式各 **14 项检查通过**；使用隔离 Chromium / 临时 profile，不连接当前 DSH 会话。
- 安装包验证：宿主/客户端 bundle、类型声明、profile patch、最低版本与客户端依赖契约通过。
- git diff --check：通过；上游 checkout 仍 clean。

完整检查先构建再测试，避免客户端 bundle 用例验证陈旧产物或因缺少构建产物而跳过。测试中的损坏缓存恢复场景会输出预期 warning，不是测试失败。

## 限制与升级注意

1. 公开模型目录仍未暴露完整 endpoint/protocol/credential 与 adapter 身份。现有跟随模式保留一个明确标注的非公开 adapter identity/catalog 兼容 shim，目标版本已测；shape 不符则 fail-closed，不静默取消身份保护。固定搜索连接不依赖该兼容层。不扩展 OAuth/订阅认证、不透传自定义 headers。
2. 专属 bundle 设置页绑定默认 entry id web-search-enhanced；上游 bundle 槽不提供实例 ID，未增加猜测式多实例/任意别名 UI 支持。
3. 宿主拒绝导入的旧 section 可能只保留在 settings.yaml.imported。请按[升级指南](migration.zh-CN.md)修复并恢复到 profile，保留安全备份；不会删除含秘密的原始备份或修改继承 bundle。
4. 未安装到当前运行的 DSH、未重启服务、未执行付费/真实供应商网络搜索。隔离测试不能代表生产 GUI 已更新。
5. Fork 仍在初始化时继承父会话当前搜索选择，不声称能恢复任意历史切点的插件选择。

安装本地构建包后，需重新加载服务端插件或重启 DSH，再刷新 Web 页面。源码、安装包与校验文件见 [v0.1.3 Release](https://github.com/Yurzi/dsh-web-search-enhanced/releases/tag/v0.1.3)。
