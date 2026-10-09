import CryptoKit
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
  private var privacyCover: UIView?

  func application(_ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    window = UIWindow(frame: UIScreen.main.bounds)
    var properties: [String: Any] = [:]
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
      configuration["sensors"] = [
        "directoryURL": support.appendingPathComponent("SensorEvidence", isDirectory: true).absoluteString,
        "defaultsSuiteName": identity + ".sensors",
        "applicationIdentifier": identity,
      ]
      switch ReferenceHolder.retainedLocalHolderID() {
      case .failure(.unreadableHolderID):
        // No store is configured without a readable holder scope; the hub states why.
        properties["configurationIssue"] = "holderScopeUnreadable"
      case .success(let localHolderID):
        // Every store and Keychain name is scoped to the local holder. This reference host has one
        // retained holder and no sign-in; an SSA app authorizes the holder before this point.
        let holder = ReferenceHolder(localHolderID: localHolderID, support: support, appID: identity)
        configuration["results"] = holder.store("Results", service: "results", account: "completed-results-v1")
        var document = holder.store("Documents", service: "documents", account: "capture-evidence-v1")
        document["requiresLocation"] = false
        configuration["document"] = document
        #if targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--document-check-artifact-fixture") {
          var registrationError: NSError?
          if IDCaptureRegisterDocumentCheckProvider(ArtifactDocumentProvider(), "artifact-document", &registrationError) {
            document["check"] = ["providerID": "artifact-document", "recordDomain": "artifact-document-v1"]
            configuration["document"] = document
          }
        }
        if ProcessInfo.processInfo.arguments.contains("--phone-artifact-fixture") {
          var registrationError: NSError?
          if IDCaptureRegisterPhoneCheckProvider(ArtifactPhoneProvider(), "artifact-phone", &registrationError) {
            var phone = holder.store("ArtifactPhone", service: "artifact-phone", account: "artifact-phone-v1")
            phone["providerID"] = "artifact-phone"
            phone["checkedDocumentID"] = "synthetic-checked-document"
            phone["workflowID"] = holder.workflowID("phone")
            phone["policy"] = ["pollInterval": 3.0, "rateLimitBackoff": 5.0, "resendDelay": 45.0]
            configuration["phone"] = phone
          }
        }
        // Explicit synthetic integration fixture. Never registered on a physical device.
        if ProcessInfo.processInfo.arguments.contains("--ssn-artifact-fixture") {
          var registrationError: NSError?
          if IDCaptureRegisterSSNIssuanceProvider(
            ArtifactSSNProvider(), "artifact-fixture", &registrationError) {
            var ssn = holder.store("ArtifactSSN", service: "artifact-ssn", account: "artifact-ssn-v1")
            ssn["context"] = ["credentialID": "synthetic-artifact-installation"]
            ssn["workflowID"] = holder.workflowID("ssn")
            ssn["providerID"] = "artifact-fixture"
            configuration["ssn"] = ssn
          }
        }
        #endif
      }
    }
    #if DEBUG && targetEnvironment(simulator)
    // The developer checks run destructive custody probes. Only simulator Debug builds offer them.
    properties["developerChecks"] = true
    #endif
    properties["configuration"] = configuration
    factory.startReactNative(withModuleName: "IdentitySDKHost", in: window,
      initialProperties: properties, launchOptions: launchOptions)
    return true
  }

  // iOS captures the app-switcher snapshot after this returns. Cover personal data first.
  func applicationDidEnterBackground(_ application: UIApplication) {
    guard let window, privacyCover == nil else { return }
    let cover = UIView(frame: window.bounds)
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    cover.backgroundColor = .systemBackground
    cover.accessibilityIdentifier = "privacy-cover"
    window.addSubview(cover)
    privacyCover = cover
  }

  func applicationWillEnterForeground(_ application: UIApplication) {
    privacyCover?.removeFromSuperview()
    privacyCover = nil
  }
}

/// The local holder this reference host serves, and the store names derived from it. Each holder
/// gets separate directories and Keychain services, and stable SSN and phone workflow IDs.
struct ReferenceHolder {
  enum Failure: Error { case unreadableHolderID }
  private static let defaultsKey = "reference-host.local-holder-id"
  let scope: String
  let directory: URL
  let service: String

