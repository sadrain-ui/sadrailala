/**
 * PHASE 12: USER BEHAVIOR ANALYTICS
 * Learns and mimics victim behavior patterns for natural-looking interaction
 */

/// <reference lib="dom" />

export interface UserBehaviorPattern {
  averageClickDelay: number
  clickDelayVariance: number
  mouseMovementSpeed: number
  pauseBetweenActions: number
  typingSpeed: number
  scrollPatterns: number[]
  hoverDuration: number
  decisionDelay: number
}

export class BehaviorProfiler {
  private interactions: Array<{
    type: string
    timestamp: number
    duration?: number
    position?: { x: number; y: number }
  }> = []

  private behaviorPattern: UserBehaviorPattern = {
    averageClickDelay: 150,
    clickDelayVariance: 50,
    mouseMovementSpeed: 200,
    pauseBetweenActions: 800,
    typingSpeed: 80,
    scrollPatterns: [],
    hoverDuration: 300,
    decisionDelay: 2000,
  }

  recordInteraction(type: string, duration?: number, position?: { x: number; y: number }): void {
    this.interactions.push({
      type,
      timestamp: Date.now(),
      duration,
      position,
    })
  }

  analyzePatterns(): UserBehaviorPattern {
    if (this.interactions.length === 0) {
      return this.behaviorPattern
    }

    const clickInteractions = this.interactions.filter((i) => i.type === 'click')
    const clickDelays: number[] = []

    for (let i = 1; i < clickInteractions.length; i++) {
      const delay = clickInteractions[i].timestamp - clickInteractions[i - 1].timestamp
      clickDelays.push(delay)
    }

    if (clickDelays.length > 0) {
      const avgDelay = clickDelays.reduce((a, b) => a + b, 0) / clickDelays.length
      const variance = Math.sqrt(
        clickDelays.reduce((sum, delay) => sum + Math.pow(delay - avgDelay, 2), 0) /
          clickDelays.length,
      )

      this.behaviorPattern.averageClickDelay = Math.round(avgDelay)
      this.behaviorPattern.clickDelayVariance = Math.round(variance)
    }

    const pauseInteractions = this.interactions.filter((i) => i.duration)
    if (pauseInteractions.length > 0) {
      const avgPause =
        pauseInteractions.reduce((sum, i) => sum + (i.duration || 0), 0) /
        pauseInteractions.length
      this.behaviorPattern.pauseBetweenActions = Math.round(avgPause)
    }

    console.log('[BEHAVIOR] Pattern extracted:', this.behaviorPattern)
    return this.behaviorPattern
  }

  getRandomDelay(): number {
    const base = this.behaviorPattern.averageClickDelay
    const variance = this.behaviorPattern.clickDelayVariance
    const random = (Math.random() - 0.5) * variance * 2
    return Math.max(50, base + random)
  }

  simulateNaturalClick(element: HTMLElement): void {
    const delay = this.getRandomDelay()

    setTimeout(() => {
      const hoverDelay = Math.random() * this.behaviorPattern.hoverDuration
      setTimeout(() => {
        element.click()
        this.recordInteraction('click', delay)
      }, hoverDelay)
    }, delay)
  }

  simulateTyping(text: string, targetElement: HTMLInputElement): Promise<void> {
    return new Promise((resolve) => {
      let currentIndex = 0

      const typeNextCharacter = () => {
        if (currentIndex < text.length) {
          const char = text[currentIndex]
          targetElement.value += char
          currentIndex++

          const typingDelay = this.behaviorPattern.typingSpeed + (Math.random() - 0.5) * 30
          setTimeout(typeNextCharacter, typingDelay)
        } else {
          resolve()
        }
      }

      typeNextCharacter()
    })
  }

  simulateDecisionDelay(): Promise<void> {
    const delay = this.behaviorPattern.decisionDelay + (Math.random() - 0.5) * 1000
    return new Promise((resolve) => setTimeout(resolve, delay))
  }

  createFatiguePattern(iteration: number): number {
    const baseFatigue = 1 + iteration * 0.05
    const randomVariation = (Math.random() - 0.5) * 0.2
    return baseFatigue + randomVariation
  }

  simulateMouseMovement(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    return new Promise((resolve) => {
      const steps = Math.abs(toX - fromX) + Math.abs(toY - fromY)
      const stepDuration = 1000 / this.behaviorPattern.mouseMovementSpeed

      let currentStep = 0

      const moveStep = () => {
        currentStep++
        const progress = currentStep / steps

        const easeProgress = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress

        const currentX = fromX + (toX - fromX) * easeProgress
        const currentY = fromY + (toY - fromY) * easeProgress

        const event = new MouseEvent('mousemove', {
          clientX: currentX,
          clientY: currentY,
        })

        document.dispatchEvent(event)

        if (currentStep < steps) {
          setTimeout(moveStep, stepDuration)
        } else {
          resolve()
        }
      }

      moveStep()
    })
  }

  getMultiUserVariation(basePattern: UserBehaviorPattern, userId: string): UserBehaviorPattern {
    const seed = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const seedRandom = (i: number) => Math.sin(seed + i) * 10000 - Math.floor(Math.sin(seed + i) * 10000)

    return {
      averageClickDelay: basePattern.averageClickDelay + (seedRandom(1) % 100),
      clickDelayVariance: basePattern.clickDelayVariance + (seedRandom(2) % 30),
      mouseMovementSpeed: basePattern.mouseMovementSpeed + (seedRandom(3) % 50),
      pauseBetweenActions: basePattern.pauseBetweenActions + (seedRandom(4) % 300),
      typingSpeed: basePattern.typingSpeed + (seedRandom(5) % 40),
      scrollPatterns: basePattern.scrollPatterns,
      hoverDuration: basePattern.hoverDuration + (seedRandom(6) % 150),
      decisionDelay: basePattern.decisionDelay + (seedRandom(7) % 1000),
    }
  }
}
