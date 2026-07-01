import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../styles.css'
import './gallery.css'
import { Gallery } from './gallery'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>
)
