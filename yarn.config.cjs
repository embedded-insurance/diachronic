/** @type {import('@yarnpkg/types')} */
const { defineConfig } = require('@yarnpkg/types')

const { resolutions } = require('./package.json')

const useResolvedPackageVersions = (Yarn) => {
  for (const dep of Yarn.dependencies()) {
    if (resolutions[dep.ident]) {
      dep.update(resolutions[dep.ident])
    }
  }
}

module.exports = defineConfig({
  async constraints({ Yarn }) {
    useResolvedPackageVersions(Yarn)
  },
})
