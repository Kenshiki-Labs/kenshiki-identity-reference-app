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
  private var readerProbe: Task<Void, Never>?

  func application(_ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    #if DEBUG
    // The UI tests run Debug with its embedded bundle and no Metro server. React Native's own switch
    // keeps every part of it from asking for one: each failed request is a warning whose banner
    // covers the tab bar. See ReactNativeDelegate.bundleURL.
    if ProcessInfo.processInfo.environment["IDENTITY_HOST_EMBEDDED_JAVASCRIPT"] == "1" {
      RCTBundleURLProviderAllowPackagerServerAccess(false)
    }
    #endif
    // The host owns application lifecycle; native inspectors start closed until it is active.
    IDCaptureSharedRuntime().setDocumentInspectionActive(application.applicationState == .active)
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    window = UIWindow(frame: UIScreen.main.bounds)
    var properties: [String: Any] = ["firstRunPermissions": true]
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
        "airCheck": [
          "timeoutSeconds": 30, "maximumObservationAgeSeconds": 5400,
          "maximumStationDistanceMeters": 50000,
          "weatherUserAgent": "KenshikiSensorHost/1.0 (https://github.com/Kenshiki-Labs)"
        ],
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
        #if KENSHIKI_LIVE_REFERENCE
        // Owner-authorized nonproduction composition; absent from the binary reference delivery.
        // The runtime resolves the selected checked document from encrypted native custody.
        do {
          guard let directory = Bundle.main.url(forResource: "Regula", withExtension: nil,
            subdirectory: "LocalCaptureResources") else { throw CocoaError(.fileReadNoSuchFile) }
          try IDCaptureSharedRuntime().configureReferenceServices(
            credentialService: holder.service + ".registration", regulaDirectory: directory)
          if ProcessInfo.processInfo.arguments.contains("--reference-reader-probe") {
            readerProbe = Task {
              let outcome = await CaptureRuntime.probeReferenceReader(directory)
              print("REFERENCE_READER_PROBE outcome=\(outcome)")
            }
          }
          document["check"] = ["providerID": "reference-live", "recordDomain": "reference-live-v1"]
          configuration["document"] = document
          var phone = holder.store("Phone", service: "phone", account: "phone-evidence-v1")
          phone["providerID"] = "reference-live"
          phone["checkedDocumentID"] = "selected-document"
          phone["workflowID"] = holder.workflowID("phone")
          phone["policy"] = ["pollInterval": 3.0, "rateLimitBackoff": 15.0, "resendDelay": 45.0]
          configuration["phone"] = phone
        } catch {
          // Leave the affected capabilities unconfigured; never manufacture a working provider.
          properties["configurationIssue"] = "liveServicesUnavailable"
        }
        #endif
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
          let contextID = holder.workflowID("ssn")
          if IDCaptureRegisterSSNVerificationProvider(
            ArtifactSSNProvider(contextID: contextID), "artifact-fixture", &registrationError) {
            var ssn = holder.store("ArtifactSSN", service: "artifact-ssn", account: "artifact-ssn-v1")
            ssn["contextID"] = contextID
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

  func applicationWillResignActive(_ _: UIApplication) {
    IDCaptureSharedRuntime().setDocumentInspectionActive(false)
  }

  func applicationDidBecomeActive(_ _: UIApplication) {
    IDCaptureSharedRuntime().setDocumentInspectionActive(true)
  }

  // iOS captures the app-switcher snapshot after this returns. Cover personal data first.
  func applicationDidEnterBackground(_ _: UIApplication) {
    guard let window, privacyCover == nil else { return }
    let cover = UIView(frame: window.bounds)
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    cover.backgroundColor = .systemBackground
    cover.accessibilityIdentifier = "privacy-cover"
    window.addSubview(cover)
    privacyCover = cover
  }

  func applicationWillEnterForeground(_ _: UIApplication) {
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
  func readDocument(_ _: Data, captureID _: String, sourceSHA256 _: String) async throws -> DocumentProviderReading {
    throw NSError(domain: "unexpectedArtifactRead", code: 1)
  }
  func documentRequest(_ _: Data, format _: String, captureID _: String) throws -> DocumentProviderRequest {
    throw NSError(domain: "unexpectedArtifactRequest", code: 1)
  }
  func correctedDocumentRequest(_ _: DocumentProviderRequest, reply _: DocumentProviderReply,
                                corrections _: [String: String]) throws -> DocumentProviderRequest {
    throw NSError(domain: "unexpectedArtifactCorrection", code: 1)
  }
  func sendDocumentRequest(_ _: DocumentProviderRequest) async throws -> DocumentProviderReply {
    throw NSError(domain: "unexpectedArtifactDispatch", code: 1)
  }
  func documentResult(_ _: DocumentProviderReply, request _: DocumentProviderRequest) throws -> Data {
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
  func startPhoneCheck(_ _: String) async throws -> String {
    throw NSError(domain: "IDPhoneCheckProvider", code: PhoneCheckProviderFailure.unavailable.rawValue)
  }
  func completePhoneCheck(_ _: String) async throws -> String? {
    throw NSError(domain: "IDPhoneCheckProvider", code: PhoneCheckProviderFailure.unavailable.rawValue)
  }
}

@MainActor
private final class ArtifactSSNProvider: NSObject, SSNVerificationProvider {
  private let contextID: String
  private let documentID = "00000000-0000-4000-8000-000000000002"
  private let phoneID = "00000000-0000-4000-8000-000000000003"

  init(contextID: String) { self.contextID = contextID }

  private var binding: [String: String] {
    ["installationID": "synthetic-artifact-installation", "enrollmentID": contextID.uppercased(),
     "documentOperationID": documentID, "phoneChallengeID": phoneID]
  }

  func ssnContext(_ contextID: String) throws -> String {
    guard contextID == self.contextID else {
      throw NSError(domain: "ArtifactSSNProvider", code: 1)
    }
    // Native-only synthetic context. No document or phone provenance is accepted from JavaScript.
    return try json([
      "binding": binding,
      "subject": ["givenName": "Synthetic", "familyName": "Fixture", "street": "1 Test Way",
                  "locality": "Test City", "region": "CA", "postalCode": "00000", "country": "US"],
      "phone": ["sender": "12025550123", "receiptHash": String(repeating: "a", count: 64)],
    ])
  }

  func checkSSN(_ digits: String, operationID: String, contextJSON: String) async
    -> SSNVerificationProviderReply {
    guard digits == "000001234", UUID(uuidString: operationID) != nil else {
      return .init(state: .failed, failureCode: "invalidRequest")
    }
    do {
      guard try matchesContext(contextJSON) else {
        return .init(state: .failed, failureCode: "contextChanged")
      }
      return .init(state: .completed, receiptJSON: try receipt(operationID: operationID))
    } catch {
      return .init(state: .failed, failureCode: "invalidResponse")
    }
  }

  func ssnStatus(_ operationID: String, contextJSON: String) async -> SSNVerificationProviderReply {
    // This synthetic provider retains no remote results and never repeats a check on recovery.
    do {
      guard UUID(uuidString: operationID) != nil, try matchesContext(contextJSON) else {
        return .init(state: .failed, failureCode: "contextChanged")
      }
      return .init(state: .notFound)
    } catch {
      return .init(state: .failed, failureCode: "invalidResponse")
    }
  }

  private func matchesContext(_ value: String) throws -> Bool {
    let supplied = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? NSDictionary
    let expected = try JSONSerialization.jsonObject(with: Data(ssnContext(contextID).utf8)) as? NSDictionary
    return supplied != nil && supplied == expected
  }

  private func receipt(operationID: String) throws -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let moment = Date()
    let checkedAt = formatter.string(from: moment)
    let names = ["ssn_issuance", "death_master_file", "ssn_name_association",
                 "ssn_address_association", "ssn_phone_association"]
    var checks: [String: Any] = [:]
    for name in names {
      checks[name] = [
        "submitted": false, "execution": "not_dispatched", "compared": false,
        "outcome": "unavailable", "comparison_scope": "unqualified",
        "reason_code": "supplier_unavailable", "provenance": NSNull(),
      ]
    }
    // The reserved synthetic number is not issued. Other checks remain explicitly unanswered.
    checks["ssn_issuance"] = [
      "submitted": true, "execution": "response_received", "compared": true,
      "outcome": "mismatch", "comparison_scope": "record_presence", "reason_code": "mismatched",
      "provenance": ["product_id": "synthetic.ssn_issuance", "api_version": "fixture-1",
                     "dispatched_at": checkedAt, "received_at": checkedAt],
    ]
    let report: [String: Any] = [
      "contract_version": "pulse.ssn.v1", "operation_id": operationID.lowercased(),
      "profile_version": "cra-ssn-five-check-1", "request_revision": documentID,
      "completed_at": checkedAt,
      "provider": ["provider_id": "synthetic", "product": "five-check-fixture",
                   "api_version": "fixture-1", "adapter_version": "fixture-1",
                   "qualification_revision": "unqualified"],
      "checks": checks,
      "evaluation": ["status": "incomplete", "policy_version": "cra-ssn-five-check-1",
                     "required_checks": names, "unsatisfied_checks": ["ssn_issuance"],
                     "incomplete_checks": Array(names.dropFirst())],
    ]
    return try json([
      "operationID": operationID, "binding": binding, "checkedAt": formatter.string(from: moment),
      "reportKind": "fiveChecks", "issuance": "notIssued", "reportedOutcome": "unavailable",
      "fiveChecks": report, "replayed": false,
    ])
  }

  private func json(_ value: [String: Any]) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
  }
}
#endif
class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for _: RCTBridge) -> URL? { bundleURL() }
  override func bundleURL() -> URL? {
    #if DEBUG
    // The UI tests run Debug with the bundle FORCE_BUNDLING embeds, and no Metro server. Asking for
    // one would raise React Native's packager warning, whose banner covers the tab bar. Without the
    // embedded bundle the app fails to load rather than falling back to Metro.
    if ProcessInfo.processInfo.environment["IDENTITY_HOST_EMBEDDED_JAVASCRIPT"] == "1" {
      return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    }
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
