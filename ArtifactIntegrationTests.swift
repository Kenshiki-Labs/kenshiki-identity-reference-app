import XCTest

final class ArtifactIntegrationTests: XCTestCase {
  @MainActor
  func testUnavailablePhoneUsesBottomSheetAndReturnsToIdentity() {
    let app = XCUIApplication()
    app.launch()
    let open = app.buttons["open-phone"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { app.swipeUp() }
    open.tap()
    XCTAssertTrue(app.otherElements["phone-bottom-sheet"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.alerts.count, 0)
    app.buttons["phone-sheet-back"].tap()
    XCTAssertTrue(open.waitForExistence(timeout: 5))
  }

  @MainActor
  func testNativePhoneProviderRegistersAndUnsupportedTextMessagingDoesNotSend() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("This test requires unavailable simulator text messaging")
    #endif
    let app = XCUIApplication()
    app.launchArguments = ["--phone-artifact-fixture"]
    app.launch()
    let open = app.buttons["open-phone"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { app.swipeUp() }
    open.tap()
    let send = app.buttons["phone-send"]
    XCTAssertTrue(send.waitForExistence(timeout: 10))
    XCTAssertTrue(send.isEnabled)
    send.tap()
    XCTAssertTrue(app.otherElements["phone-bottom-sheet"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Text messaging is unavailable. Use an iPhone with text messaging enabled."].exists)
    XCTAssertEqual(app.alerts.count, 0)
    app.buttons["phone-sheet-back"].tap()
    XCTAssertTrue(open.waitForExistence(timeout: 5))
  }
  @MainActor
  func testUnavailableSSNProviderHasABottomSheetAndReturnToIdentity() {
    let app = XCUIApplication()
    app.launch()
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { app.swipeUp() }
    open.tap()
    XCTAssertTrue(app.otherElements["ssn-bottom-sheet"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.alerts.count, 0)
    XCTAssertFalse(app.buttons["ssn-confirm"].exists)
    XCTAssertFalse(app.buttons["Capture or choose ID"].exists)
    let back = app.buttons["ssn-back-to-identity"]
    XCTAssertTrue(back.waitForExistence(timeout: 5))
    back.tap()
    XCTAssertTrue(open.waitForExistence(timeout: 5))
  }

  @MainActor
  func testSyntheticSSNProviderThroughPackagedBridgeAndReopen() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("The synthetic provider is compiled only into the simulator host")
    #endif
    let app = XCUIApplication()
    app.launchArguments = ["--ssn-artifact-fixture", "--reference-holder=" + UUID().uuidString]
    app.launch()
    let open = completeSyntheticSSN(app)
    app.buttons["finish-ssn"].tap()
    XCTAssertTrue(open.waitForExistence(timeout: 5))
    open.tap()
    XCTAssertTrue(app.staticTexts["Not reported as issued"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.textFields["ssn-entry"].exists)
  }

  /// Enters the synthetic number for the simulator fixture, which reports area 000 as never issued.
  @MainActor
  private func completeSyntheticSSN(_ app: XCUIApplication) -> XCUIElement {
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { app.swipeUp() }
    open.tap()
    let begin = app.buttons["ssn-begin-entry"]
    XCTAssertTrue(begin.waitForExistence(timeout: 10))
    begin.tap()
    let entry = app.textFields["ssn-entry"]
    XCTAssertTrue(entry.waitForExistence(timeout: 5))
    entry.tap()
    entry.typeText("000001234")
    XCTAssertEqual(entry.value as? String, "000001234", "Fast entry must preserve every digit")
    XCTAssertTrue(app.buttons["ssn-review-number"].isEnabled)
    app.buttons["ssn-review-number"].tap()
    XCTAssertTrue(app.otherElements["ssn-bottom-sheet"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["ssn-confirmation-number"].label, "000-00-1234")
    XCTAssertEqual(app.alerts.count, 0)
    app.buttons["ssn-confirm"].tap()
    XCTAssertTrue(app.staticTexts["Not reported as issued"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Reported as issued"].exists)
    return open
  }

  /// Lifecycle J2: each holder has its own stores and stable workflows. The same holder reopens
  /// its saved check after relaunch; another holder on the same phone does not see it.
  @MainActor
  func testHolderScopedStoresReopenOnlyForTheSameHolder() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("The synthetic provider and holder argument exist only in the simulator host")
    #endif
    let first = "--reference-holder=" + UUID().uuidString
    let second = "--reference-holder=" + UUID().uuidString
    let app = XCUIApplication()
    app.launchArguments = ["--ssn-artifact-fixture", first]
    app.launch()
    _ = completeSyntheticSSN(app)
    app.terminate()
    app.launchArguments = ["--ssn-artifact-fixture", first]
    app.launch()
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { app.swipeUp() }
    open.tap()
    XCTAssertTrue(app.staticTexts["Not reported as issued"].waitForExistence(timeout: 10),
      "The same holder must reopen its saved check after relaunch")
    app.terminate()
    app.launchArguments = ["--ssn-artifact-fixture", second]
    app.launch()
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { app.swipeUp() }
    open.tap()
    XCTAssertTrue(app.buttons["ssn-begin-entry"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Not reported as issued"].exists, "Another holder must not see the first holder's check")
  }

  @MainActor
  func testBackgroundingCoversPersonalDataAndForegroundRemovesTheCover() {
    let app = XCUIApplication()
    app.launch()
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    XCTAssertFalse(app.otherElements["privacy-cover"].exists)
    XCUIDevice.shared.press(.home)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10) || app.state == .runningBackgroundSuspended)
    XCTAssertTrue(app.otherElements["privacy-cover"].exists, "The app-switcher snapshot must show the cover")
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    XCTAssertFalse(app.otherElements["privacy-cover"].waitForExistence(timeout: 2))
    XCTAssertTrue(open.waitForExistence(timeout: 5))
  }

  @MainActor
  func testDocumentCameraRecoveryReturnsToIdentityWithoutAnAlert() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("This test exercises unavailable simulator camera hardware")
    #endif
    let app = XCUIApplication()
    app.launch()
    let open = app.buttons["open-driver-license"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    open.tap()
    let start = app.buttons["start-document-front"]
    XCTAssertTrue(start.waitForExistence(timeout: 10))
    start.tap()
    let permission = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
    if permission.waitForExistence(timeout: 3), permission.buttons["Allow"].exists {
      permission.buttons["Allow"].tap()
    }
    let sheet = app.otherElements["document-bottom-sheet"]
    XCTAssertTrue(sheet.waitForExistence(timeout: 20), "Document camera failure must have a recovery sheet")
    XCTAssertEqual(app.alerts.count, 0, "App recovery must not use a native alert")
    let back = app.buttons["document-back-to-identity"]
    XCTAssertTrue(back.waitForExistence(timeout: 5))
    back.tap()
    XCTAssertTrue(open.waitForExistence(timeout: 5))
  }

  /// The generated simulator host has no passport trust anchors or face models.
  @MainActor
  func testMissingTrustAnchorsAndModelsDisableTheirCards() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--reference-holder=" + UUID().uuidString]
    app.launch()
    let passport = app.buttons["open-capture-flow"]
    XCTAssertTrue(passport.waitForExistence(timeout: 30))
    XCTAssertFalse(passport.isEnabled)
    XCTAssertFalse(app.buttons["face-match-card"].isEnabled)
    XCTAssertTrue(passport.label.contains("Passport chip checking is not set up in this app"), passport.label)
  }
  @MainActor
  func testNativeDocumentProviderAndDurableResultCommandsThroughInstalledPackage() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--document-check-artifact-fixture"]
    app.launch()
    let checks = app.buttons["open-sdk-checks"]
    XCTAssertTrue(checks.waitForExistence(timeout: 30))
    for _ in 0..<3 where !checks.isHittable { app.swipeUp() }
    checks.tap()
    let run = app.buttons["run-sdk-checks"]
    XCTAssertTrue(run.waitForExistence(timeout: 30))
    run.tap()
    let status = app.staticTexts["sdk-check-status"]
    let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "19 checks passed"), object: status)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 30), .completed, status.label)
    XCTAssertEqual(app.alerts.count, 0)
  }

  @MainActor
  func testInstalledPackageAcrossJavaScriptAndNativeBoundaries() throws {
    let app = XCUIApplication()
    app.launch()
    let checks = app.buttons["open-sdk-checks"]
    XCTAssertTrue(checks.waitForExistence(timeout: 30))
    for _ in 0..<3 where !checks.isHittable { app.swipeUp() }
    checks.tap()
    let run = app.buttons["run-sdk-checks"]
    XCTAssertTrue(run.waitForExistence(timeout: 30), "Packaged React Native host did not load")
    run.tap()
    let status = app.staticTexts["sdk-check-status"]
    let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "19 checks passed"), object: status)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 30), .completed, status.label)
  }
}
