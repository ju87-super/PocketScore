import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './Root'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('PocketScore root element is missing')
}

// VexFlow's Bravura entry embeds its fonts. Wait for local font loading before layout.
void document.fonts.ready.then(() => {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
})
