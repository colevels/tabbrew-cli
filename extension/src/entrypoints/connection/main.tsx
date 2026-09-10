import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { browser } from 'wxt/browser'
import { App } from '../../components/App'
import '../../components/style.css'
import { CONNECTION_PAGE } from '../../utils/session'

// The CLI opens this page by URL with no way to tell whether one is already
// up, so a second copy yields to the first; and a page whose session has
// gone closes itself rather than lingering as a dead tab.
const me = await browser.tabs.getCurrent()
const closeSelf = () => {
  if (me?.id !== undefined) void browser.tabs.remove(me.id)
}

const twins = (
  await browser.tabs.query({ url: browser.runtime.getURL(`/${CONNECTION_PAGE}`) })
).filter((tab) => tab.id !== me?.id)
const first = twins[0]
if (first?.id !== undefined) {
  await browser.tabs.update(first.id, { active: true })
  closeSelf()
} else {
  const root = document.getElementById('root')
  if (!root) throw new Error('missing #root')
  createRoot(root).render(
    <StrictMode>
      <App onLost={closeSelf} />
    </StrictMode>,
  )
}
