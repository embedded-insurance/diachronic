import * as Logger from 'effect/Logger'
import * as List from 'effect/List'
import * as Option from 'effect/Option'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as LogLevel from 'effect/LogLevel'
import * as Layer from 'effect/Layer'
import { Cause } from 'effect'

// a rainbow of colors from the visible spectrum
const terminalColorsVisibleSpectrumOfLight = {
  red: '\x1b[31m',
  orange: '\x1b[33m',
  yellow: '\x1b[93m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  indigo: '\x1b[94m',
  violet: '\x1b[35m',
}
export const red = (text: string) =>
  `${terminalColorsVisibleSpectrumOfLight.red}${text}\x1b[0m`
export const orange = (text: string) =>
  `${terminalColorsVisibleSpectrumOfLight.orange}${text}\x1b[0m`
export const yellow = (text: string) =>
  `${terminalColorsVisibleSpectrumOfLight.yellow}${text}\x1b[0m`
export const green = (text: string) =>
  `${terminalColorsVisibleSpectrumOfLight.green}${text}\x1b[0m`
export const blue = (text: string) =>
  `${terminalColorsVisibleSpectrumOfLight.blue}${text}\x1b[0m`
export const indigo = (text: string) =>
  `${terminalColorsVisibleSpectrumOfLight.indigo}${text}\x1b[0m`
export const violet = (text: string) =>
  `${terminalColorsVisibleSpectrumOfLight.violet}${text}\x1b[0m`
export const colorizedJSON = (json: string) => {
  const colorized = json
    .replace(/"([^"]+)":/g, (match, capture) => `"${violet(capture)}":`)
    .replace(/"([^"]+)"/g, (match, capture) => `"${blue(capture)}"`)
    .replace(/true/g, (match, capture) => `${green(match)}`)
    .replace(/false/g, (match, capture) => `${red(match)}`)
    .replace(/null/g, (match, capture) => `${yellow(match)}`)
  return colorized
}
// Do an arrow that starts on the first line and wraps around the left of the terminal and points to the next line
export const withArrow = (msg: string, data: string) =>
  `${msg}\n${data
    .split('\n')
    .map((l, i) => (i === 0 ? `└─> ${l}` : `   ${l}`))
    .join('\n')}`

export const prettyLog = (args: {
  span?: string
  message: string
  data?: string | undefined
}) => {
  let stmt = ''
  if (args.span) {
    stmt += `[${violet(args.span)}] `
  }
  stmt += args.message
  if (args.data) {
    console.log(withArrow(stmt, colorizedJSON(args.data)))
    return
  }
  console.log(stmt)
}

export const PrettyLogger = Logger.make<unknown, void>(
  ({
    fiberId,
    logLevel,
    message,
    cause,
    context,
    spans,
    annotations,
    date,
  }) => {
    // const meta = FiberRefs.getOrDefault(context, logMeta)
    const sp = List.head(spans)
    const span = Option.isSome(sp) ? sp.value : undefined
    const parent = pipe(List.tail(spans), Option.flatMap(List.head))
    const parentSpan = Option.isSome(parent) ? parent.value : undefined

    if (!Cause.isEmpty(cause)) {
      console.error(cause)
      // debugger
      return
    }
    const anno = HashMap.reduce(annotations, {}, (a, v, k) => ({
      ...a,
      [k]: v,
    }))

    if (!span?.label) {
      console.log(withArrow(message as string, JSON.stringify(anno, null, 2)))
      return
    }
    const datastring = JSON.stringify(anno, null, 2)
    const firstLine = `[${violet(span.label)}] ${message}`
    console.log(
      datastring === '{}'
        ? firstLine
        : withArrow(firstLine, colorizedJSON(datastring))
    )
  }
)
export const PrettyLogLayer = (level: LogLevel.Literal) =>
  Layer.provideMerge(
    Logger.replace(Logger.defaultLogger, PrettyLogger),
    Logger.minimumLogLevel(LogLevel.fromLiteral(level))
  )
