import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../../components/App'
import '../../components/style.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
