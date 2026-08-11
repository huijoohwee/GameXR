import Testing
@testable import GameXRNative

@Test func persistentStrategyProjectionExposesOnlyAdjacentMoveTargets() {
    let projection = fixtureProjection()
    #expect(projection.availableTargets(for: "unit-verdant-1").map(\.id) == ["territory-1", "territory-5"])
    #expect(projection.availableTargets(for: "missing-unit").isEmpty)
}

@Test func persistentStrategyActionCarriesVisualIntentWithoutSimulationState() {
    let action = GameXRPersistentStrategyAction.move(
        unitID: "unit-verdant-1",
        targetTerritoryID: "territory-1"
    )
    #expect(action == .move(unitID: "unit-verdant-1", targetTerritoryID: "territory-1"))
}

@Test func persistentStrategySelectionReconcilesWhenDigestOrUnitLocationChanges() {
    let original = fixtureProjection()
    #expect(original.reconciledTargetID(
        for: "unit-verdant-1",
        preserving: "territory-5"
    ) == "territory-5")

    let moved = GameXRPersistentStrategyProjection(
        worldID: original.worldID,
        tick: 5,
        digest: "def456",
        factions: original.factions,
        territories: original.territories + [
            .init(id: "territory-2", neighborIDs: ["territory-1"], ownerFactionID: nil),
        ],
        units: [.init(
            id: "unit-verdant-1",
            factionID: "verdant",
            territoryID: "territory-1",
            strength: 1
        )]
    )
    #expect(moved.selectionRevision != original.selectionRevision)
    #expect(moved.reconciledTargetID(
        for: "unit-verdant-1",
        preserving: "territory-5"
    ) == "territory-0")
}

private func fixtureProjection() -> GameXRPersistentStrategyProjection {
    GameXRPersistentStrategyProjection(
        worldID: "native-world",
        tick: 4,
        digest: "abc123",
        factions: [.init(id: "verdant", supply: 5)],
        territories: [
            .init(id: "territory-0", neighborIDs: ["territory-1", "territory-5"], ownerFactionID: "verdant"),
            .init(id: "territory-1", neighborIDs: ["territory-0", "territory-2"], ownerFactionID: nil),
            .init(id: "territory-5", neighborIDs: ["territory-0", "territory-4"], ownerFactionID: nil),
        ],
        units: [.init(id: "unit-verdant-1", factionID: "verdant", territoryID: "territory-0", strength: 1)]
    )
}
