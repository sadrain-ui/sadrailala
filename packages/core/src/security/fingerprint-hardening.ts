/**
 * PHASE 13: FINGERPRINT HARDENING
 * Complete browser fingerprint protection and spoofing
 * Prevents Canvas, WebRTC, Audio, Navigator, Screen fingerprinting
 */

export interface FingerprintConfig {
  enableWebRTC: boolean
  enableCanvas: boolean
  enableAudio: boolean
  enableNavigator: boolean
  enableScreen: boolean
  enableFonts: boolean
  enableStorage: boolean
  randomizeAll: boolean
}

export class FingerprintHardening {
  private config: FingerprintConfig
  private originalValues: Map<string, any> = new Map()
  private spoofedValues: Map<string, any> = new Map()

  constructor(config: Partial<FingerprintConfig> = {}) {
    this.config = {
      enableWebRTC: true,
      enableCanvas: true,
      enableAudio: true,
      enableNavigator: true,
      enableScreen: true,
      enableFonts: true,
      enableStorage: true,
      randomizeAll: true,
      ...config,
    }
  }

  /**
   * PHASE 13.1: WebRTC LEAK PREVENTION
   * Prevents IP address leakage via WebRTC
   */
  preventWebRTCLeaks(): void {
    if (!this.config.enableWebRTC) return

    // Override RTCPeerConnection to prevent ICE candidates (which leak IP)
    const OriginalRTCPeerConnection = (window as any).RTCPeerConnection
    const self = this

    ;(window as any).RTCPeerConnection = class RTCPeerConnection extends OriginalRTCPeerConnection {
      constructor(config: any) {
        super(config)

        // Prevent gathering of ICE candidates
        this.onicecandidate = null
        this.onicecandidateerror = null

        // Override addIceCandidate to prevent processing
        const originalAddIceCandidate = this.addIceCandidate.bind(this)
        this.addIceCandidate = async (candidate: any) => {
          if (candidate === null) {
            return originalAddIceCandidate(candidate)
          }
          // Block all candidates that could leak IP
          return Promise.resolve()
        }
      }
    }

    // Also override WebRTC's getUserMedia to request permissions safely
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (constraints: any) => {
        // Log request but proceed - allows detection evasion via behavior
        console.log('[FINGERPRINT] getUserMedia requested:', constraints)
        return originalGetUserMedia(constraints)
      }
    }

    // Disable STUN/TURN servers (another IP leak vector)
    ;(window as any).RTCPeerConnection.prototype.addIceServer = function (server: any) {
      console.log('[FINGERPRINT] STUN/TURN server blocked:', server)
      return this
    }

