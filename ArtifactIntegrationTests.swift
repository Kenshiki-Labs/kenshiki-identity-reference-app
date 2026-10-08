import XCTest

final class ArtifactIntegrationTests: XCTestCase {
  @MainActor
  func testUnavailableCameraOffersABottomSheetAndFreshStart() throws {
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
    let retry = app.buttons["retry-capture"]
    XCTAssertTrue(retry.waitForExistence(timeout: 15), "A stopped camera needs a recovery sheet")
    XCTAssertEqual(app.alerts.count, 0, "App recovery must not use a native alert")
    app.buttons["confirm-restart"].tap()
    XCTAssertTrue(start.waitForExistence(timeout: 5))
  }
  @MainActor
  func testInstalledPackageAcrossJavaScriptAndNativeBoundaries() throws {
    let app = XCUIApplication()
    app.launch()
    let run = app.buttons["run-sdk-checks"]
    XCTAssertTrue(run.waitForExistence(timeout: 30), "Packaged React Native host did not load")
    run.tap()
    let status = app.staticTexts["sdk-check-status"]
    let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "10 checks passed"), object: status)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 30), .completed, status.label)
  }
}
