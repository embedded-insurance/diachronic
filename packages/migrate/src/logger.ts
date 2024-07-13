export type Logger = {
  debug: (msg: string, args?: Record<string, any>, span?: string) => void
  info: (msg: string, args?: Record<string, any>, span?: string) => void
  error: (msg: string, args?: Record<string, any>, span?: string) => void
}

export const defaultLogImpl = {
  debug: () => {},
  info: () => {},
  error: () => {},
} satisfies Logger
