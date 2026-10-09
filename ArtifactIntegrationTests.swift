import XCTest

final class ArtifactIntegrationTests: XCTestCase {
  /// The app under test, loading the JavaScript bundle its Debug build embeds. Without this, the
  /// Debug build first asks for a Metro server that these tests never run; React Native reports the
  /// failed request as a warning, and the warning's banner covers the tab bar.
  static func hostApp() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["IDENTITY_HOST_EMBEDDED_JAVASCRIPT"] = "1"
    return app
  }

  /// Exercises the real packaged sensor bridge without granting permissions or requesting a fix.
  /// The board and its detail pages are the Sensors tab's stack and its settings are the Settings
  /// tab; both tabs share one session. Leaving them releases it, and returning must establish a
  /// new one.
  @MainActor
  func testSensorBoardNavigationScreenshotsAndSessionReopen() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("This navigation check avoids acquiring personal device observations")
    #endif
    let app = Self.hostApp()
    app.launchArguments = ["--reference-holder=" + UUID().uuidString]
    app.launch()

    func reveal(_ element: XCUIElement, upward: Bool = true) {
      for _ in 0..<30 where !element.isHittable {
        if upward { app.scrollViews.firstMatch.swipeUp() } else { app.scrollViews.firstMatch.swipeDown() }
      }
      XCTAssertTrue(element.isHittable, "Expected navigation control: \(element.label)")
    }
    func screenshot(_ name: String) {
      let attachment = XCTAttachment(screenshot: app.screenshot())
      attachment.name = name
      attachment.lifetime = .keepAlways
      add(attachment)
    }
    func back(from title: String) {
      XCTAssertTrue(app.staticTexts[title].firstMatch.waitForExistence(timeout: 10))
      app.buttons["page-back"].tap()
    }
    func assertNoSensorFailure() {
      XCTAssertEqual(app.alerts.count, 0)
      for failure in [
        "Sensors could not be opened.",
        "Sensors are not configured in this app.",
        "The request stopped. Check permissions or try again.",
        "Sensors could not change activity state.",
        "Sensors could not close"
      ] {
        XCTAssertFalse(app.staticTexts[failure].exists, failure)
      }
    }

    let tabs = app.tabBars.firstMatch
    XCTAssertTrue(tabs.waitForExistence(timeout: 30), "The root is a native tab bar")
    tabs.buttons["Sensors"].tap()
    XCTAssertTrue(app.staticTexts["Sensors"].firstMatch.waitForExistence(timeout: 10))
    // The detail link exists only after the real sensor bridge returns a board.
    let loadedBoard = app.buttons["About Motion"]
    XCTAssertTrue(loadedBoard.waitForExistence(timeout: 20))
    XCTAssertFalse(app.buttons["Pause sensors"].exists)
    XCTAssertFalse(app.buttons["Resume sensors"].exists)
    XCTAssertTrue(app.staticTexts["Last read"].exists)
    assertNoSensorFailure()
    screenshot("sensor-board-sensors")

    let motion = app.buttons["About Motion"]
    reveal(motion)
    motion.tap()
    XCTAssertTrue(app.staticTexts["Motion"].firstMatch.waitForExistence(timeout: 10), "Motion detail is a pushed screen")
    XCTAssertTrue(app.staticTexts["Motion"].firstMatch.exists)
    screenshot("sensor-board-motion-detail")
    back(from: "Motion")
    XCTAssertTrue(app.staticTexts["Sensors"].firstMatch.waitForExistence(timeout: 10))

    tabs.buttons["Settings"].tap()
    XCTAssertTrue(app.staticTexts["Settings"].firstMatch.waitForExistence(timeout: 10), "Settings is its own tab")
    XCTAssertTrue(app.buttons["Prepare export"].waitForExistence(timeout: 10))
    // Altering a signed reading is a developer's check: present in this Debug build only.
    XCTAssertTrue(app.buttons["sensor-tamper"].exists, "Debug builds offer the tamper check")
    let motionWindow = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", "motion reading time")).firstMatch
    reveal(motionWindow)
    XCTAssertTrue(motionWindow.exists, "Settings must expose the adjustable motion capture window")
    XCTAssertTrue(app.staticTexts["Shared motion capture"].exists)
    assertNoSensorFailure()
    screenshot("sensor-board-settings-reading-time")

    tabs.buttons["Identity"].tap()
    XCTAssertTrue(app.staticTexts["Identity"].firstMatch.waitForExistence(timeout: 10))
    tabs.buttons["Sensors"].tap()
    XCTAssertTrue(loadedBoard.waitForExistence(timeout: 20), "Returning restores the sensor board")
    XCTAssertFalse(app.buttons["Pause sensors"].exists)
    assertNoSensorFailure()
    screenshot("sensor-board-reopened")
    tabs.buttons["Identity"].tap()
    XCTAssertTrue(app.buttons["open-ssn"].waitForExistence(timeout: 10))
  }

  /// The native navigation: a tab bar whose tabs keep their own stacks; a pushed screen returns by
  /// the edge swipe; a capture opens as a full-screen modal and Cancel closes it; a destructive
  /// choice is an action sheet. Each screen is captured in light and dark appearance.
  @MainActor
  func testNativeNavigationTabsPushSwipeBackModalCancelAndActionSheet() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("The synthetic SSN provider and holder argument exist only in the simulator host")
    #endif
    let app = Self.hostApp()
    app.launchArguments = ["--ssn-artifact-fixture", "--reference-holder=" + UUID().uuidString]
    app.launch()
    addTeardownBlock { XCUIDevice.shared.appearance = .light }

    func screenshot(_ name: String) {
      let attachment = XCTAttachment(screenshot: app.screenshot())
      attachment.name = name
      attachment.lifetime = .keepAlways
      add(attachment)
    }
    func edgeSwipeBack() {
      let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
      edge.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)))
    }

    let tabs = app.tabBars.firstMatch
    let identity = app.staticTexts["Identity"].firstMatch
    let license = app.buttons["open-driver-license"]
    let ssn = app.buttons["open-ssn"]
    for appearance in [XCUIDevice.Appearance.light, .dark] {
      XCUIDevice.shared.appearance = appearance
      let suffix = appearance == .dark ? "dark" : "light"
      XCTAssertTrue(tabs.waitForExistence(timeout: 30), "The root is a native tab bar")
      tabs.buttons["Identity"].tap()
      XCTAssertTrue(identity.waitForExistence(timeout: 10), "Identity uses the shared page")
      XCTAssertTrue(license.waitForExistence(timeout: 10))
      let title = app.staticTexts["page-title"].firstMatch
      let wordmark = app.staticTexts["page-wordmark"].firstMatch
      XCTAssertEqual(title.label, "Identity")
      XCTAssertTrue(wordmark.exists, "The shared container supplies the wordmark")
      XCTAssertLessThanOrEqual(wordmark.frame.maxY, title.frame.minY)
      screenshot("identity-root-\(suffix)")

      // A pushed detail keeps its place when another tab is chosen, and leaves by the edge swipe.
      tabs.buttons["Sensors"].tap()
      XCTAssertTrue(app.staticTexts["Sensors"].firstMatch.waitForExistence(timeout: 10))
      XCTAssertTrue(app.buttons["About Motion"].waitForExistence(timeout: 20), "The board must load")
      XCTAssertFalse(app.buttons["Pause sensors"].exists)
      XCTAssertTrue(wordmark.exists, "Sensors uses the same page header")
      XCTAssertFalse(app.buttons["page-back"].exists, "A tab root has no Back button")
      screenshot("sensor-board-\(suffix)")
      let motion = app.buttons["About Motion"]
      let board = app.scrollViews.firstMatch
      for _ in 0..<12 where !motion.isHittable { board.swipeUp() }
      XCTAssertTrue(motion.isHittable, "The Motion action must be reachable inside the page scroller")
      motion.tap()
      XCTAssertTrue(app.staticTexts["Motion"].firstMatch.waitForExistence(timeout: 10), "A pushed detail")
      XCTAssertTrue(wordmark.exists)
      screenshot("pushed-detail-\(suffix)")
      tabs.buttons["Settings"].tap()
      XCTAssertTrue(app.staticTexts["Settings"].firstMatch.waitForExistence(timeout: 10))
      XCTAssertTrue(wordmark.exists)
      XCTAssertFalse(app.buttons["page-back"].exists)
      screenshot("settings-tab-\(suffix)")
      tabs.buttons["Sensors"].tap()
      XCTAssertTrue(app.staticTexts["Motion"].firstMatch.waitForExistence(timeout: 10),
        "Each tab keeps its own stack: Motion is still pushed")
      edgeSwipeBack()
      XCTAssertTrue(app.staticTexts["Sensors"].firstMatch.waitForExistence(timeout: 10), "Edge swipe pops the detail")
      XCTAssertFalse(app.buttons["page-back"].exists)

      // Both entry points open the same modal. Settings owns a live sensor session before this
      // transition, so its entry also exercises the change from sensor to identity ownership.
      if appearance == .light {
        tabs.buttons["Settings"].tap()
        let savedLicense = app.buttons["settings-license-checks"]
        for _ in 0..<20 where !savedLicense.isHittable { app.scrollViews.firstMatch.swipeUp() }
        XCTAssertTrue(savedLicense.isHittable)
        savedLicense.tap()
      } else {
        tabs.buttons["Identity"].tap()
        XCTAssertTrue(license.waitForExistence(timeout: 10))
        license.tap()
      }
      let start = app.buttons["start-document-front"]
      XCTAssertTrue(start.waitForExistence(timeout: 10), "The license capture opens as a modal")
      XCTAssertFalse(tabs.isHittable, "A full-screen modal covers the tab bar")
      XCTAssertTrue(wordmark.exists)
      screenshot("capture-modal-\(suffix)")
      app.buttons["modal-cancel"].tap()
      XCTAssertFalse(start.waitForExistence(timeout: 2), "Cancel dismisses the capture")
      XCTAssertTrue(tabs.isHittable, "Cancel restores the tab navigation")
      tabs.buttons["Identity"].tap()
      XCTAssertTrue(identity.waitForExistence(timeout: 10))

      // A destructive choice is an iOS action sheet, not a drawn overlay.
      ssn.tap()
      let erase = app.buttons["ssn-erase"]
      XCTAssertTrue(erase.waitForExistence(timeout: 10))
      erase.tap()
      let sheet = app.sheets.firstMatch
      XCTAssertTrue(sheet.waitForExistence(timeout: 10), "Erase asks with an action sheet")
      XCTAssertTrue(sheet.buttons["Erase checks"].exists)
      screenshot("action-sheet-\(suffix)")
      sheet.buttons["Keep checks"].tap()
      XCTAssertFalse(sheet.waitForExistence(timeout: 2))
      app.buttons["modal-cancel"].tap()
      XCTAssertTrue(identity.waitForExistence(timeout: 10))
    }
  }

  @MainActor
  func testUnavailablePhoneUsesBottomSheetAndReturnsToIdentity() {
    let app = Self.hostApp()
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
    let app = Self.hostApp()
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
    let app = Self.hostApp()
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
    let app = Self.hostApp()
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
    let app = Self.hostApp()
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
    let app = Self.hostApp()
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
    let app = Self.hostApp()
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
    let app = Self.hostApp()
    app.launchArguments = ["--reference-holder=" + UUID().uuidString]
    app.launch()
    let passport = app.buttons["open-capture-flow"]
    XCTAssertTrue(passport.waitForExistence(timeout: 30))
    XCTAssertFalse(passport.isEnabled)
    XCTAssertFalse(app.buttons["face-match-card"].isEnabled)
    let reason = app.staticTexts.matching(
      NSPredicate(format: "label CONTAINS %@", "Passport chip checking is not set up in this app")).firstMatch
    XCTAssertTrue(reason.exists, "The section footer says why the dimmed check cannot open")
  }
  @MainActor
  func testNativeDocumentProviderAndDurableResultCommandsThroughInstalledPackage() throws {
    let app = Self.hostApp()
    app.launchArguments = ["--document-check-artifact-fixture"]
    app.launch()
    let settings = app.tabBars.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
    let checks = app.buttons["open-sdk-checks"]
    XCTAssertTrue(app.scrollViews.firstMatch.waitForExistence(timeout: 30))
    for _ in 0..<30 where !checks.isHittable { app.scrollViews.firstMatch.swipeUp() }
    XCTAssertTrue(checks.isHittable)
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
    let app = Self.hostApp()
    app.launch()
    let settings = app.tabBars.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
    let checks = app.buttons["open-sdk-checks"]
    XCTAssertTrue(app.scrollViews.firstMatch.waitForExistence(timeout: 30))
    for _ in 0..<30 where !checks.isHittable { app.scrollViews.firstMatch.swipeUp() }
    XCTAssertTrue(checks.isHittable)
    checks.tap()
    let run = app.buttons["run-sdk-checks"]
    XCTAssertTrue(run.waitForExistence(timeout: 30), "Packaged React Native host did not load")
    run.tap()
    let status = app.staticTexts["sdk-check-status"]
    let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "19 checks passed"), object: status)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 30), .completed, status.label)
  }
}
