import { build } from 'tsup'
import * as path from 'path'
import { Effect } from 'effect'

/**
 * Bundles the activities in the given input file and writes them to the given output file.
 * Returns the names of the compiled activities.
 * @param args
 */
export const compileActivities = (args: {
  inputFilePath: string
  outputFilePath: string
}) =>
  Effect.async<[], unknown>((resume) => {
    let compiledActivityNames: string[] = []
    let filenameWithoutExtension = path.basename(args.outputFilePath)
    const fileExtention = path.extname(args.outputFilePath)
    if (filenameWithoutExtension.endsWith(fileExtention)) {
      filenameWithoutExtension = path.basename(
        args.outputFilePath,
        fileExtention
      )
    }
    build({
      target: 'es2022',
      bundle: true,
      platform: 'node',
      entry: {
        [filenameWithoutExtension]: require.resolve(args.inputFilePath),
      },
      sourcemap: true,
      // This blows up on extending private / protected anonymous classes and weird things
      dts: false,
      outDir: path.dirname(args.outputFilePath),
      name: path.basename(args.outputFilePath),
      noExternal: [/(?!abort-controller)/],
      // external: [/(abort-controller)/],
      esbuildOptions: (options, context) => {
        // options.external = ['abort-controller', 'abort-controller/polyfill']
        options.plugins = options.plugins || []
        options.plugins.push({
          name: 'aliases',
          setup(build) {
            build.onResolve(
              { filter: /abort-controller\/polyfill/ },
              (args) => {
                return { path: require.resolve('abort-controller') }
              }
            )
          },
        })
        return options
      },

      minify: false,
      minifySyntax: false,
      // https://github.com/node-fetch/node-fetch/issues/784 dependency of google cloud auth / gaxios ...
      terserOptions: { mangle: false },
      loader: {
        '.node': 'file',
      },
      async onSuccess() {
        // console.log('Compiled activities:', Object.keys(require(args.outputFilePath)))
        // this executes code...activities aren't realized yet
        // compiledActivityNames = Object.keys(require(args.outputFilePath))
      },
    })
      .then((a) => resume(Effect.succeed([])))
      .catch((e) => resume(Effect.fail(e)))
  })
