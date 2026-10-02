import { GOOGLE_CLIENT_ID } from '../config'

/**
 * Access only to the files the user explicitly picks with the Google Picker
 * (plus files this app created). Read and write, but nothing else in their Drive.
 */
export const SCOPE = 'https://www.googleapis.com/auth/drive.file'

const SIGNED_IN_KEY = 'nassana.signedIn'

/** Thrown when we have no valid token and cannot get one without user interaction. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Sign-in required')
  }
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type: string; message?: string }) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  gisPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisPromise = null
      reject(new Error('Could not load Google sign-in. Check your connection or ad blocker.'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

let token: { value: string; expiresAt: number } | null = null
let pending: Promise<string> | null = null

function readFlag(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === '1'
  } catch {
    return false
  }
}
function writeFlag(v: boolean) {
  try {
    if (v) localStorage.setItem(SIGNED_IN_KEY, '1')
    else localStorage.removeItem(SIGNED_IN_KEY)
  } catch {
    /* storage unavailable: fine, we just won't auto-reconnect */
  }
}

function requestToken(prompt: '' | 'consent' = ''): Promise<string> {
  pending ??= loadGis()
    .then(
      () =>
        new Promise<string>((resolve, reject) => {
          const client = window.google!.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPE,
            callback: (r) => {
              if (r.error || !r.access_token) {
                return reject(new Error(r.error_description ?? r.error ?? 'Sign-in failed'))
              }
              token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 - 60_000 }
              writeFlag(true)
              resolve(r.access_token)
            },
            error_callback: () => reject(new AuthRequiredError()),
          })
          client.requestAccessToken({ prompt })
        }),
    )
    .finally(() => {
      pending = null
    })
  return pending
}

/** Interactive sign-in. Must be called from a user gesture (button click). */
export function signIn(): Promise<string> {
  return requestToken()
}

/**
 * Returns a valid access token, refreshing silently if the user signed in before.
 * Throws AuthRequiredError if the user has to click "Sign in".
 */
export async function getToken(): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value
  if (!readFlag()) throw new AuthRequiredError()
  return requestToken()
}

export function invalidateToken() {
  token = null
}

export function signOut() {
  if (token) window.google?.accounts.oauth2.revoke(token.value)
  token = null
  writeFlag(false)
}
