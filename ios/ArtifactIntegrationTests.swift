import XCTest

final class ArtifactIntegrationTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// The app under test, loading the JavaScript bundle its Debug build embeds. Without this, the
  /// Debug build first asks for a Metro server that these tests never run; React Native reports the
  /// failed request as a warning, and the warning's banner covers the tab bar.
  static func hostApp() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["IDENTITY_HOST_EMBEDDED_JAVASCRIPT"] = "1"
    return app
  }

  /// Start drags inside unobstructed content, never over iOS's floating tab bar.
  @MainActor
  private static func scrollContent(_ app: XCUIApplication, upward: Bool = true) {
    let scroll = app.scrollViews.firstMatch
    let frame = scroll.frame
    let top = frame.minY + 30
    var bottom = frame.maxY - 30
    let tabs = app.tabBars.firstMatch
    if tabs.exists && tabs.isHittable { bottom = min(bottom, tabs.frame.minY - 20) }
    XCTAssertGreaterThan(bottom, top, "A content viewport must remain between native chrome")
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let start = origin.withOffset(CGVector(dx: frame.midX, dy: upward ? bottom : top))
    let end = origin.withOffset(CGVector(dx: frame.midX, dy: upward ? top : bottom))
    start.press(forDuration: 0.05, thenDragTo: end)
  }

  /// Reveal the entire control within the content viewport.
  @MainActor
  private static func revealFully(_ element: XCUIElement, in app: XCUIApplication, below header: XCUIElement) {
    XCTAssertTrue(element.waitForExistence(timeout: 10))
    for _ in 0..<16 {
      let frame = element.frame
      if element.isHittable && frame.minY >= header.frame.maxY && frame.maxY <= app.frame.maxY { break }
      if frame.minY < header.frame.maxY { Self.scrollContent(app, upward: false) }
      else { Self.scrollContent(app) }
    }
    XCTAssertTrue(element.isHittable, "\(element.identifier) must be reachable")
    XCTAssertGreaterThanOrEqual(element.frame.minY, header.frame.maxY)
    XCTAssertLessThanOrEqual(element.frame.maxY, app.frame.maxY)
    XCTAssertGreaterThanOrEqual(element.frame.minX, app.frame.minX)
    XCTAssertLessThanOrEqual(element.frame.maxX, app.frame.maxX)
  }

  @MainActor
  func testMainNativeHeadersAndNavigation() throws {
    try verifyMainNativeHeaders()
  }

  /// Checks only shared navigation chrome; no provider fixture or successful capture is required.
  @MainActor
  private func verifyMainNativeHeaders() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("This bounded UI check is for the development simulator host")
    #endif
    let app = Self.hostApp()
    app.launch()
    XCTAssertTrue(app.navigationBars["Fusion"].waitForExistence(timeout: 20))
    func tab(_ title: String) -> XCUIElement {
      app.tabBars.buttons[title]
    }
    func screenshot(_ name: String) {
      let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      attachment.name = name
      attachment.lifetime = .keepAlways
      add(attachment)
    }
    func header(_ title: String) {
      let bar = app.navigationBars[title]
      XCTAssertTrue(bar.waitForExistence(timeout: 10))
      XCTAssertFalse(app.staticTexts["page-wordmark"].exists)
      XCTAssertFalse(app.staticTexts["page-title"].exists)
      XCTAssertFalse(app.buttons["page-back"].exists)
      let heading = bar.staticTexts[title]
      XCTAssertTrue(heading.exists)
      XCTAssertTrue(app.frame.contains(heading.frame), "The native heading must fit the viewport")
      for name in ["Fusion", "Sensors", "Identity", "Settings"] {
        XCTAssertFalse(heading.frame.intersects(tab(name).frame), "The heading must not overlap the \(name) tab")
      }
      screenshot("Native header \(title)")
    }
    func finalAction(_ element: XCUIElement, on title: String) {
      let bar = app.navigationBars[title]
      Self.revealFully(element, in: app, below: bar)
      func overlapsTabs() -> Bool {
        if app.tabBars.firstMatch.exists && element.frame.intersects(app.tabBars.firstMatch.frame) { return true }
        return ["Fusion", "Sensors", "Identity", "Settings"].contains {
          element.frame.intersects(tab($0).frame)
        }
      }
      // A hittable row may still sit partly underneath the floating native tabs.
      // Scrolling must be able to place the entire final action above that obstruction.
      for _ in 0..<8 where overlapsTabs() { Self.scrollContent(app) }
      screenshot("Final action clear of tabs \(title)")
      XCTAssertTrue(element.isHittable)
      XCTAssertTrue(app.frame.contains(element.frame))
      XCTAssertGreaterThanOrEqual(element.frame.minY, bar.frame.maxY)
      XCTAssertFalse(overlapsTabs(), "The complete final \(title) action must clear native tabs")
    }
    for title in ["Fusion", "Sensors", "Identity", "Settings"] {
      XCTAssertTrue(tab(title).waitForExistence(timeout: 10))
      tab(title).tap()
      header(title)
      if title == "Fusion" { finalAction(app.buttons["Words used here"], on: title) }
      if title == "Settings" {
        // The asynchronously loaded sensor sections precede the final action.
        XCTAssertTrue(app.buttons["Prepare export"].waitForExistence(timeout: 20))
        finalAction(app.buttons["open-sdk-checks"], on: title)
      }
    }
    tab("Sensors").tap()
    let motion = app.buttons["About Motion"]
    XCTAssertTrue(motion.waitForExistence(timeout: 20))
    Self.revealFully(motion, in: app, below: app.navigationBars["Sensors"])
    motion.tap()
    header("Motion")
    tab("Settings").tap()
    header("Settings")
    tab("Sensors").tap()
    header("Motion")
    let back = app.navigationBars["Motion"].buttons.firstMatch
    XCTAssertTrue(back.isHittable)
    back.tap()
    header("Sensors")
    tab("Identity").tap()
    header("Identity")
    let license = app.buttons["open-driver-license"]
    Self.revealFully(license, in: app, below: app.navigationBars["Identity"])
    license.tap()
    header("Your license or state ID")
    app.buttons["start-license-capture"].tap()
    XCTAssertTrue(app.buttons["start-document-front"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["page-wordmark"].exists, "The capture retains its explicit shared close header")
    XCTAssertFalse(tab("Fusion").isHittable)
    screenshot("Capture modal shared header")
    let cancel = app.buttons["modal-cancel"]
    XCTAssertTrue(cancel.isHittable)
    XCTAssertTrue(app.frame.contains(cancel.frame))
    let wordmark = app.staticTexts["page-wordmark"]
    XCTAssertTrue(app.frame.contains(wordmark.frame))
    XCTAssertFalse(cancel.frame.intersects(wordmark.frame), "Close and branding must not overlap")
    if app.statusBars.firstMatch.exists {
      XCTAssertGreaterThanOrEqual(cancel.frame.minY, app.statusBars.firstMatch.frame.maxY)
      XCTAssertGreaterThanOrEqual(wordmark.frame.minY, app.statusBars.firstMatch.frame.maxY)
    }
    XCTAssertEqual(app.staticTexts.matching(identifier: "page-wordmark").count, 1)
    XCTAssertEqual(app.buttons.matching(identifier: "modal-cancel").count, 1)
    cancel.tap()
    header("Your license or state ID")
    app.navigationBars["Your license or state ID"].buttons.firstMatch.tap()
    header("Identity")
    XCTAssertTrue(tab("Fusion").isHittable)
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
    Self.openIdentity(app)

    func reveal(_ element: XCUIElement, upward: Bool = true) {
      for _ in 0..<30 where !element.isHittable {
        if upward { Self.scrollContent(app) } else { Self.scrollContent(app, upward: false) }
      }
      XCTAssertTrue(element.isHittable, "Expected navigation control: \(element.label)")
    }
    func screenshot(_ name: String) {
      let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      attachment.name = name
      attachment.lifetime = .keepAlways
      add(attachment)
    }
    func back(from title: String) {
      XCTAssertTrue(app.staticTexts[title].firstMatch.waitForExistence(timeout: 10))
      app.navigationBars[title].buttons.firstMatch.tap()
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
    // The shipped runtime has no way to alter a signed reading, so no build offers one.
    XCTAssertFalse(app.buttons["sensor-tamper"].exists, "No build offers a tamper control")
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
    let tabs = app.tabBars.firstMatch
    XCTAssertTrue(tabs.waitForExistence(timeout: 30))
    XCTAssertEqual(tabs.buttons.allElementsBoundByIndex.map(\.label), ["Fusion", "Sensors", "Identity", "Settings"])
    func assertPage(_ title: String) {
      XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10))
      XCTAssertFalse(app.staticTexts["page-title"].exists)
      XCTAssertFalse(app.staticTexts["page-wordmark"].exists)
    }
    assertPage("Fusion")

    func reveal(_ element: XCUIElement) {
      for _ in 0..<30 where !element.isHittable { Self.scrollContent(app) }
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
    for _ in 0..<30 where !math.isHittable { Self.scrollContent(app, upward: false) }
    math.tap()
    let mathSheet = app.otherElements["fusion-math"]
    XCTAssertTrue(mathSheet.waitForExistence(timeout: 10))
    mathSheet.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.03))
      .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
    XCTAssertTrue(mathSheet.waitForNonExistence(timeout: 5), "Informational math can be dismissed by a native swipe")
    math.tap()
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
    for _ in 0..<30 where !evaluate.isHittable { Self.scrollContent(app, upward: false) }
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
    let completedAir = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let retry = app.buttons["Retry air check"]
      let refresh = app.buttons["Refresh air check"]
      return (retry.exists && retry.isEnabled) || (refresh.exists && refresh.isEnabled)
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [completedAir], timeout: 45), .completed,
      "Air Check runs on entry and offers retry or refresh without a start tap")
    back()
    assertPage("Fusion")
  }

  /// The native navigation: a tab bar whose tabs keep their own stacks; a pushed screen returns by
  /// the edge swipe; a capture opens as a full-screen modal and Cancel closes it.
  /// Each screen is captured in light and dark appearance.
  @MainActor
  func testNativeNavigationTabsPushSwipeBackAndModalCancel() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("The synthetic SSN provider and holder argument exist only in the simulator host")
    #endif
    let app = Self.hostApp()
    app.launchArguments = ["--ssn-artifact-fixture", "--reference-holder=" + UUID().uuidString]
    app.launch()
    Self.openIdentity(app)
    addTeardownBlock { XCUIDevice.shared.appearance = .light }

    func screenshot(_ name: String) {
      let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
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
    for appearance in [XCUIDevice.Appearance.light, .dark] {
      XCUIDevice.shared.appearance = appearance
      let suffix = appearance == .dark ? "dark" : "light"
      XCTAssertTrue(tabs.waitForExistence(timeout: 30), "The root is a native tab bar")
      tabs.buttons["Identity"].tap()
      XCTAssertTrue(identity.waitForExistence(timeout: 10), "Identity uses the shared page")
      XCTAssertTrue(license.waitForExistence(timeout: 10))
      let wordmark = app.staticTexts["page-wordmark"].firstMatch
      XCTAssertTrue(app.navigationBars["Identity"].exists)
      XCTAssertFalse(app.staticTexts["page-title"].exists)
      XCTAssertFalse(wordmark.exists, "Native headers own the main screen chrome")
      screenshot("identity-root-\(suffix)")

      // A pushed detail keeps its place when another tab is chosen, and leaves by the edge swipe.
      tabs.buttons["Sensors"].tap()
      XCTAssertTrue(app.staticTexts["Sensors"].firstMatch.waitForExistence(timeout: 10))
      XCTAssertTrue(app.buttons["About Motion"].waitForExistence(timeout: 20), "The board must load")
      XCTAssertFalse(app.buttons["Pause sensors"].exists)
      XCTAssertFalse(wordmark.exists, "Sensors uses its native stack header")
      XCTAssertFalse(app.buttons["page-back"].exists, "A tab root has no Back button")
      screenshot("sensor-board-\(suffix)")
      let motion = app.buttons["About Motion"]
      for _ in 0..<12 where !motion.isHittable { Self.scrollContent(app) }
      XCTAssertTrue(motion.isHittable, "The Motion action must be reachable inside the page scroller")
      motion.tap()
      XCTAssertTrue(app.staticTexts["Motion"].firstMatch.waitForExistence(timeout: 10), "A pushed detail")
      XCTAssertFalse(wordmark.exists)
      XCTAssertTrue(app.navigationBars["Motion"].buttons.firstMatch.isHittable)
      screenshot("pushed-detail-\(suffix)")
      tabs.buttons["Settings"].tap()
      XCTAssertTrue(app.staticTexts["Settings"].firstMatch.waitForExistence(timeout: 10))
      XCTAssertFalse(wordmark.exists)
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
        for _ in 0..<20 where !savedLicense.isHittable { Self.scrollContent(app) }
        XCTAssertTrue(savedLicense.isHittable)
        savedLicense.tap()
      } else {
        tabs.buttons["Identity"].tap()
        XCTAssertTrue(license.waitForExistence(timeout: 10))
        license.tap()
        XCTAssertTrue(app.buttons["start-license-capture"].waitForExistence(timeout: 10))
        app.buttons["start-license-capture"].tap()
      }
      let start = app.buttons["start-document-front"]
      XCTAssertTrue(start.waitForExistence(timeout: 10), "The license capture opens as a modal")
      XCTAssertFalse(tabs.isHittable, "A full-screen modal covers the tab bar")
      XCTAssertTrue(wordmark.exists)
      screenshot("capture-modal-\(suffix)")
      app.buttons["modal-cancel"].tap()
      XCTAssertFalse(start.waitForExistence(timeout: 2), "Cancel dismisses the capture")
      XCTAssertTrue(tabs.isHittable, "Cancel restores the tab navigation")
      XCTAssertTrue(app.navigationBars["Your license or state ID"].waitForExistence(timeout: 10))
      app.navigationBars["Your license or state ID"].buttons.firstMatch.tap()
      XCTAssertTrue(identity.waitForExistence(timeout: 10))
    }
  }


  /// Kept separate from chrome acceptance: provider registration alone does not seed the
  /// document and phone evidence needed to reach SSN in the current reference application.
  @MainActor
  func testSyntheticSSNEraseUsesNativeActionSheet() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("The synthetic provider exists only in the simulator host")
    #endif
    let app = Self.hostApp()
    app.launchArguments = ["--ssn-artifact-fixture", "--reference-holder=" + UUID().uuidString]
    app.launch()
    Self.openIdentity(app)
    _ = completeSyntheticSSN(app)
    let erase = app.buttons["ssn-erase"]
    Self.revealFully(erase, in: app, below: app.navigationBars["Social Security number"])
    erase.tap()
    let sheet = app.sheets.firstMatch
    XCTAssertTrue(sheet.waitForExistence(timeout: 10))
    XCTAssertTrue(sheet.buttons["Erase checks"].exists)
    sheet.buttons["Keep checks"].tap()
    XCTAssertFalse(sheet.waitForExistence(timeout: 2))
    app.navigationBars["Social Security number"].buttons.firstMatch.tap()
    XCTAssertTrue(app.navigationBars["Identity"].waitForExistence(timeout: 10))
  }

  @MainActor
  func testIdentityRequiresAcceptedDocumentBeforePhoneOrSSN() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("The isolated holder argument exists only in the simulator host")
    #endif
    let app = Self.hostApp()
    app.launchArguments = ["--reference-holder=" + UUID().uuidString]
    app.launch()
    Self.openIdentity(app)
    let restored = app.staticTexts.matching(
      NSPredicate(format: "label CONTAINS %@", "Passport chip checking is not set up in this app")).firstMatch
    XCTAssertTrue(restored.waitForExistence(timeout: 20), "Wait for restoration, not only startup locking")
    for identifier in ["open-phone", "open-ssn"] {
      let action = app.buttons[identifier]
      XCTAssertTrue(action.waitForExistence(timeout: 10))
      XCTAssertFalse(action.isEnabled, "Missing accepted document evidence must block the check")
      XCTAssertTrue(action.label.contains("Open License or state ID and choose Check record."))
    }
    XCTAssertFalse(app.textFields["ssn-native-entry"].exists)
    XCTAssertFalse(app.otherElements["phone-bottom-sheet"].exists)
    XCTAssertFalse(app.otherElements["ssn-bottom-sheet"].exists)
    XCTAssertEqual(app.alerts.count, 0)
  }

  @MainActor
  func testUnavailablePhoneUsesBottomSheetAndReturnsToIdentity() {
    let app = Self.hostApp()
    app.launch()
    Self.openIdentity(app)
    let open = app.buttons["open-phone"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { Self.scrollContent(app) }
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
    Self.openIdentity(app)
    let open = app.buttons["open-phone"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { Self.scrollContent(app) }
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
    Self.openIdentity(app)
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { Self.scrollContent(app) }
    XCTAssertTrue(open.isEnabled, "This provider-recovery check requires retained accepted document and phone prerequisites")
    open.tap()
    XCTAssertTrue(app.otherElements["ssn-bottom-sheet"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.alerts.count, 0)
    XCTAssertFalse(app.navigationBars["Confirm your number"].exists)
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
    Self.openIdentity(app)
    let open = completeSyntheticSSN(app)
    app.navigationBars["Social Security number"].buttons.firstMatch.tap()
    XCTAssertTrue(open.waitForExistence(timeout: 5))
    open.tap()
    XCTAssertTrue(app.staticTexts["Five-check result incomplete"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.textFields["ssn-native-entry"].exists)
  }

  /// Enters the synthetic number for the simulator fixture, which reports area 000 as never issued.
  @MainActor
  private func completeSyntheticSSN(_ app: XCUIApplication) -> XCUIElement {
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { Self.scrollContent(app) }
    XCTAssertTrue(open.isEnabled, "The native fixture must seed accepted document and completed phone evidence before SSN can open")
    open.tap()
    let begin = app.buttons["ssn-begin-entry"]
    XCTAssertTrue(begin.waitForExistence(timeout: 10), "Opening SSN only restores status")
    XCTAssertFalse(app.textFields["ssn-native-entry"].exists, "Entry requires an explicit action")
    begin.tap()
    let entry = app.textFields["ssn-native-entry"]
    XCTAssertTrue(entry.waitForExistence(timeout: 5), "The native custody sheet owns entry")
    entry.tap()
    entry.typeText("000001234")
    XCTAssertEqual(entry.value as? String, "000-00-1234", "Native formatting preserves every digit")
    let review = app.navigationBars["Social Security number"].buttons["Continue"]
    XCTAssertTrue(review.isEnabled)
    review.tap()
    let confirmation = app.navigationBars["Confirm your number"]
    XCTAssertTrue(confirmation.waitForExistence(timeout: 5), "One exact-number review stays in native custody")
    XCTAssertFalse(entry.exists, "The review replaces the editable native field")
    XCTAssertTrue(app.staticTexts["000-00-1234"].exists)
    XCTAssertEqual(app.alerts.count, 0)
    confirmation.buttons["Confirm and check"].tap()
    XCTAssertTrue(confirmation.waitForNonExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["000-00-1234"].exists, "Returning to React clears the exact number")
    XCTAssertTrue(app.staticTexts["Five-check result incomplete"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["All five checks satisfied"].exists)
    for label in ["Issuance record", "Death-file record", "Name association", "Address association", "Phone association"] {
      XCTAssertTrue(app.staticTexts[label].exists, "The saved report must retain each distinct check")
    }
    return open
  }

  /// Cancelling native entry clears its draft and returns to passive React status.
  @MainActor
  func testSyntheticSSNNativeEntryCancelClearsDraftBeforeReopen() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("The synthetic provider exists only in the simulator host")
    #endif
    let app = Self.hostApp()
    app.launchArguments = ["--ssn-artifact-fixture", "--reference-holder=" + UUID().uuidString]
    app.launch()
    Self.openIdentity(app)
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    XCTAssertTrue(open.isEnabled, "The native fixture must seed accepted document and completed phone evidence")
    for _ in 0..<3 where !open.isHittable { Self.scrollContent(app) }
    open.tap()
    let begin = app.buttons["ssn-begin-entry"]
    XCTAssertTrue(begin.waitForExistence(timeout: 10))
    begin.tap()
    let entry = app.textFields["ssn-native-entry"]
    XCTAssertTrue(entry.waitForExistence(timeout: 5))
    entry.tap()
    entry.typeText("000001234")
    app.navigationBars["Social Security number"].buttons["Cancel"].tap()
    XCTAssertTrue(entry.waitForNonExistence(timeout: 5))
    XCTAssertTrue(begin.isEnabled)
    XCTAssertFalse(app.staticTexts["Five-check result incomplete"].exists, "Cancel must not submit")
    begin.tap()
    XCTAssertTrue(entry.waitForExistence(timeout: 5))
    XCTAssertEqual(entry.value as? String, "", "A new native presentation must not resurrect cancelled digits")
    XCTAssertFalse(app.navigationBars["Social Security number"].buttons["Continue"].isEnabled)
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
    Self.openIdentity(app)
    _ = completeSyntheticSSN(app)
    app.terminate()
    app.launchArguments = ["--ssn-artifact-fixture", first]
    app.launch()
    Self.openIdentity(app)
    let open = app.buttons["open-ssn"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { Self.scrollContent(app) }
    open.tap()
    XCTAssertTrue(app.staticTexts["Five-check result incomplete"].waitForExistence(timeout: 10),
      "The same holder must reopen its saved check after relaunch")
    app.terminate()
    app.launchArguments = ["--ssn-artifact-fixture", second]
    app.launch()
    Self.openIdentity(app)
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    for _ in 0..<3 where !open.isHittable { Self.scrollContent(app) }
    open.tap()
    XCTAssertTrue(app.buttons["ssn-begin-entry"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.textFields["ssn-native-entry"].exists, "Changing holder must not open native entry automatically")
    XCTAssertFalse(app.staticTexts["Five-check result incomplete"].exists, "Another holder must not see the first holder's check")
  }

  @MainActor
  func testBackgroundingCoversPersonalDataAndForegroundRemovesTheCover() {
    let app = Self.hostApp()
    app.launch()
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
  func testDocumentCameraRecoveryReturnsToLicenseDetailWithoutAnAlert() throws {
    #if !targetEnvironment(simulator)
    throw XCTSkip("This test exercises unavailable simulator camera hardware")
    #endif
    let app = Self.hostApp()
    app.launch()
    Self.openIdentity(app)
    let open = app.buttons["open-driver-license"]
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    open.tap()
    let capture = app.buttons["start-license-capture"]
    XCTAssertTrue(capture.waitForExistence(timeout: 10))
    capture.tap()
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
    sheet.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.03))
      .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
    XCTAssertFalse(sheet.waitForNonExistence(timeout: 2), "Recovery cannot discard its owner through swipe dismissal")
    let back = app.buttons["document-back-to-identity"]
    XCTAssertTrue(back.waitForExistence(timeout: 5))
    XCTAssertTrue(back.isHittable)
    back.tap()
    XCTAssertTrue(capture.waitForExistence(timeout: 5))
    XCTAssertTrue(app.navigationBars["Your license or state ID"].exists)
  }

  /// The generated simulator host has no passport trust anchors or face models.
  @MainActor
  func testMissingTrustAnchorsAndModelsDisableTheirCards() throws {
    let app = Self.hostApp()
    app.launchArguments = ["--reference-holder=" + UUID().uuidString]
    app.launch()
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
    Self.openIdentity(app)
    let settings = app.tabBars.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
    let checks = app.buttons["open-sdk-checks"]
    XCTAssertTrue(app.scrollViews.firstMatch.waitForExistence(timeout: 30))
    for _ in 0..<30 where !checks.isHittable { Self.scrollContent(app) }
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
    Self.openIdentity(app)
    let settings = app.tabBars.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
    let checks = app.buttons["open-sdk-checks"]
    XCTAssertTrue(app.scrollViews.firstMatch.waitForExistence(timeout: 30))
    for _ in 0..<30 where !checks.isHittable { Self.scrollContent(app) }
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
