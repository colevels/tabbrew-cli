import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

// The side panel is the connection; this worker only wires the toolbar icon
// to it and must never talk to the session itself.
export default defineBackground({
  type: 'module',
  main() {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  },
})
