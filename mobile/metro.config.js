// Bundle Babel Room's shared, Node-free modules from ../src (the same code the
// CLI and the web UI use): translator.js, asr.js, util.js and fit.js. Only
// ../src is watched, so the parent's node_modules stays invisible and their
// dependencies resolve from this app's node_modules.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '..', 'src')]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = config