  init(localHolderID: UUID, support: URL, appID: String) {
    scope = localHolderID.uuidString.lowercased()
    directory = support.appendingPathComponent("IdentityHolders", isDirectory: true)
      .appendingPathComponent(scope, isDirectory: true)
    service = appID + ".identity." + scope
  }

  /// Created once and retained. The simulator test host may name the holder explicitly.
  static func retainedLocalHolderID(defaults: UserDefaults = .standard) -> Result<UUID, Failure> {
    #if targetEnvironment(simulator)
    let prefix = "--reference-holder="
    if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(prefix) }) {
      guard let id = UUID(uuidString: String(argument.dropFirst(prefix.count))) else { return .failure(.unreadableHolderID) }
      return .success(id)
    }
    #endif
    if let stored = defaults.string(forKey: defaultsKey) {
      guard let id = UUID(uuidString: stored) else { return .failure(.unreadableHolderID) }
      return .success(id)
    }
    let id = UUID()
    defaults.set(id.uuidString, forKey: defaultsKey)
    return .success(id)
  }

  func store(_ folder: String, service suffix: String, account: String) -> [String: Any] {
    ["directoryURL": directory.appendingPathComponent(folder, isDirectory: true).absoluteString,
     "keychainService": service + "." + suffix, "keychainAccount": account]
  }

  /// The same holder always reopens the same workflow; different holders never share one.
  func workflowID(_ purpose: String) -> String {
    var bytes = Array(SHA256.hash(data: Data("reference-workflow-v1|\(scope)|\(purpose)".utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0F) | 0x50
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    return (NSUUID(uuidBytes: bytes) as UUID).uuidString.lowercased()
  }
}

#if targetEnvironment(simulator)
private final class ArtifactDocumentProvider: NSObject, DocumentCheckProvider {
  // The artifact check must fail at missing retained capture before any provider method runs.
  func readDocument(_ original: Data, captureID: String, sourceSHA256: String) async throws -> DocumentProviderReading {
    throw NSError(domain: "unexpectedArtifactRead", code: 1)
  }
  func documentRequest(_ observations: Data, format: String, captureID: String) throws -> DocumentProviderRequest {
    throw NSError(domain: "unexpectedArtifactRequest", code: 1)
  }
  func correctedDocumentRequest(_ request: DocumentProviderRequest, reply: DocumentProviderReply,
                                corrections: [String: String]) throws -> DocumentProviderRequest {
    throw NSError(domain: "unexpectedArtifactCorrection", code: 1)
  }
  func sendDocumentRequest(_ request: DocumentProviderRequest) async throws -> DocumentProviderReply {
    throw NSError(domain: "unexpectedArtifactDispatch", code: 1)
  }
  func documentResult(_ reply: DocumentProviderReply, request: DocumentProviderRequest) throws -> Data {
    throw NSError(domain: "unexpectedArtifactResult", code: 1)
  }
}
@MainActor
private final class ArtifactPhoneProvider: NSObject, PhoneCheckProvider {
  func phoneContext(_ checkedDocumentID: String) async throws -> String {
    guard checkedDocumentID == "synthetic-checked-document" else {
      throw NSError(domain: "IDPhoneCheckProvider", code: PhoneCheckProviderFailure.contextChanged.rawValue)
    }
    return #"{"credentialID":"synthetic","documentOperationID":"00000000-0000-4000-8000-000000000001","documentSubject":{"givenName":"Synthetic"}}"#
  }
  func startPhoneCheck(_ request: String) async throws -> String {
    throw NSError(domain: "IDPhoneCheckProvider", code: PhoneCheckProviderFailure.unavailable.rawValue)
  }
  func completePhoneCheck(_ request: String) async throws -> String? {
    throw NSError(domain: "IDPhoneCheckProvider", code: PhoneCheckProviderFailure.unavailable.rawValue)
  }
}

@MainActor
private final class ArtifactSSNProvider: NSObject, SSNIssuanceProvider {
  func checkSSN(_ digits: String, operationID: String, credentialID: String) async
    -> SSNIssuanceProviderReply {
    // Only the synthetic test number is answered. Area 000 is never issued, so the fixture
    // reports it as not issued; every other number is refused before dispatch.
    SSNIssuanceProviderReply(operationID: operationID,
      outcome: digits == "000001234" && credentialID == "synthetic-artifact-installation"
        ? .notIssued : .notDispatched,
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
