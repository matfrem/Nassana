import { GOOGLE_API_KEY, GOOGLE_PROJECT_NUMBER } from '../config'
import { getToken } from './auth'

interface PickerDoc {
  id: string
  name: string
}
interface PickerResponse {
  action: string
  docs?: PickerDoc[]
}
interface PickerView {
  setFileIds(ids: string): PickerView
}
interface PickerBuilder {
  addView(v: PickerView): PickerBuilder
  setOAuthToken(t: string): PickerBuilder
  setDeveloperKey(k: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setOrigin(o: string): PickerBuilder
  setTitle(t: string): PickerBuilder
  setCallback(cb: (r: PickerResponse) => void): PickerBuilder
  build(): { setVisible(v: boolean): void }
}
interface PickerApi {
  PickerBuilder: new () => PickerBuilder
  DocsView: new (viewId: unknown) => PickerView
  ViewId: { SPREADSHEETS: unknown }
  Action: { PICKED: string; CANCEL: string }
}

declare global {
  interface Window {
    gapi?: { load(api: string, cb: { callback: () => void; onerror?: () => void }): void }
  }
}

function pickerApi(): PickerApi | undefined {
  return (window.google as unknown as { picker?: PickerApi } | undefined)?.picker
}

let loading: Promise<void> | null = null
function loadPicker(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    if (pickerApi()) return resolve()
    const fail = () => {
      loading = null
      reject(new Error('Could not load the Google file picker. Check your connection or ad blocker.'))
    }
    const load = () => window.gapi!.load('picker', { callback: resolve, onerror: fail })
    if (window.gapi) return load()
    const s = document.createElement('script')
    s.src = 'https://apis.google.com/js/api.js'
    s.async = true
    s.onload = load
    s.onerror = fail
    document.head.appendChild(s)
  })
  return loading
}

/**
 * Opens the Google file picker on the user's Sheets. Picking a file is what grants
 * this app access to it. Pass `fileId` to show only that file.
 * Resolves with the picked Sheet, or null if the user cancelled.
 */
export async function pickSheet(fileId?: string): Promise<{ id: string; name: string } | null> {
  const [token] = await Promise.all([getToken(), loadPicker()])
  const picker = pickerApi()!
  const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
  if (fileId) view.setFileIds(fileId)

  return new Promise((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_PROJECT_NUMBER)
      .setOrigin(window.location.protocol + '//' + window.location.host)
      .setTitle('Choose a Google Sheet')
      .setCallback((r) => {
        if (r.action === picker.Action.PICKED && r.docs?.[0]) resolve(r.docs[0])
        else if (r.action === picker.Action.CANCEL) resolve(null)
      })
      .build()
      .setVisible(true)
  })
}
