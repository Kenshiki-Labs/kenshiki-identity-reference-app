import Foundation
internal import IdentityDocumentCheck
internal import IdentityEvidenceRegula
internal import IdentityGateway
internal import IdentityPhonePossession

/// This composition is compiled only into the owner-authorized nonproduction host framework.
/// Supplier credentials stay on the service; installation authorization and subject custody stay
/// native. Each capture session gets its own document selection and phone context resolver.
extension CaptureRuntime {
  /// An explicitly requested device startup probe. No capture, identity, or service request is
  /// involved; only fixed diagnostic codes are returned, never provider messages or licence data.
  @objc public static func probeReferenceReader(_ directory: URL) async -> String {
    do {
      let configuration = try referenceRegulaConfiguration(directory: directory)
      try await RegulaDocumentRuntime(configuration: configuration, now: { Date() }).prepare()
      return "ready"
    } catch let failure as RegulaResourceFailure {
      return switch failure {
      case .unreadable: "resourcesUnreadable"
      case .unsupportedProvenance: "unsupportedProvenance"
      case .analyzerMismatch: "analyzerMismatch"
      case .databaseMismatch: "databaseMismatch"
      }
    } catch RegulaAnalysisError.providerFailure(_, let code) {
      return "providerFailure:\(code)"
    } catch { return "readerUnavailable" }
  }

  @objc public func configureReferenceServices(credentialService: String, regulaDirectory: URL) throws {
    guard !credentialService.isEmpty, regulaDirectory.isFileURL, sessions.isEmpty else {
      throw CaptureErrorCode.invalidConfiguration
    }
    let authorization = SensorSSNService(configuration: .kenshikiProduction,
      app: .init(appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
        buildNumber: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0",
        locale: Locale.current.identifier), credentialService: credentialService)
    let configuration = try referenceRegulaConfiguration(directory: regulaDirectory)
    let selections = NativeDocumentSelectionRegistry()
    let phones = NativePhoneSelectionRegistry()
    nativeServicesFactories["reference-live"] = { document, domain, now in
      let checker = WorkerDocumentChecker(configuration: .init(baseURL: authorization.baseURL),
        authorize: { domain, canonical in
          let credentials = try await authorization.credentials()
          let proof = try await authorization.authorize(domain: domain, canonical: canonical,
            credentialID: credentials.installationID)
          return .init(installationToken: proof.credentials.token, assertion: proof.assertion)
        })
      let reader = RegulaDocumentRuntime(configuration: configuration, now: now)
      document.portraitReader = configuration.portraitReader(domain: domain)
      let checks = try DocumentCheckRuntime(domain: domain, reader: reader, checker: checker, now: now)
      selections.register(document: document, checks: checks)
      let phone = try ReferencePhoneProvider(authorization: authorization) { reference in
        // Selection comes from this session's authenticated custody, never JS subject fields.
        let result = try await selections.retainedResult(reference: reference)
        let credentialID = try await authorization.retainedInstallationID()
        let current = try await selections.retainedResult(reference: reference)
        guard result == current else { throw PhonePossessionFailure.contextChanged }
        return try ReferencePhoneProvider.context(result: current, credentialID: credentialID)
      }
      return NativeCaptureServices(document: checks, phone: phone,
        registerPhone: { phones.register($0) },
        ssn: { ReferenceSSNVerifier(reference: $0, phones: phones, authorization: authorization) })
    }
  }
}

private func referenceRegulaConfiguration(directory: URL) throws -> RegulaDocumentConfiguration {
  try RegulaDocumentConfiguration(licenseURL: directory.appendingPathComponent("regula.license"),
    databaseURL: directory.appendingPathComponent("db.dat"),
    provenanceURL: directory.appendingPathComponent("regula-provenance.json"),
    fieldTypes: PulsePersonaRegulaPayload.observationFieldTypes.sorted(),
    maximumObservationBytes: PulsePersonaRegulaPayload.maximumObservationBytes,
    maximumPortraitEncodedBytes: 32 * 1_024 * 1_024, maximumPortraitDecodedPixels: 32 * 1_024 * 1_024)
}

@MainActor
private final class ReferencePhoneProvider: NSObject, PhoneCheckProvider {
  private let selection: ReferencePhoneSelection
  private let service: SensorPhoneService

