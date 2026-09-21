#!/usr/bin/env node
/**
 * DSH Web Search Enhanced - 配置文件迁移脚本
 *
 * 功能：
 * 1. 将 DSH settings.yaml 中 web-search-enhanced 的 JSON 格式 / flow-style ({ ... }) 自动转换为标准 block-style YAML。
 * 2. 自动检测并迁移旧版 (v1) 配置字段为 v2 会话搜索连接模型 (custom:legacy / builtin:session-model)。
 * 3. 兼容处理独立的 JSON 配置文件并转换为标准的 YAML 配置。
 * 4. 写入前自动安全备份原配置文件（生成 .bak 备份）。
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve, dirname, join, extname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseDocument, isMap, isSeq, parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export const LEGACY_FIELDS = [
  'modelMode', 'protocol', 'baseURL', 'model', 'fallbackModel',
  'apiKey', 'apiKeyEnv', 'apiVersion', 'toolIdentifier',
  'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize',
]

/**
 * 递归将 YAML AST 节点由 flow-style ({ ... } / [ ... ]) 转换为 block-style 缩进格式
 * 对于空 Map ({}) 和空 Seq ([]) 则保留为 flow-style，保持 YAML 惯用排版
 */
export function convertFlowToBlock(node) {
  if (!node) return
  if (isMap(node)) {
    if (node.items.length === 0) {
      node.flow = true
    } else {
      node.flow = false
      for (const item of node.items) {
        convertFlowToBlock(item.key)
        convertFlowToBlock(item.value)
      }
    }
  } else if (isSeq(node)) {
    if (node.items.length === 0) {
      node.flow = true
    } else {
      node.flow = false
      for (const item of node.items) {
        convertFlowToBlock(item)
      }
    }
  }
}

/**
 * 转换旧版 (v1) 配置到 v2 配置结构
 */
export function migrateV1ToV2(raw) {
  const changes = []
  const warnings = []

  if (raw.apiKey) {
    warnings.push('检测到明文 apiKey。根据 DSH 安全规范，明文 Key 已从配置中安全剥离。请通过 DSH 凭据服务（DSH Credentials）保存该 Key。')
  }

  let result
  if (raw.modelMode === 'current-session') {
    result = {
      version: 2,
      defaultConnection: 'builtin:session-model',
    }
    changes.push('旧版跟随会话模型 (modelMode: current-session) -> 已迁移为 defaultConnection: builtin:session-model')
  } else {
    const existing = raw.connections && typeof raw.connections === 'object' && !Array.isArray(raw.connections) ? { ...raw.connections } : {}
    const options = {}
    for (const key of ['apiVersion', 'toolIdentifier', 'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize']) {
      if (raw[key] !== undefined) options[key] = raw[key]
    }

    result = {
      version: 2,
      defaultConnection: 'custom:legacy',
      connections: {
        ...existing,
        'custom:legacy': {
          kind: 'model',
          label: 'Imported search model',
          trustedEndpoint: true,
          binding: {
            mode: 'fixed',
            protocol: raw.protocol ?? 'anthropic-messages',
            model: raw.model ?? 'deepseek-flash',
            baseURL: raw.baseURL ?? 'https://api.deepseek.com/anthropic/v1',
            credentialRef: raw.apiKeyEnv ?? 'WEB_SEARCH_ENHANCED_API',
          },
          options,
        },
      },
    }
    changes.push('旧版固定搜索模型路由 -> 已迁移为 custom:legacy 自定义固定连接并设为默认')
  }

  if (raw.freshness) {
    result.freshness = raw.freshness
  }

  return { result, changes, warnings }
}

/**
 * 核心迁移函数：处理配置文本
 */
export function migrateConfigText(content, options = {}) {
  const changes = []
  const warnings = []

  // 1. 尝试判定是否为独立 JSON 文档
  const trimmed = content.trim()
  const isPlainJson = trimmed.startsWith('{') && trimmed.endsWith('}')

  let doc
  try {
    doc = parseDocument(content, { prettyErrors: true })
  } catch (err) {
    throw new Error('解析文档失败: ' + err.message)
  }

  // 检查是否包含命名空间 web-search-enhanced
  let rootNode = doc.get('web-search-enhanced', true)
  let isRootSection = true

  if (!rootNode) {
    // 检查文档自身是否直接就是该插件的配置（例如独立的配置文件）
    const jsRoot = doc.toJS()
    if (jsRoot && typeof jsRoot === 'object' && (jsRoot.connections || jsRoot.modelMode || jsRoot.defaultConnection || jsRoot.version)) {
      rootNode = doc.contents
      isRootSection = false
    }
  }

  if (!rootNode) {
    return {
      migrated: false,
      output: content,
      changes: ['未找到 web-search-enhanced 相关配置，跳过迁移。'],
      warnings: [],
    }
  }

  const jsVal = rootNode.toJS(doc)

  // 2. 检查旧版 v1 字段并迁移
  const hasLegacyFields = LEGACY_FIELDS.some(k => jsVal && typeof jsVal === 'object' && Object.hasOwn(jsVal, k))
  const isV1 = jsVal && jsVal.version !== 2 && hasLegacyFields

  if (isV1) {
    const { result, changes: v1Changes, warnings: v1Warnings } = migrateV1ToV2(jsVal)
    changes.push(...v1Changes)
    warnings.push(...v1Warnings)

    if (isRootSection) {
      doc.set('web-search-enhanced', result)
      rootNode = doc.get('web-search-enhanced', true)
    } else {
      doc.contents = doc.createNode(result)
      rootNode = doc.contents
    }
  }

  // 3. 检查并纠正 flow-style (JSON 风格) 节点为标准 block-style YAML
  let convertedFlow = false
  if (rootNode.flow) {
    convertedFlow = true
  }

  // 递归将非空 Map/Seq 转换为 block 模式
  convertFlowToBlock(rootNode)

  if (convertedFlow || isPlainJson) {
    changes.push('将 JSON / flow-style 格式成功转换为标准 DSH YAML 缩进格式')
  }

  const output = doc.toString()
  const migrated = output !== content

  return {
    migrated,
    output,
    changes,
    warnings,
  }
}

