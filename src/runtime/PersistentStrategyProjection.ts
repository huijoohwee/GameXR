import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three'
import {
  GAME_OS_MAX_FACTION_COUNT,
  type GameOsWorldState,
} from 'grph-shared/game-os/index'
import { disposeObject3D } from './resources.ts'

export const PERSISTENT_STRATEGY_VISUAL_CONFIG_EVENT = 'gamexr:persistent-strategy-visual-config'
export const PERSISTENT_STRATEGY_FACTION_ID_MAX_LENGTH = 100
export const PERSISTENT_STRATEGY_FACTION_ID_PATTERN =
  '^(?!(?:__proto__|constructor|prototype)$)(?!.*[\\u0000-\\u001f\\u007f])\\S(?:.*\\S)?$'

const persistentStrategyFactionIdPattern = new RegExp(PERSISTENT_STRATEGY_FACTION_ID_PATTERN, 'u')

export type PersistentStrategyVisualConfig = Readonly<{
  layoutRadius: number
  verticalVariation: number
  territorySize: number
  unitScale: number
  factionColors: Readonly<Record<string, number>>
  neutralColor: number
}>

export const DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG: PersistentStrategyVisualConfig = Object.freeze({
  layoutRadius: 4.2,
  verticalVariation: 0.18,
  territorySize: 0.58,
  unitScale: 1,
  factionColors: Object.freeze({}),
  neutralColor: 0x667085,
})

function boundedNumber(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a finite number from ${minimum} through ${maximum}.`)
  }
  return value
}

export function persistentStrategyRgbColor(value: unknown, name: string): number {
  const admitted = boundedNumber(value, name, 0, 0xffffff)
  if (!Number.isSafeInteger(admitted)) throw new Error(`${name} must be an integer color value.`)
  return admitted
}

export function persistentStrategyFactionId(value: unknown, name: string): string {
  if (
    typeof value !== 'string'
    || Array.from(value).length > PERSISTENT_STRATEGY_FACTION_ID_MAX_LENGTH
    || !persistentStrategyFactionIdPattern.test(value)
  ) {
    throw new Error(
      `${name} must be a trimmed, non-reserved faction ID of at most ${PERSISTENT_STRATEGY_FACTION_ID_MAX_LENGTH} characters.`,
    )
  }
  return value
}

export function normalizePersistentStrategyFactionColors(
  value: unknown,
  name = 'factionColors',
): Readonly<Record<string, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object keyed by faction ID.`)
  }
  const entries = Object.entries(value)
  if (entries.length > GAME_OS_MAX_FACTION_COUNT) {
    throw new Error(`${name} cannot configure more than ${GAME_OS_MAX_FACTION_COUNT} factions.`)
  }
  const colors: Record<string, number> = {}
  for (const [rawFactionId, rawColor] of entries) {
    const factionId = persistentStrategyFactionId(rawFactionId, `${name} key`)
    colors[factionId] = persistentStrategyRgbColor(rawColor, `${name}.${factionId}`)
  }
  return Object.freeze(colors)
}

function deterministicFactionColor(factionId: string): number {
  let hash = 0x811c9dc5
  for (const character of factionId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  const hue = (hash >>> 0) % 360
  const saturation = 0.62 + ((hash >>> 8) % 15) / 100
  const lightness = 0.52 + ((hash >>> 16) % 10) / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue / 60
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1))
  const channels = sector < 1 ? [chroma, secondary, 0]
    : sector < 2 ? [secondary, chroma, 0]
      : sector < 3 ? [0, chroma, secondary]
        : sector < 4 ? [0, secondary, chroma]
          : sector < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary]
  const match = lightness - chroma / 2
  const [red, green, blue] = channels.map(channel => Math.round((channel + match) * 255))
  return ((red ?? 0) << 16) | ((green ?? 0) << 8) | (blue ?? 0)
}

export function persistentStrategyFactionColor(
  factionId: string | null,
  config: PersistentStrategyVisualConfig,
): number {
  if (factionId === null) return config.neutralColor
  if (Object.hasOwn(config.factionColors, factionId)) return config.factionColors[factionId]!
  return deterministicFactionColor(factionId)
}

export type PersistentStrategyProjectionStatus = Readonly<{
  visible: boolean
  territoryCount: number
  unitCount: number
}>

