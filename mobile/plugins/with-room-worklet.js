// Links the native addons the room worklet (worklet/room.mjs: Hyperswarm,
// sodium, UDX) needs into react-native-bare-kit, the way @qvac/sdk/expo-plugin
// links the ones QVAC's worker needs.
//
// QVAC's plugin *replaces* bare-kit's addon folders with its own set, so this
// runs as a finalized mod, after every other mod, and only adds to them.
// Addons both worklets use are written once per version (same file name).
//
// The worklet bundle itself (worklet/room.bundle.js) is built by
// `npm run worklet`, which `npm run prebuild` runs first.

const fs = require('fs')
const path = require('path')
const { withFinalizedMod } = require('@expo/config-plugins')

const PLATFORMS = {
  ios: { hosts: ['ios-arm64', 'ios-arm64-simulator', 'ios-x64-simulator'], out: ['ios', 'addons'] },
  android: { hosts: ['android-arm64'], out: ['android', 'src', 'main', 'addons'] }
}

function bareKitDir (projectRoot) {
  return path.dirname(require.resolve('react-native-bare-kit/package.json', { paths: [projectRoot] }))
}

async function linkRoomAddons (projectRoot, platform) {
  const { hosts, out } = PLATFORMS[platform]
  if (platform === 'ios' && process.platform !== 'darwin') {
    console.warn('⚠ Babel Room: linking iOS addons needs macOS (bare-link signs frameworks); skipped.')
    return []
  }
  const entry = path.join(projectRoot, 'worklet', 'room.mjs')
  const bundle = path.join(projectRoot, 'worklet', 'room.bundle.js')
  if (!fs.existsSync(bundle)) throw new Error('Babel Room: worklet/room.bundle.js is missing. Run `npm run worklet` (npm run prebuild does it for you).')
  const { default: link } = await import('bare-link')
  const dest = path.join(bareKitDir(projectRoot), ...out)
  fs.mkdirSync(dest, { recursive: true })
  const written = []
  for await (const resource of link(entry, { hosts, out: dest })) written.push(resource)
  console.log(`🔗 Babel Room: linked ${written.length} room worklet addon files for ${hosts.join(', ')}`)
  return written
}

module.exports = function withRoomWorklet (config) {
  for (const platform of Object.keys(PLATFORMS)) {
    config = withFinalizedMod(config, [platform, async (cfg) => {
      await linkRoomAddons(cfg.modRequest.projectRoot, platform)
      return cfg
    }])
  }
  return config
}

module.exports._test = { PLATFORMS, linkRoomAddons }
