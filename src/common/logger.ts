import * as vscode from 'vscode';

export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Off = 4,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.Debug]: 'DEBUG',
    [LogLevel.Info]: 'INFO',
    [LogLevel.Warn]: 'WARN',
    [LogLevel.Error]: 'ERROR',
    [LogLevel.Off]: 'OFF',
};

export function parseLogLevel(value: string | undefined): LogLevel {
    switch (value?.toLowerCase()) {
        case 'debug': return LogLevel.Debug;
        case 'info': return LogLevel.Info;
        case 'warn': return LogLevel.Warn;
        case 'error': return LogLevel.Error;
        case 'off': return LogLevel.Off;
        default: return LogLevel.Info;
    }
}

class Logger {
    private _channel: vscode.OutputChannel | undefined;
    private _level: LogLevel = LogLevel.Info;

    /** Lazily create the output channel so tests that never call log methods don't need it. */
    private _getChannel(): vscode.OutputChannel {
        if (!this._channel) {
            this._channel = vscode.window.createOutputChannel('Zeppelin Notebook');
        }
        return this._channel;
    }

    setLevel(level: LogLevel) { this._level = level; }
    getLevel(): LogLevel { return this._level; }

    debug(msg: string, ...args: any[]) { this._log(LogLevel.Debug, msg, args); }
    info(msg: string, ...args: any[])  { this._log(LogLevel.Info, msg, args); }
    warn(msg: string, ...args: any[])  { this._log(LogLevel.Warn, msg, args); }
    error(msg: string, ...args: any[]) { this._log(LogLevel.Error, msg, args); }

    private _log(level: LogLevel, msg: string, args: any[]) {
        if (level < this._level) { return; }

        const prefix = LOG_LEVEL_NAMES[level];
        const timestamp = new Date().toISOString();
        const formatted = args.length > 0
            ? `[${timestamp}] [${prefix}] ${msg} ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`
            : `[${timestamp}] [${prefix}] ${msg}`;

        // Write to VS Code Output panel
        this._getChannel().appendLine(formatted);

        // Mirror to developer console
        if (level >= LogLevel.Error) {
            console.error(formatted, ...args);
        } else if (level >= LogLevel.Warn) {
            console.warn(formatted, ...args);
        } else {
            console.log(formatted, ...args);
        }
    }

    dispose() {
        this._channel?.dispose();
        this._channel = undefined;
    }
}

/** Singleton logger instance used throughout the extension. */
export const logger = new Logger();