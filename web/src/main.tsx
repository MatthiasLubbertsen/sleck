import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setNonce } from 'get-nonce'
import './index.css'
import { App } from './App'
import { TooltipProvider } from './components/ui/overlays'

// Radix (react-remove-scroll) injects <style>; the server issues a per-response nonce for it.
const nonce = document.querySelector<HTMLMetaElement>('meta[name=csp-nonce]')?.content
if (nonce && !nonce.startsWith('__')) setNonce(nonce)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
