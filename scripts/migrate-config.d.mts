export interface MigrateResult {
  migrated: boolean
  output: string
  changes: string[]
  warnings: string[]
}

export interface MigrateFileOptions {
  dryRun?: boolean
  noBackup?: boolean
  verbose?: boolean
}

export interface MigrateFileResult {
  success: boolean
  target: string
  migrated: boolean
  backupPath: string | null
  changes: string[]
  warnings: string[]
  output: string
}

export function convertFlowToBlock(node: unknown): void
export function migrateV1ToV2(raw: Record<string, unknown>): {
  result: Record<string, unknown>
  changes: string[]
  warnings: string[]
}
export function migrateConfigText(content: string, options?: { dryRun?: boolean }): MigrateResult
export function resolveSettingsPath(explicitPath?: string | null): string
export function migrateFile(filePath: string, options?: MigrateFileOptions): MigrateFileResult
export function runCli(argv?: string[]): number