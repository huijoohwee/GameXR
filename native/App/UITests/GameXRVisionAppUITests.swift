import XCTest

final class GameXRVisionAppUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCanonicalManifestFullImmersiveSceneAndControls() throws {
        let application = XCUIApplication()
        defer { application.terminate() }
        application.terminate()
        application.launch()

        let immersiveMarker = application.staticTexts["gamexr-native-full-scene-marker"]
        XCTAssertTrue(immersiveMarker.waitForExistence(timeout: 45))
        XCTAssertTrue(
            application.descendants(matching: .any)["gamexr-native-immersive-space"]
                .waitForExistence(timeout: 15)
        )
        XCTAssertFalse(application.otherElements["gamexr-native-load-error"].exists)
        let recoveryWindow = application.staticTexts["gamexr-native-runtime"]
        XCTAssertFalse(recoveryWindow.exists)
        XCTAssertFalse(application.buttons["gamexr-native-enter-full-scene"].exists)
        XCTAssertFalse(application.staticTexts["gamexr-native-manifest-name"].exists)
        XCTAssertFalse(application.staticTexts["gamexr-native-world-projection-error"].exists)
        let worldInventory = application.staticTexts["gamexr-native-world-inventory"]
        XCTAssertTrue(worldInventory.waitForExistence(timeout: 15))
        XCTAssertEqual(worldInventory.label, "900 stars, 32 asteroids, planet enabled")

        let flightToggle = application.buttons["gamexr-native-flight-toggle"]
        let reset = application.buttons["Reset"]
        let fullThrottle = application.buttons["gamexr-native-full-throttle"]
        let telemetry = application.staticTexts["gamexr-native-flight-telemetry"]
        XCTAssertTrue(flightToggle.waitForExistence(timeout: 10))
        XCTAssertEqual(flightToggle.label, "Fly")
        XCTAssertTrue(reset.exists)
        XCTAssertTrue(fullThrottle.exists)
        XCTAssertTrue(telemetry.waitForExistence(timeout: 5))
        let initialTelemetry = telemetry.label

        let fullSceneAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        fullSceneAttachment.name = "visionOS native full immersive scene"
        fullSceneAttachment.lifetime = .keepAlways
        add(fullSceneAttachment)

        fullThrottle.tap()
        flightToggle.tap()
        XCTAssertEqual(application.state, .runningForeground)
        let flightStarted = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Pause"),
            object: flightToggle
        )
        XCTAssertEqual(XCTWaiter.wait(for: [flightStarted], timeout: 5), .completed)
        let flightTicked = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label != %@", initialTelemetry),
            object: telemetry
        )
        XCTAssertEqual(XCTWaiter.wait(for: [flightTicked], timeout: 10), .completed)
        flightToggle.tap()
        let flightPaused = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Fly"),
            object: flightToggle
        )
        XCTAssertEqual(XCTWaiter.wait(for: [flightPaused], timeout: 5), .completed)
        let pausedTelemetry = telemetry.label
        Thread.sleep(forTimeInterval: 2)
        XCTAssertEqual(telemetry.label, pausedTelemetry)
        reset.tap()
        let flightReset = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", initialTelemetry),
            object: telemetry
        )
        XCTAssertEqual(XCTWaiter.wait(for: [flightReset], timeout: 5), .completed)
        XCTAssertEqual(flightToggle.label, "Fly")

        let exitFullScene = application.buttons["gamexr-native-exit-full-scene"]
        XCTAssertTrue(exitFullScene.waitForExistence(timeout: 10))
        exitFullScene.tap()
        XCTAssertTrue(recoveryWindow.waitForExistence(timeout: 30))
        let manifestName = application.staticTexts["gamexr-native-manifest-name"]
        XCTAssertTrue(manifestName.waitForExistence(timeout: 10))
        XCTAssertEqual(manifestName.label, "Deep Space Flight")
        XCTAssertEqual(
            application.staticTexts["gamexr-native-launcher-state"].label,
            "Full scene closed"
        )

        let resumeFullScene = application.buttons["gamexr-native-resume-full-scene"]
        XCTAssertTrue(resumeFullScene.waitForExistence(timeout: 10))
        XCTAssertFalse(application.buttons["gamexr-native-enter-full-scene"].exists)
        resumeFullScene.tap()
        XCTAssertTrue(immersiveMarker.waitForExistence(timeout: 45))
        XCTAssertTrue(recoveryWindow.waitForNonExistence(timeout: 10))
        XCTAssertTrue(worldInventory.waitForExistence(timeout: 15))
    }
}
