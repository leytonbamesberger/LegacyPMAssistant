import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication, EventType } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import App from './App'
import { msalConfig } from './lib/msalConfig'
import './index.css'

const msalInstance = new PublicClientApplication(msalConfig)

// Set the active account on load and after every successful login, so hooks
// like useMsal()/useAccount() have a consistent account to read from.
const existing = msalInstance.getAllAccounts()
if (existing.length > 0) {
  msalInstance.setActiveAccount(existing[0])
}

msalInstance.addEventCallback((event) => {
  if (
    event.eventType === EventType.LOGIN_SUCCESS &&
    event.payload &&
    'account' in event.payload &&
    event.payload.account
  ) {
    msalInstance.setActiveAccount(event.payload.account)
  }
})

msalInstance.initialize().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </StrictMode>,
  )
})