/**
 * 自动定位 DSH settings.yaml 文件路径
 */
export function resolveSettingsPath(explicitPath) {
  if (explicitPath) return resolve(explicitPath)

  if (process.env.DSH_SETTINGS_FILE && existsSync(process.env.DSH_SETTINGS_FILE)) {
    return resolve(process.env.DSH_SETTINGS_FILE)
  }

  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const defaultPath = join(dshHome, 'settings.yaml')
  if (existsSync(defaultPath)) {
    return defaultPath
  }

  const cwdPath = resolve('settings.yaml')
  if (existsSync(cwdPath)) {
    return cwdPath
  }

  return defaultPath
}

/**
 * 迁移单个文件并安全备份
 */
export function migrateFile(filePath, options = {}) {
  const target = resolve(filePath)
  if (!existsSync(target)) {
    throw new Error(`找不到目标文件: ${target}`)
  }

  const originalContent = readFileSync(target, 'utf8')
  const { migrated, output, changes, warnings } = migrateConfigText(originalContent, options)

  let backupPath = null
  if (migrated && !options.dryRun) {
    if (!options.noBackup) {
      backupPath = target + '.bak'
      if (existsSync(backupPath)) {
        backupPath = `${target}.${Date.now()}.bak`
      }
      copyFileSync(target, backupPath)
    }
    writeFileSync(target, output, 'utf8')
  }

  return {
    success: true,
    target,
    migrated,
    backupPath,
    changes,
    warnings,
    output,
  }
}

/**
 * CLI 命令行入口
 */
export function runCli(argv = process.argv.slice(2)) {
  let filePath = null
  let dryRun = false
  let noBackup = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(`
DeepSeek Harness - Web Search Enhanced 配置迁移工具

用法:
  node scripts/migrate-config.mjs [选项] [配置文件路径]
  pnpm run migrate [--选项] [配置文件路径]

选项:
  -p, --path <file>    指定要迁移的配置文件路径（默认自动查找 ~/.dsh/settings.yaml）
  -n, --dry-run        预览迁移效果，不修改实际文件
      --no-backup      迁移时不创建 .bak 备份文件
  -h, --help           查看帮助信息

示例:
  # 自动检测并迁移 DSH settings.yaml
  node scripts/migrate-config.mjs

  # 预览当前配置的迁移效果（不修改文件）
  node scripts/migrate-config.mjs --dry-run

  # 迁移指定位置的 settings.yaml 或独立配置文件
  node scripts/migrate-config.mjs ~/.dsh/settings.yaml
`)
      return 0
    } else if (arg === '--dry-run' || arg === '-n') {
      dryRun = true
    } else if (arg === '--no-backup') {
      noBackup = true
    } else if (arg === '--path' || arg === '-p') {
      filePath = argv[++i]
    } else if (!arg.startsWith('-')) {
      filePath = arg
    }
  }

  const resolved = resolveSettingsPath(filePath)
  console.log(`🔍 正在检查配置文件: ${resolved}`)

  if (!existsSync(resolved)) {
    console.error(`❌ 未找到配置文件: ${resolved}`)
    console.error(`提示: 请使用 -p 或 --path 参数指定您的 settings.yaml 路径。`)
    return 1
  }

  try {
    const result = migrateFile(resolved, { dryRun, noBackup })

    for (const warn of result.warnings) {
      console.warn(`⚠️  ${warn}`)
    }

    if (!result.migrated) {
      console.log('✅ 当前配置格式正确且已为标准 YAML 规范，无需迁移。')
      return 0
    }

    console.log('\n📝 迁移变更列表:')
    for (const change of result.changes) {
      console.log(`  - ${change}`)
    }

    if (dryRun) {
      console.log('\n[DRY RUN 预览] 迁移后的内容:')
      console.log('----------------------------------------')
      console.log(result.output)
      console.log('----------------------------------------')
      console.log('💡 预览完成。去掉 --dry-run 参数以执行真实写入。')
    } else {
      if (result.backupPath) {
        console.log(`\n📦 原配置已安全备份至: ${result.backupPath}`)
      }
      console.log(`🎉 迁移成功！配置文件已更新为标准 YAML: ${result.target}`)
    }

    return 0
  } catch (err) {
    console.error(`❌ 迁移失败: ${err.message}`)
    return 1
  }
}

// 直接运行时执行 CLI
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isDirectRun) {
  const exitCode = runCli()
  if (exitCode !== 0) process.exit(exitCode)
}
