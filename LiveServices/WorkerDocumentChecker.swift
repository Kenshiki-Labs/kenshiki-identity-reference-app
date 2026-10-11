import Foundation
public import IdentityDocumentCheck
public import IdentityEvidenceRegula
public import IdentityGateway
public import KenshikiIdentity

/// Signs the exact canonical request under a domain with the host's registered installation.
public typealias WorkerDocumentAuthorizer =
  @Sendable (_ domain: String, _ canonicalJSON: String) async throws -> PulseSSNAuthorization

public enum WorkerDocumentCheckerError: Error, Equatable, Sendable {
  case unsupportedObservations, invalidRequest, unauthorized
  case correctionNotRequested, correctionNotOffered
}

/// The Worker's /persona/regula route as an IdentityDocumentCheck service. The request is the existing gateway payload's canonical bytes;
/// the reply is validated by the existing gateway reply type against exactly that request. The
/// caller (the session) owns custody, so egress is caller-managed.
public struct WorkerDocumentChecker: DocumentChecking {
  /// The only observation format the Worker route accepts, and the one the SDK reader exports:
  /// v2 carries Regula's authenticity outcome (S-01, W-12). Read from the reader, not restated.
  public static let observationFormat = RegulaDocumentObservations.version

  private let client: PulsePersonaRegulaClient
  private let authorize: WorkerDocumentAuthorizer
  private let mintOperationID: @Sendable () -> String

  public init(
    configuration: PulseAamvaConfiguration, authorize: @escaping WorkerDocumentAuthorizer,
    transport: any PulseAamvaTransport = URLSessionPulsePersonaRegulaTransport(),
    mintOperationID: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() }
  ) {
    client = PulsePersonaRegulaClient(
      configuration: configuration, transport: transport, egressOwnership: .callerManagedCustody)
    self.authorize = authorize
    self.mintOperationID = mintOperationID
  }

  public func request(for reading: DocumentObservationReading, captureID: UUID) throws -> DocumentCheckRequest {
    guard reading.format == Self.observationFormat else { throw WorkerDocumentCheckerError.unsupportedObservations }
    return try Self.encode(
      PulsePersonaRegulaPayload(
        operationID: mintOperationID(), captureID: captureID.uuidString.lowercased(),
        observationData: reading.encoded, sourceSHA256: reading.sourceSHA256))
  }

  /// The correction rule: only after a needs-correction reply whose every issue is
  /// correctable, only fields that reply offered, as the next revision chained to this request.
  public func correctedRequest(
    _ previous: DocumentCheckRequest, after reply: DocumentCheckReply, corrections: [DocumentCheckCorrection]
  ) throws -> DocumentCheckRequest {
    let prior = try Self.payload(previous)
    let answer = try PulsePersonaRegulaReply(data: reply.encoded, statusCode: reply.statusCode, payload: prior)
    guard answer.response.state == .needsCorrection, !answer.response.issues.isEmpty,
      answer.response.issues.allSatisfy(\.correctable)
    else { throw WorkerDocumentCheckerError.correctionNotRequested }
    let offered = Set(answer.response.issues.compactMap { PulseRegulaCorrectionField(rawValue: $0.field) })
    var merged = Dictionary(uniqueKeysWithValues: prior.corrections.map { ($0.field, $0) })
    for correction in corrections {
      guard let field = PulseRegulaCorrectionField(rawValue: correction.field), offered.contains(field) else {
        throw WorkerDocumentCheckerError.correctionNotOffered
      }
      merged[field] = try PulseRegulaCorrection(field: field, value: correction.value)
    }
    guard !corrections.isEmpty else { throw WorkerDocumentCheckerError.correctionNotOffered }
    return try Self.encode(
      PulsePersonaRegulaPayload(
        operationID: prior.operationID, captureID: prior.captureID, observationData: prior.observationData,
        sourceSHA256: prior.sourceSHA256, revision: prior.revision + 1,
        previousRequestHash: try prior.requestHash(),
        corrections: PulseRegulaCorrectionField.allCases.compactMap { merged[$0] }))
  }

  /// Signs the exact saved bytes and sends them. Nothing is sent under a signature over other bytes.
  public func send(_ request: DocumentCheckRequest) async throws -> DocumentCheckReply {
    let payload = try Self.payload(request)
    let canonical = try payload.canonicalJSONString()
    let proof = try await authorize(PulsePersonaRegulaPayload.clientDataDomain, canonical)
    let expected = PulseAttestedPayloadHash.clientDataHash(
      domain: PulsePersonaRegulaPayload.clientDataDomain, canonicalJSON: canonical
    ).base64EncodedString()
    guard !proof.installationToken.isEmpty, proof.assertion.clientDataHash == expected else {
      throw WorkerDocumentCheckerError.unauthorized
    }
    try Task.checkCancellation()
    let reply = try await client.check(
      payload: payload, appAttest: proof.assertion, bearerToken: proof.installationToken)
    return DocumentCheckReply(statusCode: reply.statusCode, encoded: reply.data)
  }

  public func result(of reply: DocumentCheckReply, for request: DocumentCheckRequest) throws -> DocumentCheckResult {
    let payload = try Self.payload(request)
    let response = try PulsePersonaRegulaReply(
      data: reply.encoded, statusCode: reply.statusCode, payload: payload).response
    let outcome: DocumentCheckResult.Outcome
    switch response.state {
    case .needsCorrection: outcome = .needsCorrection
    case .providerPending: outcome = .pending
    case .unavailable: outcome = .unavailable
    case .providerOutcome:
      // Passed and failed are the record answer; a started
      // verification is not one; an outcome with no summary is no answer at all.
      switch response.licence?.status {
      case "passed": outcome = .recordMatched
      case "failed": outcome = .recordNotMatched
      case "initiated", "submitted": outcome = .inconclusive
      case nil: outcome = .unavailable
      default: throw WorkerDocumentCheckerError.invalidRequest
      }
    }
    // The reply validated that the summary's checks are the provider resource's checks, in order;
    // the resource is where each check's metadata is retained unaltered.
    let resource = response.results.first { $0.kind == .aamva }?.provider?.checks ?? []
    let summary = response.licence?.checks ?? []
    guard summary.isEmpty || resource.map(\.name) == summary.map(\.name) else {
      throw WorkerDocumentCheckerError.invalidRequest
    }
    let checks: [DocumentCheckResult.ProviderCheck] = try zip(summary, resource).map { check, raw in
      .init(
        name: check.name, status: check.status, reasons: check.reasons,
        metadataJSON: try raw.rawJSON.objectValue?["metadata"]?.canonicalJSONString())
    }
    return DocumentCheckResult(
      outcome: outcome, operationID: response.operationID, verificationID: response.licence?.verificationID,
      providerStatus: response.licence?.status, providerChecks: checks,
      submittedFields: response.plan?.aamva,
      correctable: response.issues.filter(\.correctable).map { .init(field: $0.field, code: $0.code) },
      replayed: response.replayed,
      receipt: .init(
        answeredRequestSHA256: response.requestHash, observationSHA256: response.observationSHA256,
        serviceVersion: response.adapterVersion),
      frontFields: try WorkerDocumentFrontFields.read(payload))
  }

  private static func encode(_ payload: PulsePersonaRegulaPayload) throws -> DocumentCheckRequest {
    DocumentCheckRequest(
      operationID: payload.operationID, revision: payload.revision,
      encoded: Data(try payload.canonicalJSONString().utf8))
  }

  /// The saved bytes are the request: they must decode to a payload whose canonical form is
  /// exactly those bytes, for the operation and revision the session recorded.
  private static func payload(_ request: DocumentCheckRequest) throws -> PulsePersonaRegulaPayload {
    let payload = try JSONDecoder().decode(PulsePersonaRegulaPayload.self, from: request.encoded)
    guard payload.operationID == request.operationID, payload.revision == request.revision,
      Data(try payload.canonicalJSONString().utf8) == request.encoded
    else { throw WorkerDocumentCheckerError.invalidRequest }
    return payload
  }
}

