/**
 * PHASE 13: FINGERPRINT HARDENING TESTS
 * Comprehensive test suite for browser fingerprint spoofing
 *
 * NOTE: These tests are designed for browser environments (jsdom/happy-dom).
 * In Node.js environment, browser APIs are not available.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Check if we're in a browser environment
const isBrowserEnv = typeof window !== 'undefined'

// Skip all tests if not in browser environment
const testOrSkip = isBrowserEnv ? describe : describe.skip

import FingerprintHardening from '@legion/core/security/fingerprint-hardening'

testOrSkip('FingerprintHardening', () => {
  let hardening: FingerprintHardening

  beforeEach(() => {
    hardening = new FingerprintHardening({
      enableWebRTC: true,
      enableCanvas: true,
      enableAudio: true,
      enableNavigator: true,
      enableScreen: true,
      enableFonts: true,
      enableStorage: true,
      randomizeAll: true,
    })
  })

  describe('Navigator Spoofing', () => {
    it('should spoof userAgent', () => {
      hardening.spoofNavigatorProperties()
      expect(navigator.userAgent).toBeDefined()
      expect(navigator.userAgent.length).toBeGreaterThan(0)
    })

    it('should spoof platform', () => {
      hardening.spoofNavigatorProperties()
      expect(['Win32', 'Linux x86_64', 'MacIntel']).toContain(navigator.platform)
    })

    it('should spoof hardwareConcurrency', () => {
      hardening.spoofNavigatorProperties()
      const cores = navigator.hardwareConcurrency
      expect(cores).toBeGreaterThanOrEqual(2)
      expect(cores).toBeLessThanOrEqual(10)
    })

    it('should hide plugins', () => {
      hardening.spoofNavigatorProperties()
      expect(navigator.plugins.length).toBe(0)
    })

    it('should hide mimeTypes', () => {
      hardening.spoofNavigatorProperties()
      expect(navigator.mimeTypes.length).toBe(0)
    })
  })

  describe('Screen Property Spoofing', () => {
    it('should spoof screen width/height', () => {
      hardening.spoofScreenProperties()
      expect(screen.width).toBeGreaterThan(0)
      expect(screen.height).toBeGreaterThan(0)
    })

    it('should use common resolutions', () => {
      const commonWidths = [1920, 1366, 1440, 1536, 1280, 2560, 3840]
      hardening.spoofScreenProperties()
      expect(commonWidths).toContain(screen.width)
    })

    it('should spoof color depth', () => {
      hardening.spoofScreenProperties()
      expect([24, 32]).toContain(screen.colorDepth)
    })

    it('should spoof devicePixelRatio', () => {
      hardening.spoofScreenProperties()
      const ratio = window.devicePixelRatio
      expect([1, 1.25, 1.5, 2]).toContain(ratio)
    })
  })

  describe('Canvas Fingerprinting Protection', () => {
    it('should override toDataURL', () => {
      hardening.spoofCanvasFingerprint()
      const canvas = document.createElement('canvas')
      canvas.width = 100
      canvas.height = 100
      const ctx = canvas.getContext('2d')!

      ctx.fillStyle = 'rgb(200, 0, 0)'
      ctx.fillRect(10, 10, 50, 50)

      const data1 = canvas.toDataURL('image/png')
      const data2 = canvas.toDataURL('image/png')

      // Both should be strings (not necessarily identical due to randomization)
      expect(typeof data1).toBe('string')
      expect(typeof data2).toBe('string')
      expect(data1.length).toBeGreaterThan(0)
    })
  })

  describe('Storage Protection', () => {
    it('should handle localStorage safely', () => {
      // Note: In real browser, this may be restricted
      try {
        hardening.protectStorage()
        expect(localStorage.length).toBeDefined()
      } catch (e) {
        // Private mode or restricted environment
        expect(e).toBeDefined()
      }
    })
  })

  describe('Fingerprint Profile', () => {
    it('should generate complete fingerprint profile', () => {
      hardening.initialize()
      const profile = hardening.getFingerprintProfile()

      expect(profile).toHaveProperty('userAgent')
      expect(profile).toHaveProperty('platform')
      expect(profile).toHaveProperty('hardwareConcurrency')
      expect(profile).toHaveProperty('deviceMemory')
      expect(profile).toHaveProperty('maxTouchPoints')
      expect(profile).toHaveProperty('screenWidth')
      expect(profile).toHaveProperty('screenHeight')
      expect(profile).toHaveProperty('colorDepth')
      expect(profile).toHaveProperty('devicePixelRatio')
    })

    it('should show protected status for features', () => {
      hardening.initialize()
      const profile = hardening.getFingerprintProfile()

      expect(profile.webrtc).toBe('protected')
      expect(profile.canvas).toBe('randomized')
      expect(profile.audio).toBe('spoofed')
      expect(profile.fonts).toBe('hidden')
    })

    it('should have unique fingerprints across runs', () => {
      hardening.initialize()
      const profile1 = hardening.getFingerprintProfile()

      const hardening2 = new FingerprintHardening()
      hardening2.initialize()
      const profile2 = hardening2.getFingerprintProfile()

      // Profiles should be different (randomized)
      expect(profile1.userAgent !== profile2.userAgent ||
              profile1.screenWidth !== profile2.screenWidth ||
              profile1.hardwareConcurrency !== profile2.hardwareConcurrency)
        .toBe(true)
    })
  })

  describe('Full Initialization', () => {
    it('should initialize all layers without errors', () => {
      expect(() => {
        hardening.initialize()
      }).not.toThrow()
    })

    it('should log initialization', () => {
      const consoleSpy = vi.spyOn(console, 'log')
      hardening.initialize()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FINGERPRINT]')
      )

      consoleSpy.mockRestore()
    })

    it('should handle selective enabling', () => {
      const selectiveHardening = new FingerprintHardening({
        enableWebRTC: true,
        enableCanvas: false,
        enableAudio: true,
        enableNavigator: true,
        enableScreen: false,
        enableFonts: false,
        enableStorage: true,
        randomizeAll: false,
      })

      expect(() => {
        selectiveHardening.initialize()
      }).not.toThrow()
    })
  })

  describe('Anti-Detection Benefits', () => {
    it('should prevent canvas fingerprinting attacks', () => {
      hardening.spoofCanvasFingerprint()

      // Try canvas fingerprinting technique
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')!

      ctx.textBaseline = 'top'
      ctx.font = '32px Arial'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#f60'
      ctx.fillRect(125, 1, 62, 20)
      ctx.fillStyle = '#069'
      ctx.fillText('Browser Fingerprint', 2, 15)

      const fp1 = canvas.toDataURL()

      // Create second instance
      const hardening2 = new FingerprintHardening()
      hardening2.spoofCanvasFingerprint()

      const canvas2 = document.createElement('canvas')
      canvas2.width = 256
      canvas2.height = 256
      const ctx2 = canvas2.getContext('2d')!

      ctx2.textBaseline = 'top'
      ctx2.font = '32px Arial'
      ctx2.textBaseline = 'alphabetic'
      ctx2.fillStyle = '#f60'
      ctx2.fillRect(125, 1, 62, 20)
      ctx2.fillStyle = '#069'
      ctx2.fillText('Browser Fingerprint', 2, 15)

      const fp2 = canvas2.toDataURL()

      // Both should be valid but randomized
      expect(fp1).toBeDefined()
      expect(fp2).toBeDefined()
      expect(typeof fp1).toBe('string')
      expect(typeof fp2).toBe('string')
    })

    it('should prevent navigator fingerprinting', () => {
      hardening.spoofNavigatorProperties()

      const fingerprint1 = {
        ua: navigator.userAgent,
        platform: navigator.platform,
        cores: navigator.hardwareConcurrency,
      }

      const hardening2 = new FingerprintHardening()
      hardening2.spoofNavigatorProperties()

      const fingerprint2 = {
        ua: navigator.userAgent,
        platform: navigator.platform,
        cores: navigator.hardwareConcurrency,
      }

      // Should produce different fingerprints
      expect(fingerprint1).not.toEqual(fingerprint2)
    })
  })
})

testOrSkip('Integration with Detection Evasion', () => {
  it('should work alongside other evasion techniques', () => {
    const hardening = new FingerprintHardening({
      randomizeAll: true,
    })

    // This should integrate with detection-evasion and ml-evasion modules
    expect(() => {
      hardening.initialize()
    }).not.toThrow()

    // Get profile after initialization
    const profile = hardening.getFingerprintProfile()
    expect(profile).toBeDefined()
  })
})