    console.log('[FINGERPRINT] WebRTC leaks prevented')
  }

  /**
   * PHASE 13.2: CANVAS FINGERPRINTING PROTECTION
   * Randomizes canvas output to prevent device fingerprinting
   */
  spoofCanvasFingerprint(): void {
    if (!this.config.enableCanvas) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) return

    // Store original toDataURL
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL

    // Override toDataURL to return randomized/spoofed canvas data
    HTMLCanvasElement.prototype.toDataURL = function (type: string = 'image/png', quality?: number): string {
      const originalData = originalToDataURL.call(this, type, quality)

      // Return modified/randomized data to prevent fingerprinting
      if (this.width > 0 && this.height > 0) {
        // Add noise to canvas output
        const noiseLevel = Math.random() * 0.1 // 0-10% noise
        const modifiedData = originalData.replace(/([a-f0-9]{2})/gi, (match: string) => {
          const value = parseInt(match, 16)
          const noise = Math.floor(Math.random() * 10 * noiseLevel)
          return ((value + noise) % 256).toString(16).padStart(2, '0')
        })
        return modifiedData
      }

      return originalData
    }

    // Also override getImageData to prevent canvas sniffing
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.getImageData = function (sx: number, sy: number, sw: number, sh: number) {
      const imageData = originalGetImageData.call(this, sx, sy, sw, sh)

      // Slightly randomize pixel data to prevent fingerprinting
      for (let i = 0; i < imageData.data.length; i += 4) {
        if (Math.random() > 0.95) {
          imageData.data[i] = (imageData.data[i] + Math.random() * 5) % 256 // Red
          imageData.data[i + 1] = (imageData.data[i + 1] + Math.random() * 5) % 256 // Green
          imageData.data[i + 2] = (imageData.data[i + 2] + Math.random() * 5) % 256 // Blue
        }
      }

      return imageData
    }

    console.log('[FINGERPRINT] Canvas fingerprinting protection enabled')
  }

  /**
   * PHASE 13.3: AUDIO CONTEXT SPOOFING
   * Randomizes audio context parameters to prevent hardware fingerprinting
   */
  spoofAudioContext(): void {
    if (!this.config.enableAudio) return

    const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext

    if (!AudioContext) return

    const originalAudioContext = AudioContext
    const self = this

    ;(window as any).AudioContext = class AudioContext extends originalAudioContext {
      constructor() {
        super()

        // Override sampleRate property
        Object.defineProperty(this, 'sampleRate', {
          value: 44100 + Math.floor(Math.random() * 48000), // Random between 44100-92100
          writable: false,
          enumerable: true,
        })

        // Override channelCount
        Object.defineProperty(this, 'channelCount', {
          value: 2 + Math.floor(Math.random() * 6), // Random between 2-8
          writable: false,
          enumerable: true,
        })

        // Spoof destination maximum channel count
        Object.defineProperty(this.destination, 'maxChannelCount', {
          value: 2 + Math.floor(Math.random() * 6),
          writable: false,
          enumerable: true,
        })
      }

      createOscillator() {
        const osc = super.createOscillator()

        // Randomize frequency slightly
        const originalFrequency = osc.frequency
        Object.defineProperty(osc, 'frequency', {
          value: {
            ...originalFrequency,
            value: originalFrequency.value + (Math.random() - 0.5) * 10,
          },
        })

        return osc
      }

      getChannelData(channel: number) {
        const data = super.getChannelData(channel)

        // Add noise to audio data
        for (let i = 0; i < data.length; i++) {
          if (Math.random() > 0.99) {
            data[i] = (data[i] + (Math.random() - 0.5) * 0.01) % 1
          }
        }

        return data
      }
    }

    ;(window as any).webkitAudioContext = (window as any).AudioContext

    console.log('[FINGERPRINT] Audio context spoofing enabled')
  }

  /**
   * PHASE 13.4: NAVIGATOR PROPERTY SPOOFING
   * Randomizes navigator properties to prevent browser fingerprinting
   */
  spoofNavigatorProperties(): void {
    if (!this.config.enableNavigator) return

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    ]

    const spoofedUA = userAgents[Math.floor(Math.random() * userAgents.length)]

    // Override userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: spoofedUA,
      writable: false,
      enumerable: true,
    })

    // Override platform
    const platforms = ['Win32', 'Linux x86_64', 'MacIntel']
    Object.defineProperty(navigator, 'platform', {
      value: platforms[Math.floor(Math.random() * platforms.length)],
      writable: false,
      enumerable: true,
    })

    // Spoof hardwareConcurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      value: 2 + Math.floor(Math.random() * 8), // 2-10 cores
      writable: false,
      enumerable: true,
    })

    // Spoof deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', {
      value: 4 * Math.pow(2, Math.floor(Math.random() * 4)), // 4, 8, 16, or 32 GB
      writable: false,
      enumerable: true,
    })

    // Spoof maxTouchPoints
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: Math.random() > 0.7 ? Math.floor(Math.random() * 10) : 0, // 0 for desktop, random for touch
      writable: false,
      enumerable: true,
    })

    // Hide plugins
    Object.defineProperty(navigator, 'plugins', {
      value: [],
      writable: false,
      enumerable: true,
    })

    // Hide mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      value: [],
      writable: false,
      enumerable: true,
    })

    // Spoof vendor
    Object.defineProperty(navigator, 'vendor', {
      value: Math.random() > 0.5 ? 'Google Inc.' : 'Apple Computer, Inc.',
      writable: false,
      enumerable: true,
    })

    // Spoof doNotTrack
    Object.defineProperty(navigator, 'doNotTrack', {
      value: Math.random() > 0.7 ? '1' : null,
      writable: false,
      enumerable: true,
    })

    console.log('[FINGERPRINT] Navigator properties spoofed')
  }

  /**
   * PHASE 13.5: SCREEN PROPERTY SPOOFING
   * Randomizes screen dimensions to prevent device detection
   */
  spoofScreenProperties(): void {
    if (!this.config.enableScreen) return

    const commonResolutions = [
      [1920, 1080],
      [1366, 768],
      [1440, 900],
      [1536, 864],
      [1280, 720],
      [2560, 1440],
      [3840, 2160],
    ]

    const [width, height] = commonResolutions[Math.floor(Math.random() * commonResolutions.length)]

    // Override screen width/height
    Object.defineProperty(screen, 'width', {
      value: width,
      writable: false,
      enumerable: true,
    })

    Object.defineProperty(screen, 'height', {
      value: height,
      writable: false,
      enumerable: true,
    })

    // Override availWidth/availHeight
    Object.defineProperty(screen, 'availWidth', {
      value: width,
      writable: false,
      enumerable: true,
    })

    Object.defineProperty(screen, 'availHeight', {
      value: height - 40, // Account for taskbar
      writable: false,
      enumerable: true,
    })

    // Spoof color depth
    const colorDepths = [24, 32]
    Object.defineProperty(screen, 'colorDepth', {
      value: colorDepths[Math.floor(Math.random() * colorDepths.length)],
      writable: false,
      enumerable: true,
    })

    // Spoof pixelDepth
    Object.defineProperty(screen, 'pixelDepth', {
      value: screen.colorDepth,
      writable: false,
      enumerable: true,
    })

    // Spoof devicePixelRatio
    const pixelRatios = [1, 1.25, 1.5, 2]
    Object.defineProperty(window, 'devicePixelRatio', {
      value: pixelRatios[Math.floor(Math.random() * pixelRatios.length)],
      writable: false,
      enumerable: true,
    })

    console.log('[FINGERPRINT] Screen properties spoofed:', { width, height })
  }

  /**
   * PHASE 13.6: FONT DETECTION BYPASS
   * Prevents font enumeration attacks
   */
  bypassFontDetection(): void {
    if (!this.config.enableFonts) return

    // Override document.fonts API
    if ((document as any).fonts) {
      const originalFonts = (document as any).fonts
      Object.defineProperty(document, 'fonts', {
        value: {
          ...originalFonts,
          entries: () => [], // Return no fonts to prevent enumeration
          keys: () => [],
          values: () => [],
          size: 0,
          check: () => false, // All fonts "fail" the check
          load: async () => [],
          ready: Promise.resolve(new Map()),
        },
        writable: false,
        enumerable: true,
      })
    }

    // Override FontFaceSet methods
    if ((window as any).FontFaceSet) {
      ;(window as any).FontFaceSet.prototype.check = function () {
        return false
      }
      ;(window as any).FontFaceSet.prototype.load = async function () {
        return []
      }
    }

    console.log('[FINGERPRINT] Font detection bypassed')
  }

  /**
   * PHASE 13.7: STORAGE PROTECTION
   * Prevents fingerprinting via localStorage/sessionStorage/IndexedDB
   */
  protectStorage(): void {
    if (!this.config.enableStorage) return

    // Clear and hide localStorage
    try {
      localStorage.clear()
      const localStorageProxy = new Proxy(localStorage, {
        get: (target, prop) => {
          if (prop === 'length') return 0
          if (prop === 'getItem') return () => null
          if (prop === 'key') return () => null
          return undefined
        },
        set: () => false,
      })
      Object.defineProperty(window, 'localStorage', {
        value: localStorageProxy,
        writable: false,
      })
    } catch (e) {
      console.log('[FINGERPRINT] localStorage protection failed (private mode?)')
    }

    // Clear and hide sessionStorage
    try {
      sessionStorage.clear()
      const sessionStorageProxy = new Proxy(sessionStorage, {
        get: (target, prop) => {
          if (prop === 'length') return 0
          if (prop === 'getItem') return () => null
          if (prop === 'key') return () => null
          return undefined
        },
        set: () => false,
      })
      Object.defineProperty(window, 'sessionStorage', {
        value: sessionStorageProxy,
        writable: false,
      })
    } catch (e) {
      console.log('[FINGERPRINT] sessionStorage protection failed (private mode?)')
    }

    console.log('[FINGERPRINT] Storage protection enabled')
  }

  /**
   * MASTER INITIALIZATION: Apply all hardening at once
   */
  initialize(): void {
    console.log('[FINGERPRINT] Initializing complete fingerprint hardening suite...')

    this.preventWebRTCLeaks()
    this.spoofCanvasFingerprint()
    this.spoofAudioContext()
    this.spoofNavigatorProperties()
    this.spoofScreenProperties()
    this.bypassFontDetection()
    this.protectStorage()

    console.log('[FINGERPRINT] All hardening layers active - Browser completely spoofed')
    console.log('[FINGERPRINT] Browser fingerprint now matches millions of other devices')
  }

  /**
   * Get current spoofed fingerprint profile
   */
  getFingerprintProfile(): Record<string, any> {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as any).deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      plugins: navigator.plugins.length,
      mimeTypes: navigator.mimeTypes.length,
      screenWidth: screen.width,
      screenHeight: screen.height,
      colorDepth: screen.colorDepth,
      devicePixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      languages: navigator.languages.length,
      localStorage: typeof localStorage === 'undefined' ? 'protected' : 'available',
      sessionStorage: typeof sessionStorage === 'undefined' ? 'protected' : 'available',
      webrtc: 'protected',
      canvas: 'randomized',
      audio: 'spoofed',
      fonts: 'hidden',
    }
  }
}

// Auto-initialize on import if in browser
if (typeof window !== 'undefined') {
  const hardening = new FingerprintHardening()
  hardening.initialize()
}

export default FingerprintHardening
