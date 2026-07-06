import './browser-polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app'

const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)')

function applyColorScheme() {
  document.documentElement.classList.toggle('dark', colorSchemeMedia.matches)
}

applyColorScheme()
colorSchemeMedia.addEventListener('change', applyColorScheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
