import { defineConfig } from 'wxt'
import pkg from '../package.json'
import { DEFAULT_PORTS, HOST } from '../src/core/session/protocol'

export default defineConfig({
  srcDir: 'src',
  // Finder cannot pick a dot-directory in "Load unpacked", so not `.output`.
  outDir: 'dist',
  imports: false,
  manifest: {
    name: 'TabBrew Session',
    description: 'Connects this browser to a running tabbrew session while the panel is open.',
    // The extension carries the CLI's version so a mismatch in the panel means
    // exactly one thing: the session was started by an older or newer tabbrew.
    version: pkg.version,
    minimum_chrome_version: '114',
    optional_host_permissions: DEFAULT_PORTS.map((port) => `http://${HOST}:${port}/*`),
    action: { default_title: 'TabBrew' },
  },
})
