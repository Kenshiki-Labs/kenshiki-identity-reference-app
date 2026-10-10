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

  @MainActor
  static func completeIntroductionIfShown(_ app: XCUIApplication) {
    let primary = app.buttons["first-run-primary"]
    guard primary.waitForExistence(timeout: 2) else { return }
    for _ in 0..<3 {
      let skip = app.buttons["first-run-skip"]
      let action = skip.exists ? skip : primary
      for _ in 0..<8 where !action.isHittable { app.swipeUp() }
      XCTAssertTrue(action.isHittable, "Introduction action must remain reachable at the current text size")
      action.tap()
    }
    XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
  }

  @MainActor
  func testFirstRunPermissionsCanBeSkippedAndStayCompleted() {
    let app = Self.hostApp()
    app.launchArguments = ["-kenshiki.reference.permissionsIntroduction.v1", "NO"]
    app.launch()
    XCTAssertTrue(app.staticTexts["Allow location"].waitForExistence(timeout: 20))
    XCTAssertTrue(app.buttons["first-run-primary"].exists)
    XCTAssertFalse(app.tabBars.firstMatch.exists)
    XCTAssertFalse(XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch.exists)
    for (index, title) in ["Allow location", "Allow Motion & Fitness", "Allow Bluetooth"].enumerated() {
      let heading = app.staticTexts["page-title"]
      XCTAssertTrue(heading.waitForExistence(timeout: 10))
      XCTAssertEqual(heading.label, title)
      let headingFrame = heading.frame
      let viewport = app.frame
      XCTAssertGreaterThan(headingFrame.width, 0)
      XCTAssertGreaterThan(headingFrame.height, 0)
      XCTAssertGreaterThanOrEqual(headingFrame.minY, viewport.minY)
      XCTAssertLessThan(headingFrame.minY, viewport.maxY)
      XCTAssertGreaterThanOrEqual(headingFrame.minX, viewport.minX)
      XCTAssertLessThanOrEqual(headingFrame.maxX, viewport.maxX)
      let overview = XCTAttachment(screenshot: app.screenshot())
      overview.name = "First run step \(index + 1) overview"
      overview.lifetime = .keepAlways
      add(overview)
      let skip = app.buttons["first-run-skip"]
      let action = skip.exists ? skip : app.buttons["first-run-primary"]
      for _ in 0..<8 where !action.isHittable { app.swipeUp() }
      XCTAssertTrue(action.isHittable, "Step \(index + 1) action must remain reachable")
      let controls = XCTAttachment(screenshot: app.screenshot())
      controls.name = "First run step \(index + 1) reachable actions"
      controls.lifetime = .keepAlways
      add(controls)
      action.tap()
    }
    XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
    app.terminate()
    app.launchArguments = []
    app.launch()
    XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
    XCTAssertFalse(app.buttons["first-run-primary"].exists)
  }

  /// Identity workflows explicitly choose their tab; Fusion is now the initial screen.
  @MainActor
  static func openIdentity(_ app: XCUIApplication) {
    let identity = app.tabBars.buttons["Identity"]
    XCTAssertTrue(identity.waitForExistence(timeout: 30))
    identity.tap()
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)

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
        "The sensor session could not be opened. Go back and try again.",
        "The request could not finish. Open Identity, then return to Sensors to try again.",
        "The sensor refresh stopped. Open Identity, then return to Sensors to try again.",
        "The sensors could not be read. Trying again.",
        "Sensors could not change activity state.",
        "Sensors could not close",
        "The sensor session could not close.",
        "Close and reopen the app before starting another check. Your saved results have not been erased."
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

  /// Exercises the real native navigation and shared signed-reading flow on a simulator.
  /// No synthetic pressure comparison is injected, and this does not qualify physical sensors.
  @MainActor
  func testFusionFirstTabMathAndSharedLiveReading() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("This navigation check avoids acquiring personal device observations")
    #endif
    let app = Self.hostApp()
    app.launchArguments = ["--reference-holder=" + UUID().uuidString]
    app.launch()
    Self.completeIntroductionIfShown(app)
    let tabs = app.tabBars.firstMatch
    XCTAssertTrue(tabs.waitForExistence(timeout: 30))
    XCTAssertEqual(tabs.buttons.allElementsBoundByIndex.map(\.label), ["Fusion", "Sensors", "Identity", "Settings"])
    func assertPage(_ title: String) {
      let heading = app.staticTexts["page-title"].firstMatch
      let shown = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", title), object: heading)
      XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 10), .completed, "The shared Page must show \(title)")
      XCTAssertTrue(app.staticTexts["page-wordmark"].firstMatch.exists)
    }
    assertPage("Fusion")

    func reveal(_ element: XCUIElement) {
      for _ in 0..<30 where !element.isHittable { app.swipeUp() }
      XCTAssertTrue(element.isHittable, element.label)
    }
    func back() {
      let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
      edge.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)))
    }
    let continuity = app.buttons["Continuity"]
    reveal(continuity)
    continuity.tap()
    let evaluate = app.buttons["Evaluate this reading"]
    XCTAssertTrue(evaluate.waitForExistence(timeout: 10))
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: evaluate)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed,
      "Initial Fusion focus opens the session and produces a signed Sensors reading")
    tabs.buttons["Sensors"].tap()
    assertPage("Sensors")
    XCTAssertTrue(app.buttons["About Motion"].waitForExistence(timeout: 20), "The shared sensor board must load")
    XCTAssertFalse(app.buttons["Pause sensors"].exists)
    XCTAssertFalse(app.buttons["Resume sensors"].exists)
    tabs.buttons["Fusion"].tap()
    assertPage("Continuity")
    XCTAssertTrue(evaluate.isEnabled, "The live Sensors reading is available in Fusion")
    evaluate.tap()
    let count = app.otherElements["continuity-pass-count"]
    XCTAssertTrue(count.waitForExistence(timeout: 10))
    reveal(count)
    XCTAssertTrue(count.exists, "Native continuity evaluation must succeed")
    let original = count.label

    let math = app.buttons["How this was worked out"]
    for _ in 0..<30 where !math.isHittable { app.swipeDown() }
    math.tap()
    let mathSheet = app.otherElements["fusion-math"]
    XCTAssertTrue(mathSheet.waitForExistence(timeout: 10))
    let done = mathSheet.buttons["modal-cancel"]
    XCTAssertTrue(done.waitForExistence(timeout: 10))
    done.tap()
    XCTAssertFalse(mathSheet.waitForExistence(timeout: 2))

    tabs.buttons["Sensors"].tap()
    assertPage("Sensors")
    XCTAssertTrue(app.buttons["About Motion"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Pause sensors"].exists)
    XCTAssertFalse(app.buttons["Resume sensors"].exists)
    tabs.buttons["Fusion"].tap()
    assertPage("Continuity")
    reveal(count)
    XCTAssertEqual(count.label, original, "Switching tabs retains the result without evaluating another reading")
    for _ in 0..<30 where !evaluate.isHittable { app.swipeDown() }
    evaluate.tap()
    let evaluated = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: evaluate)
    XCTAssertEqual(XCTWaiter.wait(for: [evaluated], timeout: 30), .completed)
    reveal(count)
    XCTAssertTrue(count.exists, "An explicit evaluation of the current live reading must return a result")
    let forget = app.buttons["Forget continuity history"]
    reveal(forget)
    forget.tap()
    XCTAssertTrue(app.sheets.firstMatch.waitForExistence(timeout: 10))
    app.sheets.buttons["Cancel"].tap()
    back()
    assertPage("Fusion")
    let air = app.buttons["Air check"]
    reveal(air)
    air.tap()
    assertPage("Air check")
    XCTAssertTrue(app.buttons["Run air check"].exists, "Air Check remains an explicit acquisition")
    back()
    assertPage("Fusion")
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
    _ = completeSyntheticSSN(app)
    app.terminate()
    app.launchArguments = ["--ssn-artifact-fixture", first]
    app.launch()
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { app.swipeUp() }
    open.tap()
    XCTAssertTrue(app.staticTexts["Not reported as issued"].waitForExistence(timeout: 10),
      "The same holder must reopen its saved check after relaunch")
    app.terminate()
    app.launchArguments = ["--ssn-artifact-fixture", second]
    app.launch()
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
    Self.completeIntroductionIfShown(app)
    Self.openIdentity(app)
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
