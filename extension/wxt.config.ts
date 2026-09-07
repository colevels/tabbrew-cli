import { defineConfig } from 'wxt'
import pkg from '../package.json'
import { DEFAULT_PORTS, EXTENSION_KEY, HOST } from '../src/core/session/protocol'

const repoUrl = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Finder cannot pick a dot-directory in "Load unpacked", so not `.output`.
  outDir: 'dist',
  imports: false,
  // This is the CLI's development harness, not the product extension; see README.md.
  manifest: {
    name: 'TabBrew CLI Harness',
    description:
      'Development harness for the tabbrew CLI. Exercises its browser protocol in a real Chrome. Not the TabBrew product extension.',
    // The extension carries the CLI's version so a mismatch in the panel means
    // exactly one thing: the session was started by an older or newer tabbrew.
    version: pkg.version,
    version_name: `${pkg.version} (harness)`,
    homepage_url: repoUrl,
    minimum_chrome_version: '114',
    // Pins the id, so the CLI can open connection.html by URL.
    key: EXTENSION_KEY,
    permissions: ['tabs', 'tabGroups'],
    // Required, not optional: the connection page opens without a user
    // gesture, so it could never ask for them.
    host_permissions: DEFAULT_PORTS.map((port) => `http://${HOST}:${port}/*`),
    action: { default_title: 'TabBrew CLI Harness' },
  },
})
