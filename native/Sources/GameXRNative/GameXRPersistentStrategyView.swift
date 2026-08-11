import Foundation

public struct GameXRPersistentStrategyProjection: Equatable, Sendable {
    public struct Faction: Equatable, Identifiable, Sendable {
        public let id: String
        public let supply: Int

        public init(id: String, supply: Int) {
            self.id = id
            self.supply = supply
        }
    }

    public struct Territory: Equatable, Identifiable, Sendable {
        public let id: String
        public let neighborIDs: [String]
        public let ownerFactionID: String?

        public init(id: String, neighborIDs: [String], ownerFactionID: String?) {
            self.id = id
            self.neighborIDs = neighborIDs
            self.ownerFactionID = ownerFactionID
        }
    }

    public struct Unit: Equatable, Identifiable, Sendable {
        public let id: String
        public let factionID: String
        public let territoryID: String
        public let strength: Int

        public init(id: String, factionID: String, territoryID: String, strength: Int) {
            self.id = id
            self.factionID = factionID
            self.territoryID = territoryID
            self.strength = strength
        }
    }

    public let worldID: String
    public let tick: Int
    public let digest: String
    public let factions: [Faction]
    public let territories: [Territory]
    public let units: [Unit]

    public init(
        worldID: String,
        tick: Int,
        digest: String,
        factions: [Faction],
        territories: [Territory],
        units: [Unit]
    ) {
        self.worldID = worldID
        self.tick = tick
        self.digest = digest
        self.factions = factions
        self.territories = territories
        self.units = units
    }

    public func availableTargets(for unitID: String) -> [Territory] {
        guard let unit = units.first(where: { $0.id == unitID }),
              let current = territories.first(where: { $0.id == unit.territoryID }) else { return [] }
        let neighbors = Set(current.neighborIDs)
        return territories.filter { neighbors.contains($0.id) }.sorted { $0.id < $1.id }
    }

    func reconciledTargetID(for unitID: String, preserving targetID: String) -> String {
        let targets = availableTargets(for: unitID)
        return targets.contains(where: { $0.id == targetID }) ? targetID : targets.first?.id ?? ""
    }

    var selectionRevision: String {
        ([digest] + units.sorted { $0.id < $1.id }.map { "\($0.id)=\($0.territoryID)" })
            .joined(separator: "|")
    }
}

public enum GameXRPersistentStrategyAction: Equatable, Sendable {
    case move(unitID: String, targetTerritoryID: String)
    case claim(unitID: String, territoryID: String)
    case reset
    case close
}

#if canImport(SwiftUI)
import SwiftUI

public struct GameXRPersistentStrategyView: View {
    private let projection: GameXRPersistentStrategyProjection
    private let onAction: (GameXRPersistentStrategyAction) -> Void
    @State private var selectedUnitID: String
    @State private var selectedTargetID = ""

    public init(
        projection: GameXRPersistentStrategyProjection,
        onAction: @escaping (GameXRPersistentStrategyAction) -> Void
    ) {
        self.projection = projection
        self.onAction = onAction
        _selectedUnitID = State(initialValue: projection.units.first?.id ?? "")
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            factionSummary
            territoryGrid
            controls
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
        .onAppear { reconcileSelection() }
        .onChange(of: selectedUnitID) { _, _ in reconcileSelection() }
        .onChange(of: projection.selectionRevision) { _, _ in reconcileSelection() }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(projection.worldID).font(.headline)
                Text("Tick \(projection.tick) · \(projection.digest.prefix(12))")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Close") { onAction(.close) }
        }
    }

    private var factionSummary: some View {
        HStack {
            ForEach(projection.factions) { faction in
                Label("\(faction.id) \(faction.supply)", systemImage: "shippingbox.fill")
                    .font(.caption)
            }
        }
    }

    private var territoryGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96))], spacing: 8) {
            ForEach(projection.territories) { territory in
                VStack(alignment: .leading, spacing: 3) {
                    Text(territory.id).font(.caption.monospaced()).lineLimit(1)
                    Text(territory.ownerFactionID ?? "neutral").font(.caption2).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private var controls: some View {
        VStack(spacing: 10) {
            Picker("Unit", selection: $selectedUnitID) {
                ForEach(projection.units) { unit in Text(unit.id).tag(unit.id) }
            }
            Picker("Target", selection: $selectedTargetID) {
                ForEach(availableTargets) { territory in Text(territory.id).tag(territory.id) }
            }
            HStack {
                Button("Move + Commit") {
                    guard !selectedTargetID.isEmpty else { return }
                    onAction(.move(unitID: selectedUnitID, targetTerritoryID: selectedTargetID))
                }
                Button("Claim + Commit") {
                    guard let unit = selectedUnit else { return }
                    onAction(.claim(unitID: unit.id, territoryID: unit.territoryID))
                }
                Button("Reset", role: .destructive) { onAction(.reset) }
            }
        }
    }

    private var selectedUnit: GameXRPersistentStrategyProjection.Unit? {
        projection.units.first { $0.id == selectedUnitID }
    }

    private var availableTargets: [GameXRPersistentStrategyProjection.Territory] {
        projection.availableTargets(for: selectedUnitID)
    }

    private func reconcileSelection() {
        if selectedUnit == nil { selectedUnitID = projection.units.first?.id ?? "" }
        selectedTargetID = projection.reconciledTargetID(
            for: selectedUnitID,
            preserving: selectedTargetID
        )
    }
}
#endif