export class PersistentStrategyProjection {
  readonly group = new Group()
  private config = DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG
  private state: Readonly<GameOsWorldState> | null = null
  private statusValue: PersistentStrategyProjectionStatus = Object.freeze({
    visible: false,
    territoryCount: 0,
    unitCount: 0,
  })

  constructor() {
    this.group.name = 'gamexr-persistent-strategy-projection'
    this.group.position.set(0, -0.7, -8)
    this.group.visible = false
  }

  update(state: Readonly<GameOsWorldState> | null): void {
    this.state = state
    this.render()
  }

  configure(input: Partial<PersistentStrategyVisualConfig>): PersistentStrategyVisualConfig {
    this.config = Object.freeze({
      layoutRadius: boundedNumber(input.layoutRadius ?? this.config.layoutRadius, 'layoutRadius', 2, 10),
      verticalVariation: boundedNumber(
        input.verticalVariation ?? this.config.verticalVariation,
        'verticalVariation',
        0,
        2,
      ),
      territorySize: boundedNumber(input.territorySize ?? this.config.territorySize, 'territorySize', 0.2, 1.5),
      unitScale: boundedNumber(input.unitScale ?? this.config.unitScale, 'unitScale', 0.4, 2.5),
      factionColors: input.factionColors === undefined
        ? this.config.factionColors
        : normalizePersistentStrategyFactionColors(input.factionColors),
      neutralColor: persistentStrategyRgbColor(input.neutralColor ?? this.config.neutralColor, 'neutralColor'),
    })
    this.render()
    return this.config
  }

  configuration(): PersistentStrategyVisualConfig {
    return this.config
  }

  private render(): void {
    this.clear()
    const state = this.state
    if (!state) return
    const territoryPositions = new Map<string, readonly [number, number, number]>()
    state.territories.forEach((territory, index) => {
      const angle = (index / Math.max(1, state.territories.length)) * Math.PI * 2 - Math.PI / 2
      const position = [
        Math.cos(angle) * this.config.layoutRadius,
        Math.sin(index * 1.7) * this.config.verticalVariation,
        Math.sin(angle) * this.config.layoutRadius,
      ] as const
      territoryPositions.set(territory.id, position)
      const territoryColor = persistentStrategyFactionColor(territory.ownerFactionId, this.config)
      const node = new Mesh(
        new SphereGeometry(this.config.territorySize, 20, 14),
        new MeshStandardMaterial({
          color: territoryColor,
          emissive: territoryColor,
          emissiveIntensity: territory.ownerFactionId ? 0.22 : 0.05,
          metalness: 0.15,
          roughness: 0.55,
        }),
      )
      node.name = `gamexr-territory:${territory.id}`
      node.position.set(...position)
      node.userData = {
        gameOsKind: 'territory',
        territoryId: territory.id,
        ownerFactionId: territory.ownerFactionId,
      }
      this.group.add(node)
    })

    for (const unit of state.units) {
      const territoryPosition = territoryPositions.get(unit.territoryId)
      if (!territoryPosition) continue
      const unitColor = persistentStrategyFactionColor(unit.factionId, this.config)
      const marker = new Mesh(
        new BoxGeometry(
          0.34 * this.config.unitScale,
          0.82 * this.config.unitScale,
          0.34 * this.config.unitScale,
        ),
        new MeshStandardMaterial({
          color: unitColor,
          emissive: unitColor,
          emissiveIntensity: 0.45,
          metalness: 0.35,
          roughness: 0.3,
        }),
      )
      marker.name = `gamexr-unit:${unit.id}`
      marker.position.set(territoryPosition[0], territoryPosition[1] + 0.78, territoryPosition[2])
      marker.userData = {
        gameOsKind: 'unit',
        unitId: unit.id,
        factionId: unit.factionId,
        territoryId: unit.territoryId,
      }
      this.group.add(marker)
    }
    this.group.visible = true
    this.statusValue = Object.freeze({
      visible: true,
      territoryCount: state.territories.length,
      unitCount: state.units.length,
    })
  }

  inspect(): PersistentStrategyProjectionStatus {
    return this.statusValue
  }

  dispose(): void {
    this.state = null
    this.clear()
    this.group.removeFromParent()
  }

  private clear(): void {
    for (const child of [...this.group.children]) disposeObject3D(child)
    this.group.visible = false
    this.statusValue = Object.freeze({ visible: false, territoryCount: 0, unitCount: 0 })
  }
}
