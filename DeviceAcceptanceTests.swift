import XCTest

/// Opt-in physical-device smoke tests. Camera capture, NFC and supplier acceptance remain
/// separate cases in docs/react-native-testing.md; these tests do not simulate their success.
final class DeviceAcceptanceTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
    #if targetEnvironment(simulator)
    throw XCTSkip("Physical iPhone required; use ArtifactIntegrationTests for the simulator")
    #else
    guard ProcessInfo.processInfo.environment["SDK_DEVICE_ACCEPTANCE"] == "1" else {
      throw XCTSkip("Set SDK_DEVICE_ACCEPTANCE=1 in the test scheme after preparing a clean test device")
    }
    #endif
  }

  @MainActor
  func testInstalledDeviceHostShowsTheIdentityJourneys() {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.buttons["open-driver-license"].waitForExistence(timeout: 30))
    XCTAssertTrue(app.buttons["open-capture-flow"].exists)
    XCTAssertTrue(app.buttons["face-match-card"].exists)
    XCTAssertEqual(app.alerts.count, 0)
  }

  /// No card may be in the camera's field of view. This test acquires no personal evidence.
  @MainActor
  func testBackgroundingDocumentCameraRequiresExplicitRecovery() {
    let app = XCUIApplication()
    app.launch()
    let open = app.buttons["open-driver-license"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    open.tap()
    let start = app.buttons["start-document-front"]
    XCTAssertTrue(start.waitForExistence(timeout: 10), "Prepare an empty test holder before this test")
    start.tap()
    let permission = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
    if permission.waitForExistence(timeout: 3), permission.buttons["Allow"].exists {
      permission.buttons["Allow"].tap()
    }
    XCTAssertTrue(app.buttons["capture-document"].waitForExistence(timeout: 15))
    XCTAssertFalse(app.otherElements["document-bottom-sheet"].exists, "Camera startup must succeed")
    XCUIDevice.shared.press(.home)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10) || app.state == .runningBackgroundSuspended)
    app.activate()
    XCTAssertTrue(app.otherElements["document-bottom-sheet"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["retry-document"].exists)
    XCTAssertEqual(app.alerts.count, 0)
    app.buttons["document-back-to-identity"].tap()
    XCTAssertTrue(open.waitForExistence(timeout: 10))
  }
}
