import XCTest

final class GameXRVisionAppUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCanonicalManifestHostAndControls() throws {
        let application = XCUIApplication()
        defer { application.terminate() }
        application.launch()

        let runtime = application.staticTexts["gamexr-native-runtime"]
        XCTAssertTrue(runtime.waitForExistence(timeout: 30))
        XCTAssertFalse(application.otherElements["gamexr-native-load-error"].exists)

        let manifestName = application.staticTexts["gamexr-native-manifest-name"]
        XCTAssertTrue(manifestName.waitForExistence(timeout: 10))
        XCTAssertEqual(manifestName.label, "Deep Space Flight")
        XCTAssertTrue(
            application.descendants(matching: .any)["gamexr-native-reality-view"]
                .waitForExistence(timeout: 10)
        )

        let fly = application.buttons["Fly"]
        let reset = application.buttons["Reset"]
        XCTAssertTrue(fly.waitForExistence(timeout: 10))
        XCTAssertTrue(reset.exists)

        fly.tap()
        XCTAssertTrue(application.buttons["Pause"].waitForExistence(timeout: 5))
        reset.tap()
        XCTAssertTrue(application.buttons["Pause"].waitForExistence(timeout: 5))
        application.buttons["Pause"].tap()
        XCTAssertTrue(application.buttons["Fly"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 2)

        let screenshot = XCTAttachment(screenshot: application.screenshot())
        screenshot.name = "GameXR visionOS native runtime"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
