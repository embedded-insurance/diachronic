import { exec } from './util'

export const tar = (from: string, to: string) =>
  exec(`tar -czf ${to} -C ${from} --strip-components=1 .`)

export const untar = (from: string, to: string) =>
  exec(`tar -xzf ${from} -C ${to}`)
