import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import warmParchment from '../warmParchmentTheme'

// ── Inject theme colors as CSS variables ──
const root = document.documentElement
for (const [key, value] of Object.entries(warmParchment.colors)) {
  root.style.setProperty(`--wp-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, value as string)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
