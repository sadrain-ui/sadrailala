/**
 * Active Session Management — WebHID / WebUSB deep-link for Universal Ingress hardware sync.
 * Ledger: WebHID (vendor 0x2c97). Trezor: WebUSB primary (vendor 0x534c), WebHID fallback.
 */

export const LEDGER_VENDOR_ID = 0x2c97
export const TREZOR_VENDOR_ID = 0x534c

export type HardwareDeepLinkSnapshot = {
  open: boolean
  vendor: 'ledger' | 'trezor' | null
  transport: 'webhid' | 'webusb' | null
}

/** Target lib.dom may omit WebHID / WebUSB — local surface for strict TypeScript. */
interface HardwareHidDevice {
  readonly vendorId: number
  readonly opened: boolean
  open(): Promise<void>
  close(): Promise<void>
}

interface HardwareUsbDevice {
  readonly vendorId: number
  readonly opened: boolean
  configuration: { configurationValue: number } | null
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
}

type HardwareNavigator = Navigator & {
  hid?: {
    requestDevice(opts: {
      filters: readonly { vendorId: number }[]
    }): Promise<HardwareHidDevice[]>
    getDevices(): Promise<HardwareHidDevice[]>
  }
  usb?: {
    requestDevice(opts: {
      filters: readonly { vendorId: number }[]
    }): Promise<HardwareUsbDevice>
    getDevices(): Promise<HardwareUsbDevice[]>
  }
}

function nav(): HardwareNavigator {
  return navigator as HardwareNavigator
}

let activeHid: HardwareHidDevice | null = null
let activeUsb: HardwareUsbDevice | null = null
let sessionListeners: Array<() => void> = []

function notifySessionListeners(): void {
  for (const fn of sessionListeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

export function subscribeHardwareDeepLink(callback: () => void): () => void {
  sessionListeners.push(callback)
  return () => {
    sessionListeners = sessionListeners.filter((f) => f !== callback)
  }
}

export function getHardwareDeepLinkSnapshot(): HardwareDeepLinkSnapshot {
  const hidOpen = Boolean(activeHid?.opened)
  const usbOpen = Boolean(activeUsb?.opened)
  if (hidOpen) {
    const vid = activeHid?.vendorId
    if (vid === LEDGER_VENDOR_ID) {
      return { open: true, vendor: 'ledger', transport: 'webhid' }
    }
    if (vid === TREZOR_VENDOR_ID) {
      return { open: true, vendor: 'trezor', transport: 'webhid' }
    }
    return { open: true, vendor: null, transport: 'webhid' }
  }
  if (usbOpen && activeUsb?.vendorId === TREZOR_VENDOR_ID) {
    return { open: true, vendor: 'trezor', transport: 'webusb' }
  }
  return { open: false, vendor: null, transport: null }
}

export async function releaseHardwareDeepLink(): Promise<void> {
  try {
    if (activeHid?.opened) {
      await activeHid.close()
    }
  } catch {
    /* ignore */
  }
  activeHid = null
  try {
    if (activeUsb?.opened) {
      await activeUsb.close()
    }
  } catch {
    /* ignore */
  }
  activeUsb = null
  notifySessionListeners()
}

async function openLedgerWebHidHandshake(): Promise<boolean> {
  const n = typeof navigator === 'undefined' ? null : nav()
  if (!n?.hid) return false
  try {
    const picked = await n.hid.requestDevice({
      filters: [{ vendorId: LEDGER_VENDOR_ID }],
    })
    const dev = picked[0]
    if (!dev) return false
    await dev.open()
    activeHid = dev
    notifySessionListeners()
    return true
  } catch {
    return false
  }
}

async function openTrezorWebUsbHandshake(): Promise<boolean> {
  const n = typeof navigator === 'undefined' ? null : nav()
  if (!n?.usb) return false
  try {
    const dev = await n.usb.requestDevice({
      filters: [{ vendorId: TREZOR_VENDOR_ID }],
    })
    await dev.open()
    if (dev.configuration == null) {
      await dev.selectConfiguration(1)
    }
    try {
      await dev.claimInterface(0)
    } catch {
      /* institutional bare handshake — interface claim varies by firmware */
    }
    activeUsb = dev
    notifySessionListeners()
    return true
  } catch {
    return false
  }
}

async function openTrezorWebHidHandshake(): Promise<boolean> {
  const n = typeof navigator === 'undefined' ? null : nav()
  if (!n?.hid) return false
  try {
    const picked = await n.hid.requestDevice({
      filters: [{ vendorId: TREZOR_VENDOR_ID }],
    })
    const dev = picked[0]
    if (!dev) return false
    await dev.open()
    activeHid = dev
    notifySessionListeners()
    return true
  } catch {
    return false
  }
}

/**
 * Raw transport handshake — establishes an Active Session Management channel for hardware-class Universal Ingress.
 */
export async function establishHardwareWebHidDeepLink(vendor: 'ledger' | 'trezor'): Promise<boolean> {
  await releaseHardwareDeepLink()
  if (vendor === 'ledger') {
    return openLedgerWebHidHandshake()
  }
  const usbOk = await openTrezorWebUsbHandshake()
  if (usbOk) return true
  return openTrezorWebHidHandshake()
}

/**
 * Aligns deep-link state with connector-derived vendor without redundant picker prompts when already open.
 */
export async function synchronizeActiveHardwareSession(
  vendor: 'ledger' | 'trezor' | null,
): Promise<void> {
  if (!vendor) {
    await releaseHardwareDeepLink()
    return
  }
  const snap = getHardwareDeepLinkSnapshot()
  if (snap.open && snap.vendor === vendor) return
  await establishHardwareWebHidDeepLink(vendor)
}

/** Passive probe — previously granted devices (no user gesture). */
export async function probeGrantedHardwareDeepLink(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false
    const n = nav()
    if (n.hid) {
      const list = await n.hid.getDevices()
      if (
        list.some(
          (d: HardwareHidDevice) =>
            d.vendorId === LEDGER_VENDOR_ID || d.vendorId === TREZOR_VENDOR_ID,
        )
      ) {
        return true
      }
    }
    if (n.usb) {
      const usb = await n.usb.getDevices()
      if (usb.some((d: HardwareUsbDevice) => d.vendorId === TREZOR_VENDOR_ID)) return true
    }
  } catch {
    return false
  }
  return false
}
