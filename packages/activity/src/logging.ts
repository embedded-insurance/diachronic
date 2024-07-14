import type { LogEntry } from '@effect-use/gcp-logging'
import { Layer, Logger, LogLevel } from 'effect'
import * as Logging from '@effect-use/gcp-logging'

export const defaultLogFunction = (logEntry: LogEntry) => {
  if (logEntry.level === 'FATAL' || logEntry.level === 'ERROR') {
    console.error(JSON.stringify(logEntry))
  } else {
    console.log(JSON.stringify(logEntry))
  }
}

export const ActivitiesLogLayer = (level: LogLevel.Literal) =>
  Layer.provideMerge(
    Logger.replace(
      Logger.defaultLogger,
      Logging.customLogger(defaultLogFunction)
    ),
    Logger.minimumLogLevel(LogLevel.fromLiteral(level))
  )