  init(authorization: SensorSSNService,
       current: @escaping @MainActor @Sendable (String) async throws -> PhonePossessionContext) throws {
    let selection = ReferencePhoneSelection(resolve: current)
    self.selection = selection
    let network = URLSessionConfiguration.ephemeral
    network.urlCache = nil
    network.httpCookieStorage = nil
    service = try SensorPhoneService(baseURL: authorization.baseURL, maximumReplyBytes: 262_144,
      messageBody: { "SSA sign-up code: \($0)" }, authorize: { domain, canonical, credentialID in
        let proof = try await authorization.authorize(domain: domain, canonical: canonical, credentialID: credentialID)
        return .init(credentialID: proof.credentials.installationID, installationToken: proof.credentials.token,
          attestationKeyID: proof.assertion.keyID, assertion: proof.assertion)
      }, validate: { expected in
        guard try await selection.context() == expected else { throw PhonePossessionFailure.contextChanged }
      }, transport: URLSessionPulseBoundedHTTPTransport(session: URLSession(configuration: network)))
  }

  func phoneContext(_ checkedDocumentID: String) async throws -> String {
    try await translated {
      let value = try await selection.bind(checkedDocumentID)
      return try phoneEncode(NativePhoneContext(credentialID: value.credentialID,
        documentOperationID: value.documentOperationID, documentSubject: value.documentSubject))
    }
  }

  func startPhoneCheck(_ request: String) async throws -> String {
    struct Request: Decodable { let enrollmentID: UUID; let requestID: UUID; let context: NativePhoneContext }
    return try await translated {
      let value = try phoneDecode(Request.self, request)
      return try await phoneEncode(service.start(enrollmentID: value.enrollmentID,
        requestID: value.requestID, context: value.context.context))
    }
  }

  func completePhoneCheck(_ request: String) async throws -> String? {
    struct Request: Decodable { let challenge: PhonePossessionChallenge; let context: NativePhoneContext }
    return try await translated {
      let value = try phoneDecode(Request.self, request)
      guard let receipt = try await service.complete(challenge: value.challenge, context: value.context.context) else { return nil }
      return try phoneEncode(receipt)
    }
  }

  private func translated<T>(_ operation: () async throws -> T) async throws -> T {
    do { return try await operation() }
    catch is CancellationError { throw CancellationError() }
    catch {
      let code: PhoneCheckProviderFailure = switch error as? PhonePossessionFailure {
      case .notConfigured: .notConfigured
      case .unauthorized: .unauthorized
      case .refused: .refused
      case .unknownChallenge: .unknownChallenge
      case .conflict: .conflict
      case .expired: .expired
      case .rateLimited: .rateLimited
      case .timedOut: .timedOut
      case .contextChanged: .contextChanged
      case .invalidResponse: .invalidResponse
      case .recoveryRequired: .recoveryRequired
      case .receiptUnavailable: .receiptUnavailable
      default: .unavailable
      }
      throw NSError(domain: "IDPhoneCheckProvider", code: code.rawValue)
    }
  }

  static func context(result: DocumentCheckResult, credentialID: String) throws -> PhonePossessionContext {
    try SensorPhoneDocumentContext.resolve(result: result, credentialID: credentialID)
  }
}

/// A phone session binds one opaque document reference for its entire lifetime.
@MainActor
private final class ReferencePhoneSelection {
  private let resolve: @MainActor @Sendable (String) async throws -> PhonePossessionContext
  private var reference: String?
  init(resolve: @escaping @MainActor @Sendable (String) async throws -> PhonePossessionContext) {
    self.resolve = resolve
  }
  func bind(_ candidate: String) async throws -> PhonePossessionContext {
    guard UUID(uuidString: candidate) != nil, reference == nil || reference == candidate else {
      throw PhonePossessionFailure.contextChanged
    }
    reference = candidate
    return try await context()
  }
  func context() async throws -> PhonePossessionContext {
    guard let reference else { throw PhonePossessionFailure.contextChanged }
    do { return try await resolve(reference) }
    catch is CancellationError { throw CancellationError() }
    catch CaptureErrorCode.documentUnavailable { throw PhonePossessionFailure.contextChanged }
    catch CaptureErrorCode.documentFrontRequired { throw PhonePossessionFailure.contextChanged }
    catch SensorSSNError.contextChanged { throw PhonePossessionFailure.contextChanged }
  }
}
