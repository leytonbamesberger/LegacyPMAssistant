import {
  LogLevel,
  type Configuration,
  type RedirectRequest,
} from '@azure/msal-browser'

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID
const redirectUri =
  import.meta.env.VITE_AZURE_REDIRECT_URI ?? window.location.origin

if (!clientId || !tenantId) {
  console.warn(
    '[msal] Missing VITE_AZURE_CLIENT_ID or VITE_AZURE_TENANT_ID. ' +
      'Login will not work until these are set.',
  )
}

/**
 * Single-tenant authority. Using the tenant ID here (rather than "common" or
 * "organizations") restricts sign-in to Legacy Mechanical's Azure AD tenant.
 */
export const msalConfig: Configuration = {
  auth: {
    clientId: clientId ?? '',
    authority: `https://login.microsoftonline.com/${tenantId ?? ''}`,
    knownAuthorities: [],
    redirectUri,
    postLogoutRedirectUri: `${window.location.origin}/login`,
    // SPA: process the auth response on the redirect URI page and stay there.
    // With the default (true), MSAL does a hard navigation back to the page
    // that started login, which races token caching and can dump the user
    // back on /login with a stuck `interaction_in_progress` flag.
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: import.meta.env.DEV ? LogLevel.Info : LogLevel.Warning,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return
        if (level === LogLevel.Error) console.error('[msal]', message)
        else if (level === LogLevel.Warning) console.warn('[msal]', message)
        else if (import.meta.env.DEV) console.info('[msal]', message)
      },
    },
  },
}

/** Scopes requested at login. `openid`/`profile` give us the ID token claims. */
export const loginRequest: RedirectRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
}
