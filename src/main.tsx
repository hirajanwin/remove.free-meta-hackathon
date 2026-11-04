// Client entry point.
//
// This is a plain Vite + React single-page app. There is no server rendering:
// index.html is a static asset and everything below runs in the browser, which
// is what makes page loads free and unlimited on the Cloudflare free plan.
//
// TanStack *Router* is kept — it is a client-side router and already drives the
// generated route tree. TanStack *Start* (the SSR/server framework) is not used,
// and there is no server-side code of any kind: no Worker, no Pages Function.
// Nothing is metered, so traffic volume cannot exhaust a quota.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'

import { getRouter } from './router'
import './styles/app.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('No #root element found in index.html')
}

const router = getRouter()

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)

// Offline support. Registered only in production builds: in dev the worker
// would serve stale modules and fight Vite's HMR.
//
// Model weights are not handled here — transformers.js already persists them in
// its own Cache Storage bucket, so once a model has been used the app works
// with no network at all.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err)
    })
  })
}
