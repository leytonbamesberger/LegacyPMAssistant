import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  PublicClientApplication,
  EventType,
  type AuthenticationResult,
} from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import App from './App'
import { msalConfig } from './lib/msalConfig'
import './index.css'

const msalInstance = new PublicClientApplication(msalConfig)

function render() {
  createRoot(document.getElementById('root')!).render(
    // MsalProvider wraps StrictMode (not the other way around) so StrictMode's
    // double-invoke of effects doesn't fire MSAL's redirect handling twice,
    // which can strip the auth response from the URL before it's processed.
    <MsalProvider instance={msalInstance}>
      <StrictMode>
        <App />
      </StrictMode>
    </MsalProvider>,
  )
}

// All calls that touch the account cache must come after initialize() — in
// msal-browser v3 they otherwise throw `uninitialized_public_client_application`.
msalInstance
  .initialize()
  .then(() => {
    const existing = msalInstance.getAllAccounts()
    if (existing.length > 0) {
      msalInstance.setActiveAccount(existing[0])
    }

    msalInstance.addEventCallback((event) => {
      if (
        (event.eventType === EventType.LOGIN_SUCCESS ||
          event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS) &&
        event.payload &&
        'account' in event.payload &&
        event.payload.account
      ) {
        const result = event.payload as AuthenticationResult
        msalInstance.setActiveAccount(result.account)
      }
      if (event.eventType === EventType.LOGIN_FAILURE) {
        console.error('[msal] login failed:', event.error)
      }
    })

    // Complete any redirect sign-in that's coming back to this page. Surfacing
    // the error here makes AADSTS problems (e.g. redirect URI registered as
    // "Web" instead of "SPA") visible instead of a silent bounce to /login.
    return msalInstance
      .handleRedirectPromise()
      .then((result) => {
        if (result?.account) {
          msalInstance.setActiveAccount(result.account)
        }
      })
      .catch((err) => {
        console.error('[msal] handleRedirectPromise failed:', err)
      })
  })
  .catch((err) => {
    console.error('[msal] initialize failed:', err)
  })
  .finally(render)
