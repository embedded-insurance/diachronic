import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { Effect } from 'effect'

export const expandHomedir = (s: string) => s.replace(/^~/, os.homedir())
export const resolveFilepath = (s: string, cwd: string = '.') => {
  if (s.startsWith('~')) {
    return expandHomedir(s)
  }
  return path.isAbsolute(s) ? s : path.resolve(cwd, s)
}

export const ensureDir = (dir: string) =>
  Effect.async<never, NodeJS.ErrnoException, void>((resume) =>
    fs.mkdir(dir, { recursive: true }, (e) =>
      resume(e ? Effect.fail(e) : Effect.succeed(Effect.unit))
    )
  )

export const writeFile = (
  path: fs.PathOrFileDescriptor,
  data: string | NodeJS.ArrayBufferView,
  options?: fs.WriteFileOptions
) =>
  Effect.async<never, NodeJS.ErrnoException, void>((respond) =>
    fs.writeFile(path, data, options || {}, (e) => {
      if (e) {
        return respond(Effect.fail(e))
      }
      return respond(Effect.succeed(Effect.unit))
    })
  )
