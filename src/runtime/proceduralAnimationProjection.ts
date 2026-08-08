import type { SceneManifest } from '../config/types.ts'

export interface ProceduralShipAnimationTargets {
  exhaustScaleY: number
  leftWingRotationZ: number
  rightWingRotationZ: number
}

export interface ProceduralWorldAnimationDelta {
  planetYaw: number
  asteroidFieldYaw: number
}

export function projectProceduralShipAnimation(
  animation: SceneManifest['animation'],
  elapsedSeconds: number,
  throttle: number,
): ProceduralShipAnimationTargets {
  const pulse = 1 + Math.sin(elapsedSeconds * animation.exhaustPulseSpeed) * animation.exhaustPulseAmount
  const wingFlex = Math.sin(elapsedSeconds * 2.2)
    * animation.wingFlexAmount
    * Math.max(0.2, Math.abs(throttle))
  return {
    exhaustScaleY: Math.max(0.18, 0.35 + Math.max(0, throttle) * 1.4) * pulse,
    leftWingRotationZ: wingFlex,
    rightWingRotationZ: -wingFlex,
  }
}

export function projectProceduralWorldAnimationDelta(
  scene: SceneManifest['scene'],
  animation: SceneManifest['animation'],
  deltaSeconds: number,
): ProceduralWorldAnimationDelta {
  const animationScale = animation.playing ? animation.timeScale : 0
  return {
    planetYaw: scene.planet.rotationSpeed * deltaSeconds * animationScale,
    asteroidFieldYaw: animation.asteroidDriftSpeed * deltaSeconds * animationScale * 0.05,
  }
}
