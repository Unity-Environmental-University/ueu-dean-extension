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
  return { supportCanvasId: "", ...result[SETTINGS_KEY] }
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const updated = { ...current, ...settings }
  await browser.storage.local.set({ [SETTINGS_KEY]: updated })
  return updated
}
