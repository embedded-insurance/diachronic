import './workflow-runtime'
import { Sinks } from '@temporalio/workflow'
import { LogEntry } from '@effect-use/gcp-logging'
import * as wf from '@temporalio/workflow'
import { Layer, LogLevel, Logger } from 'effect'
import * as Logging from '@effect-use/gcp-logging'
import { InjectedSinks } from '@temporalio/worker'
import { inWorkflowContext } from '@temporalio/workflow'

export const loggerSink: InjectedSinks<DiachronicSinks> = {
  logger: {
    info: {
      fn(workflowInfo, logEntryInJsonFormat) {
        const entry = JSON.parse(logEntryInJsonFormat)
        console.log(JSON.stringify({ ...entry, ...workflowInfo }))
      },
      callDuringReplay: false,
    },
    error: {
      fn(workflowInfo, logEntryInJsonFormat) {
        const entry = JSON.parse(logEntryInJsonFormat)
        console.error(JSON.stringify({ ...entry, ...workflowInfo }))
      },
      callDuringReplay: false,
    },
  },
}

export interface LoggerSink extends Sinks {
  logger: {
    info(logEntry: string): void
    error(logEntry: string): void
  }
}
export type DiachronicSinks = LoggerSink

const { logger } = wf.proxySinks<DiachronicSinks>()

export const defaultLogFunction = (logEntry: LogEntry) => {
  if (!inWorkflowContext()) {
    if (logEntry.level === 'FATAL' || logEntry.level === 'ERROR') {
      console.error(JSON.stringify(logEntry))
    } else {
      console.log(JSON.stringify(logEntry))
    }
    return
  }

  if (logEntry.level === 'FATAL' || logEntry.level === 'ERROR') {
    logger.error(JSON.stringify(logEntry))
  } else {
    logger.info(JSON.stringify(logEntry))
  }
}

export const TemporalLogLayer = (level: LogLevel.Literal) =>
  Layer.provideMerge(
    Logger.replace(
      Logger.defaultLogger,
      Logging.customLogger(defaultLogFunction)
    ),
    Logger.minimumLogLevel(LogLevel.fromLiteral(level))
  )
