![Q 版 DeepSeek 鲸鱼娘与 Web Search Enhanced](docs/assets/deepseek-search-banner.png)

# Web Search Enhanced

<div align="center">

**聊天用喜欢的模型，搜索用合适的连接。**

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 增强原生 `web_search`，让每段对话都有自己的搜索方式。

[![Release](https://img.shields.io/github/v/release/Yurzi/dsh-web-search-enhanced?style=flat-square)](https://github.com/Yurzi/dsh-web-search-enhanced/releases)
[![License: MIT](https://img.shields.io/badge/code-MIT-blue?style=flat-square)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.2%2B-536DFE?style=flat-square)](package.json)

[快速开始](#快速开始) · [配置指南](docs/configuration.zh-CN.md) · [升级指南](docs/migration.zh-CN.md) · [开发文档](docs/v2-implementation.zh-CN.md)

</div>

## 为什么试试它？

- **🐋 免 Key 起步**：安装默认选用 Exa，也可选择 Firecrawl、Tavily 或 Tinyfish。
- **🔀 搜索与聊天分开选**：会话内切换搜索服务、专用搜索模型，或跟随当前会话模型，不改变聊天模型。
- **🕒 每段对话记住偏好**：搜索连接和内容实时性独立持久化，fork 后各自调整。
- **🔐 凭据不混进配置**：API Key 交给 DSH Credentials；免 Key 与个人 Key 显式切换，不偷偷回退。
- **🎛️ 原生界面，轻巧配置**：输入区快速切换，设置页管理连接，支持深浅色主题与窄屏。

> 免 Key 不等于无限免费：上游可能限流、限制 IP 或调整匿名访问政策。插件不会绕过限制，也不会自动改用你的付费 Key。

## 快速开始

需要 **DSH ≥ 0.1.5-rc.2** 和 **Node.js `^22.19.0 || >=24.0.0`**。本版以 DSH 0.1.5-rc.2 契约为验证基线，不承诺兼容 alpha 或任意未来版本。

从 [v0.1.0 Release](https://github.com/Yurzi/dsh-web-search-enhanced/releases/tag/v0.1.0) 下载 `dsh-web-search-enhanced-0.1.0.tgz`，使用绝对路径安装：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-web-search-enhanced-0.1.0.tgz
```

npm 上提供该版本后，也可以：

```sh
dsh plugin --profile web add dsh-web-search-enhanced@0.1.0
```

1. 重新加载插件或重启 DSH，再刷新 Web 页面，使前后端一起更新。
2. 新建会话，在输入区选择搜索连接；安装默认是 **Exa · 免 Key**。
3. 直接提问：**“搜索最近的 TypeScript 发布说明，总结重要变化并附来源。”**

要使用个人 Key 或专用搜索模型？打开 **设置 → 插件 → Web Search Enhanced**。旧版用户请先阅读[升级指南](docs/migration.zh-CN.md)，已有会话不会被新默认值覆盖。

## 选一种搜索方式

| 连接 | 适合怎么用 | 访问方式 |
| --- | --- | --- |
| **Exa** | 默认开箱尝试；个人 Key 可配置搜索类型 | 免 Key MCP / API Key REST |
| **Firecrawl** | 搜索并按需获取更鲜的网页正文 | 免 Key / API Key REST |
| **Tavily** | 配置搜索深度与主题 | 免 Key / API Key REST |
| **Tinyfish** | 按地区、语言和用途搜索 | 免 Key MCP / API Key REST |
| **专用模型** | 固定一个支持服务端搜索的模型 | Anthropic Messages / OpenAI Responses / Chat Completions |
| **跟随会话模型** | 使用当前会话的 provider 和 model | 需显式 `apiKeyEnv`；不接管订阅或 OAuth 登录 |

协议兼容不等于模型具备搜索能力；各模式支持的选项也不同。详见[连接与参数说明](docs/configuration.zh-CN.md)。

### 内容实时性，由当前会话决定

可选 **自动 / 优先新鲜 / 优先实时**。这是网页内容缓存年龄偏好，不是“只搜最近发布的文章”。目前 Firecrawl 和 Exa 个人 Key 可映射相应参数；不支持的连接保留偏好但忽略它。实时抓取可能增加延迟与额度消耗，不保证每个网页都能实时获取。

## 界面预览

![Web Search Enhanced 设置界面](docs/assets/settings-desktop.png)

[深色设置](docs/assets/settings-dark.png) · [窄屏设置](docs/assets/settings-mobile.png) · [会话选择器](docs/assets/search-picker-desktop.png) · [深色选择器](docs/assets/search-picker-dark.png) · [窄屏选择器](docs/assets/search-picker-narrow.png)

<sub>预览来自实际 React 组件的隔离浏览器渲染，不代表你的 DSH 已完成安装。</sub>

## 想了解更多？

| 文档 | 内容 |
| --- | --- |
| [配置与使用](docs/configuration.zh-CN.md) | 凭据、供应商、实时性、模型连接、配置示例与排错 |
| [从旧版升级](docs/migration.zh-CN.md) | V1 导入、行为变化、分支与回退注意事项 |
| [架构说明](docs/design-v2.converged.zh-CN.md) | 会话状态、请求快照、适配器与安全边界 |
| [开发与验证](docs/v2-implementation.zh-CN.md) | 本地构建、测试、浏览器检查与发布流程 |
| [更新日志](CHANGELOG.md) | 0.1.0 重构与历史版本 |

遇到问题请提交 [Issue](https://github.com/Yurzi/dsh-web-search-enhanced/issues)，附 DSH / 插件版本、连接类型及脱敏错误；请勿上传 API Key、私有查询或完整凭据文件。

## 致谢与许可

代码以 [MIT](LICENSE) 开源。感谢 DeepSeek Harness 及各搜索服务的开发者。

Banner 中的 DeepSeek 鲸鱼娘形象来自 **上善无形原创角色与 ZipZipPipe 二创**；本项目横幅基于用户提供的参考图经 AI 辅助创作。角色与参考作品的权利归原作者所有，不因代码的 MIT 许可而获得再授权，亦不表示官方背书。
