import cluster from 'cluster'

export const main = async () => {
  if (cluster.isPrimary) {
    return await require('./reload-worker/primary').main()
  } else {
    return await require('./reload-worker/thread').main()
  }
}

main().then(console.log)
