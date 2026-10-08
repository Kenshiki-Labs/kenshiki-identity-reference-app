import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import IdentityCapture
import IdentityCaptureRuntime

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(_ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    window = UIWindow(frame: UIScreen.main.bounds)
    // The HOST chooses and locates its resources. The shipped SDK never searches Bundle.main.
    var configuration: [String: Any] = [:]
    for (key, name, extensionName) in [
      ("trustAnchorsURL", "masterList", "pem"),
      ("embedderURL", "embedder", "mlmodelc"),
      ("detectorURL", "detector", "mlmodelc"),
    ] {
      configuration[key] = Bundle.main.url(forResource: name, withExtension: extensionName,
        subdirectory: "CaptureResources")?.absoluteString
    }
    if let support = FileManager.default.urls(for: .applicationSupportDirectory,
      in: .userDomainMask).first, let identity = Bundle.main.bundleIdentifier {
      configuration["document"] = [
        "directoryURL": support.appendingPathComponent("IdentityDocuments", isDirectory: true).absoluteString,
        "keychainService": identity + ".documents",
        "keychainAccount": "capture-evidence-v1",
        "requiresLocation": false,
      ]
      #if targetEnvironment(simulator)
      // Explicit synthetic integration fixture. Never registered on a physical device.
      if ProcessInfo.processInfo.arguments.contains("--ssn-artifact-fixture") {
        var registrationError: NSError?
        if IDCaptureRegisterSSNIssuanceProvider(
          ArtifactSSNProvider(), "artifact-fixture", &registrationError) {
          configuration["ssn"] = [
            "context": ["credentialID": "synthetic-artifact-installation"],
            "workflowID": UUID().uuidString.lowercased(),
            "providerID": "artifact-fixture",
            "directoryURL": support.appendingPathComponent("ArtifactSSN", isDirectory: true).absoluteString,
            "keychainService": identity + ".artifact-ssn",
            "keychainAccount": "artifact-ssn-v1",
          ]
        }
      }
      #endif
    }
    factory.startReactNative(withModuleName: "IdentitySDKHost", in: window,
      initialProperties: ["configuration": configuration], launchOptions: launchOptions)
    return true
  }
}
#if targetEnvironment(simulator)
@MainActor
private final class ArtifactSSNProvider: NSObject, SSNIssuanceProvider {
  func checkSSN(_ digits: String, operationID: String, credentialID: String) async
    -> SSNIssuanceProviderReply {
    // Only the invalid, synthetic test number can produce this fixture observation.
    SSNIssuanceProviderReply(operationID: operationID,
      outcome: digits == "000001234" && credentialID == "synthetic-artifact-installation"
        ? .issued : .notDispatched,
      checkedAt: Date(timeIntervalSince1970: 1_800_000_000))
  }
}
#endif
class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? { bundleURL() }
  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
