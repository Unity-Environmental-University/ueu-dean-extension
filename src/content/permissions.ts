/**
 * Permission gates — user must explicitly consent before we touch the SF API.
 *
 * Stored in extension storage so it persists across sessions.
 * Can be revoked from the overlay at any time.
 */

import browser from "webextension-polyfill"

const STORAGE_KEY = "ueu_permissions"

export interface Permissions {
  /** User has consented to SF API access */
  sfApi: boolean
}

const defaults: Permissions = {
  sfApi: false,
}

export async function getPermissions(): Promise<Permissions> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return { ...defaults, ...result[STORAGE_KEY] }
}

export async function setPermissions(perms: Partial<Permissions>): Promise<Permissions> {
  const current = await getPermissions()
  const updated = { ...current, ...perms }
  await browser.storage.local.set({ [STORAGE_KEY]: updated })
  return updated
}

export async function revokeAll(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}

const SETTINGS_KEY = "ueu_settings"

export interface Settings {
  /** Canvas user ID to receive diagnostic messages */
  supportCanvasId: string
}

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(SETTINGS_KEY)
  return { supportCanvasId: __SUPPORT_CANVAS_ID__, ...result[SETTINGS_KEY] }
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const updated = { ...current, ...settings }
  await browser.storage.local.set({ [SETTINGS_KEY]: updated })
  return updated
}

const CANVAS_CAP_KEY = "ueu_canvas_capabilities"

export interface CanvasCapabilities {
  /** Whether the logged-in Canvas user has "Become other users" permission. Cached across sessions. */
  canMasquerade: boolean | null
}

export async function getCanvasCapabilities(): Promise<CanvasCapabilities> {
  const result = await browser.storage.local.get(CANVAS_CAP_KEY)
  return { canMasquerade: null, ...result[CANVAS_CAP_KEY] }
}

export async function saveCanvasCapabilities(caps: Partial<CanvasCapabilities>): Promise<void> {
  const current = await getCanvasCapabilities()
  await browser.storage.local.set({ [CANVAS_CAP_KEY]: { ...current, ...caps } })
}
