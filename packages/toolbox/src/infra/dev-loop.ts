import EventEmitter from 'events'
import * as chokidar from 'chokidar'
import { Effect } from 'effect'
import { ChildProcess } from 'child_process'
import * as readline from 'readline'
import { CLIGroup, CLIGroupDef } from '@diachronic/activity/cli'
import * as S from '@effect/schema/Schema'
import { KubernetesManifest } from './manifests'
import { streamLogs } from './kubernetes'
import { googleCloudLoggingLink, temporalUILink } from './links'
import { indigo, orange, prettyLog, withArrow } from './pretty-logger'
import { DiachronicCloudEnvironment, Environment } from './environment'

type Change = { path: string; timestamp: number }

const makeReadline = (cmds: CLIGroup<CLIGroupDef>, bus: EventEmitter) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line: string) => {
      const completions = Object.keys(cmds) || []
      const hits = completions.filter((c) => c.startsWith(line))
      // show all completions if none found
      const entry = [hits.length ? hits : completions, line]
      return entry
    },
    prompt: orange('> '),
    historySize: 100,
    terminal: true,
  })

  const parseCommand = (a: string) => {
    const [cmd, ...args] = a.split(' ')
    if (cmds[cmd]) {
      return [cmd, args]
    }
  }

  rl.on('line', (line) => {
    if (line === '') {
      bus.emit('manual-trigger')
      return
    }
    if (cmds) {
      const result = parseCommand(line)
      if (!result) {
        console.log(`Unknown command: ${line}`)
        rl.setPrompt(orange('> '))
        rl.prompt()
        return
      }
      const [cmd, args] = result
      // @ts-expect-error
      Effect.runPromise(cmds[cmd].apply(null, args)).catch((e) => {
        console.error('Command failed:', e)
        rl.setPrompt(orange('> '))
        rl.prompt()
      })
    }
  })
  return { rl }
}

const log = (message: string, data?: any) =>
  prettyLog({
    span: 'dev-loop',
    message: message,
    data: data
      ? typeof data === 'string'
        ? data
        : JSON.stringify(data, null, 2)
      : undefined,
  })

/**
 * Dev loop function.
 * Executes buildDeploy on file change.
 * If no files to watch provided, will restart on "Enter" keypress via stdin.
 * Queues changes while buildDeploy is running.
 * Deployments are not interrupted.
 * Queued changes run after a deployment is complete.
 */
export const devLoop = async (args: {
  environmentName: Environment
  buildDeploy: () => Promise<{ manifests: KubernetesManifest[] }>
  filepaths?: string[]
  commands?: CLIGroup<CLIGroupDef>
}) => {
  const { environmentName, buildDeploy, filepaths, commands } = args
  const bus = new EventEmitter()
  let isBuilding = false
  let buffer: Change[] = []
  let logStreams: {
    manifest: KubernetesManifest
    logStream: ChildProcess
    killAndClean: () => void
  }[] = []

  const queueRebuild = async (path: string, stats: any) => {
    if (isBuilding) {
      buffer.push({ path, timestamp: Date.now() })
      log('Change queued, waiting for last deploy to complete:', {
        path,
        stats,
        timestamp: Date.now(),
      })
      return
    }
    await watchLoop([{ path, timestamp: Date.now() }])
  }

  bus.on('manual-trigger', () => {
    queueRebuild('manual-trigger', { manual: true })
  })
  log('Press Enter to rebuild')

  if (filepaths) {
    log('Watching for changes to:', filepaths)
    const filewatcher = chokidar.watch(filepaths)
    filewatcher.on('change', (path, stats) => {
      log('File change detected', path)
      queueRebuild(path, stats)
    })
  }

  const watchLoop = async (changes: Change[], wasBuffered?: true) => {
    if (changes.length) {
      if (wasBuffered) {
        log('Changes were queued. Deploying them now:', changes)
      } else {
        log('Deploying changes:', changes)
      }
    }

    logStreams.forEach((x) => x.killAndClean())
    isBuilding = true
    const result = await buildDeploy()

    // if changes were queued, process (effectively) all of them by rebuilding
    if (buffer.length) {
      const changes = [...buffer]
      buffer = []
      await watchLoop(changes, true)
    }

    logStreams = result.manifests
      .filter((x) => x.apiVersion === 'apps/v1' && x.kind === 'Deployment')
      .map((dep) => {
        const s = Effect.runSync(streamLogs(dep.metadata as any))

        const name = dep.metadata.name
        const namespace = dep.metadata.namespace
        const version = dep.metadata.labels?.['diachronic/version-id']
        const workflowName = dep.metadata.labels?.['diachronic/workflow-name']
        const url = temporalUILink(environmentName, workflowName!)
        log('View in Temporal:', url)
        if (S.is(DiachronicCloudEnvironment)(environmentName)) {
          log(
            'View in Google Cloud Logging',
            googleCloudLoggingLink({
              environment: environmentName,
              workflowName: workflowName!,
              versionId: version!,
            })
          )
        }

        const onStderr = (a: Buffer) => {
          console.error('Watch error:', a.toString())
        }
        const onStdout = (a: Buffer) => {
          console.log(
            withArrow(indigo(`[${workflowName}/${version}]`), a.toString())
          )
        }

        s.stderr?.on('data', onStderr)
        s.stdout?.on('data', onStdout)
        s.on('error', () => {
          console.error('Watch error:', dep.metadata)
        })

        const killAndClean = () => {
          // console.log('gonna stop this', s)
          s.removeAllListeners()
          // s.once('exit', () => {
          //   console.log('Stream exited:', dep.metadata)
          // })
          // s.once('close', () => {
          //   console.log('Stream closed:', dep.metadata)
          // })
          s.kill('SIGKILL')
        }

        return {
          manifest: dep,
          logStream: s,
          killAndClean,
        }
      })

    isBuilding = false
  }

  // start the loop
  await watchLoop([])

  if (commands) {
    const { rl } = makeReadline(commands, bus)
    rl.setPrompt(orange('> '))
    rl.prompt()
  }
}
