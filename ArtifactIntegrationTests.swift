import XCTest

final class ArtifactIntegrationTests: XCTestCase {
  @MainActor
  func testUnavailableCameraOffersABottomSheetAndReturnToIdentity() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("This test exercises unavailable simulator camera hardware")
    #endif
    let app = XCUIApplication()
    app.launch()
    let open = app.buttons["open-capture-flow"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    open.tap()
    let start = app.buttons["start-passport-scan"]
    XCTAssertTrue(start.waitForExistence(timeout: 5))
    start.tap()
    let permission = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
    if permission.waitForExistence(timeout: 3), permission.buttons["Allow"].exists {
      permission.buttons["Allow"].tap()
    }
    let back = app.buttons["back-to-details"]
    XCTAssertTrue(back.waitForExistence(timeout: 15), "Unsupported hardware needs a way back")
    XCTAssertEqual(app.alerts.count, 0, "App recovery must not use a native alert")
    back.tap()
    XCTAssertTrue(open.waitForExistence(timeout: 5))
  }
  @MainActor
  func testInstalledPackageAcrossJavaScriptAndNativeBoundaries() throws {
    let app = XCUIApplication()
    app.launch()
    let checks = app.buttons["open-sdk-checks"]
    XCTAssertTrue(checks.waitForExistence(timeout: 30))
    checks.tap()
    let run = app.buttons["run-sdk-checks"]
    XCTAssertTrue(run.waitForExistence(timeout: 30), "Packaged React Native host did not load")
    run.tap()
    let status = app.staticTexts["sdk-check-status"]
    let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "10 checks passed"), object: status)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 30), .completed, status.label)
  }
}
