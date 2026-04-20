import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

type LogLevel = 'SUCCESS' | 'ERROR' | 'WARN' | 'INFO' | 'IMPORTANT' | 'DEBUG'

const LogColor = {
    success: '\x1b[32m',
    error: '\x1b[31m',
    warn: '\x1b[33m',
    info: '\x1b[34m',
    important: '\x1b[35m',
    debug: '\x1b[36m'
}

interface LogPaths {
    latest: string
    dated: string
}

let logsReadyPromise: Promise<LogPaths> | null = null
let writeQueue: Promise<void> = Promise.resolve()

const pad2 = (value: number) => String(value).padStart(2, '0')

const formatDateForFilename = (date: Date) => {
    const day = pad2(date.getDate())
    const month = pad2(date.getMonth() + 1)
    const year = date.getFullYear()
    return `${day}-${month}-${year}`
}

const formatTimestamp = (date: Date) => {
    const day = pad2(date.getDate())
    const month = pad2(date.getMonth() + 1)
    const year = date.getFullYear()
    const hours = pad2(date.getHours())
    const minutes = pad2(date.getMinutes())
    const seconds = pad2(date.getSeconds())
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

const formatArg = (arg: unknown) => {
    if (typeof arg === 'string') {
        return arg
    }

    if (arg instanceof Error) {
        return arg.stack || `${arg.name}: ${arg.message}`
    }

    try {
        return JSON.stringify(arg)
    } catch {
        return String(arg)
    }
}

const appendLine = async (filePath: string, line: string) => {
    const fileExists = await exists(filePath)
    const currentContent = fileExists ? await readTextFile(filePath) : ''
    const nextContent = `${currentContent}${line}\n`
    await writeTextFile(filePath, nextContent)
}

const ensureLogPaths = async (): Promise<LogPaths> => {
    const basePath = await appDataDir()
    const logsDir = await join(basePath, 'GameLibrary', 'logs')
    await mkdir(logsDir, { recursive: true })

    const latest = await join(logsDir, 'latest.log')
    const dated = await join(logsDir, `${formatDateForFilename(new Date())}.log`)

    // Clear latest.log once per app launch.
    await writeTextFile(latest, '')

    return { latest, dated }
}

const getLogPaths = () => {
    if (!logsReadyPromise) {
        logsReadyPromise = ensureLogPaths()
    }
    return logsReadyPromise
}

const enqueueFileLog = (level: LogLevel, args: unknown[]) => {
    const line = `[${formatTimestamp(new Date())}] [${level}] ${args.map(formatArg).join(' ')}`

    writeQueue = writeQueue
        .then(async () => {
            const paths = await getLogPaths()
            await appendLine(paths.latest, line)
            await appendLine(paths.dated, line)
        })
        .catch(() => {
            // Prevent queue breakage; console logging still works if file IO fails.
        })
}

function success(...args: unknown[]): void {
    console.log(`${LogColor.success}[SUCCESS] `, ...args, ' \x1b[0m')
    enqueueFileLog('SUCCESS', args)
}

function error(...args: unknown[]): void {
    console.log(`${LogColor.error}[ERROR] `, ...args, ' \x1b[0m')
    enqueueFileLog('ERROR', args)
}

function warn(...args: unknown[]): void {
    console.log(`${LogColor.warn}[WARN] `, ...args, ' \x1b[0m')
    enqueueFileLog('WARN', args)
}

function info(...args: unknown[]): void {
    console.log(`${LogColor.info}[INFO] `, ...args, ' \x1b[0m')
    enqueueFileLog('INFO', args)
}

function important(...args: unknown[]): void {
    console.log(`${LogColor.important}[IMPORTANT] `, ...args, ' \x1b[0m')
    enqueueFileLog('IMPORTANT', args)
}

function debug(...args: unknown[]): void {
    console.log(`${LogColor.debug}[DEBUG] `, ...args, ' \x1b[0m')
    enqueueFileLog('DEBUG', args)
}

export const Logger = { success, error, warn, info, important, debug }