/// Projects attributable front OCR, never the provider's merged field or a corrected submission.
/// Regula's typed observation contract retains VISUAL (17), page and alternative values;
/// the result remains evidence even when a provider validity/comparison check failed.
public enum WorkerDocumentFrontFields {
  public static func read(_ payload: PulsePersonaRegulaPayload) throws -> [String: String] {
    let observations = try JSONDecoder().decode(RegulaDocumentObservations.self, from: payload.observationData)
    _ = try observations.encodedData(maximumBytes: PulsePersonaRegulaPayload.maximumObservationBytes)
    guard observations.sourceSHA256 == payload.sourceSHA256 else { throw WorkerDocumentCheckerError.invalidRequest }
    var result: [String: String] = [:]
    for (key, types) in fieldTypes {
      if let value = uniqueValue(types, in: observations) { result[key] = value }
    }
    // A single given name has no first/middle boundary to infer. The full given-name field
    // remains visible; absent dedicated first/middle fields are not invented by splitting it.
    if result["name-first"] == nil, !observations.fields.contains(where: { $0.fieldType == 645 }),
      let given = uniqueValue([9], in: observations), !given.contains(where: \.isWhitespace) {
      result["name-first"] = given
    }
    return result
  }

  private static func uniqueValue(_ types: Set<Int>, in observations: RegulaDocumentObservations) -> String? {
    let values = observations.fields.filter { types.contains($0.fieldType) }.flatMap(\.values)
      .filter {
        $0.sourceType == 17 && $0.pageIndex == 0 && !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      }
      .map(\.value)
    // Byte equality preserves disagreements rather than silently trimming or normalizing them.
    guard Set(values.map { Data($0.utf8) }).count == 1 else { return nil }
    return values.first
  }

  private static let fieldTypes: [String: Set<Int>] = [
    "name-given": [9], "name-first": [645], "name-middle": [146], "name-last": [8], "birthdate": [5],
    "identification-number": [2], "issuing-authority": [24], "issue-date": [4], "expiration-date": [3],
    "address-street-1": [76], "address-city": [77], "address-subdivision": [65, 78],
    "address-postal-code": [79], "country-code": [1]
  ]
}
