import CryptoKit
import Foundation
import IdentityDocumentCheck
import KenshikiIdentity
import XCTest

import IdentityGateway
import IdentityCaptureRuntime

/// Contract tests against the Worker's OWN fixture, not against this adapter.
///
/// `WorkerPersonaRegula494fbac.json` is a byte copy of pulse-worker `src/fixtures/persona-regula.json`
/// at 494fbac (W-12: observations v2 with Regula's authenticity outcome; unchanged on pulse-worker
/// dev at 94987e9), sha256 cbbdf80894014da6fac7a8a023612f408351c4d0b6cb5ff4b0e884ce48bc16a1. It
/// replaces the a411e9e copy, whose v1 observations the Worker now refuses. The Worker's own tests pin
/// its canonical request bytes and `payloadSHA256` to the Worker's hash function
/// (personaRegula.test.ts:22), and its store accepts a correction only as `revision + 1` whose
/// `previousRequestHash` equals the stored payload hash (personaRegulaStore.ts:50). The five reply
/// vectors are the Worker handler's responses. Expected outcomes below are read from each vector's
/// own `state` and `licence.status`; there is no DMV no-match vector, so that outcome is not
/// asserted here.
final class WorkerDocumentCheckerContractTests: XCTestCase {
  private struct Vector: Decodable {
    let name: String
    let request: AnyJSON
    let statusCode: Int
    let body: AnyJSON
  }
  private struct Fixture: Decodable {
    let canonicalJSON: String
    let payloadSHA256: String
    let clientDataHashSHA256: String
    let request: AnyJSON
    let responses: [Vector]
  }

  private var fixture: Fixture!
  private var operationID = ""
  private var captureID = UUID()
  private var observation = Data()
  private var observationSource = ""

  override func setUpWithError() throws {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "WorkerPersonaRegula494fbac", withExtension: "json"))
    fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    let request = try XCTUnwrap(fixture.request.object)
    operationID = try XCTUnwrap(request["operationId"]?.string)
    captureID = try XCTUnwrap(UUID(uuidString: try XCTUnwrap(request["captureId"]?.string)))
    observation = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(request["observationBase64"]?.string)))
    let bound = try JSONSerialization.jsonObject(with: observation) as? [String: Any]
    observationSource = try XCTUnwrap(bound?["sourceSHA256"] as? String)
  }

  // MARK: Request bytes

  func testFirstRequestIsTheWorkersCanonicalRequestByteForByte() throws {
    let request = try checker().request(for: reading(), captureID: captureID)
    XCTAssertEqual(request.operationID, operationID)
    XCTAssertEqual(request.revision, 0)
    XCTAssertEqual(String(decoding: request.encoded, as: UTF8.self), fixture.canonicalJSON)
    XCTAssertEqual(Self.hex(SHA256.hash(data: request.encoded)), fixture.payloadSHA256)
  }

  /// The Worker refuses Regula dates in any other format (personaRegulaAdapter.ts), so the reader
  /// must be configured with exactly the format the Worker's own request carries.
  func testTheObservationDateFormatIsTheOneTheWorkersRequestCarries() throws {
    let bound = try XCTUnwrap(JSONSerialization.jsonObject(with: observation) as? [String: Any])
    XCTAssertEqual(PulsePersonaRegulaPayload.observationDateFormat, bound["dateFormat"] as? String)
  }

  func testObservationsInAnotherFormatAreNotSent() throws {
    // Positive control first: a refusal test that a checker refusing everything would also pass
    // proves nothing.
    XCTAssertNoThrow(try checker().request(for: reading(), captureID: captureID))
    let foreign = DocumentObservationReading(format: "other.format.v1", encoded: observation, sourceSHA256: observationSource)
    XCTAssertThrowsError(try checker().request(for: foreign, captureID: captureID))
  }

  // MARK: Sending

  func testSendSignsTheWorkersCanonicalBytesAndPostsTheWorkersRequestShape() async throws {
    let transport = RecordingTransport(reply: try vectorBytes("complete"))
    let signer = RecordingSigner()
    let checker = checker(transport: transport, signer: signer)
    let request = try checker.request(for: reading(), captureID: captureID)
    let reply = try await checker.send(request)

    let signed = await signer.calls
    XCTAssertEqual(signed.map(\.domain), ["pulse:persona-regula:v2"])
    XCTAssertEqual(signed.map(\.canonical), [fixture.canonicalJSON])
    let expectedHash = PulseAttestedPayloadHash.clientDataHash(
      domain: "pulse:persona-regula:v2", canonicalJSON: fixture.canonicalJSON)
    XCTAssertEqual(Self.hex(expectedHash), fixture.clientDataHashSHA256,
      "precondition: the fixture's client-data hash is over these bytes")

    let sent = await transport.requests
    XCTAssertEqual(sent.count, 1)
    let posted = try XCTUnwrap(sent.first)
    XCTAssertEqual(posted.httpMethod, "POST")
    XCTAssertTrue(posted.url?.path.hasSuffix("/persona/regula") == true)
    XCTAssertEqual(posted.value(forHTTPHeaderField: "Authorization"), "Bearer installation-token")
    let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(posted.httpBody)) as? [String: Any])
    XCTAssertEqual(try AnyJSON(any: try XCTUnwrap(body["payload"])), fixture.request)
    let attest = try XCTUnwrap(body["app_attest"] as? [String: Any])
    XCTAssertEqual(attest["client_data_hash"] as? String, expectedHash.base64EncodedString())

    XCTAssertEqual(reply.statusCode, 200)
    XCTAssertEqual(reply.encoded, try vectorBytes("complete").data)
  }

  func testNothingIsSentWhenTheSignatureIsNotOverTheCanonicalRequest() async throws {
    let transport = RecordingTransport(reply: try vectorBytes("complete"))
    let checker = checker(transport: transport, signer: RecordingSigner(wrongHash: true))
    let request = try checker.request(for: reading(), captureID: captureID)
    do {
      _ = try await checker.send(request)
      XCTFail("sent under a signature for other bytes")
    } catch {}
    let sent = await transport.requests
    XCTAssertTrue(sent.isEmpty)
  }

  // MARK: Reading the Worker's replies

  func testEveryWorkerReplyVectorReadsAsTheWorkerMeansIt() throws {
    let checker = checker()
    let expected: [String: DocumentCheckResult.Outcome] = [
      "complete": .recordMatched, "needsCorrection": .needsCorrection, "pending": .pending,
      "unknownCreate": .unavailable, "failedSubmit": .unavailable,
    ]
    XCTAssertEqual(Set(fixture.responses.map(\.name)), Set(expected.keys), "the Worker's vectors changed")
    for vector in fixture.responses {
      // Each Worker vector answers its own request; the needs-correction one has no issuer field.
      let request = try requestFor(vector)
      let bytes = try vectorBytes(vector.name)
      let result = try checker.result(of: DocumentCheckReply(statusCode: bytes.status, encoded: bytes.data), for: request)
      XCTAssertEqual(result.outcome, expected[vector.name], vector.name)
      XCTAssertEqual(result.operationID, operationID, vector.name)
      let body = try XCTUnwrap(vector.body.object)
      XCTAssertEqual(result.verificationID, body["licence"]?.object?["verificationId"]?.string, vector.name)
      XCTAssertEqual(result.providerStatus, body["licence"]?.object?["status"]?.string, vector.name)
      XCTAssertEqual(result.replayed, body["replayed"]?.bool, vector.name)
      let correctable = (body["issues"]?.array ?? []).compactMap(\.object)
        .filter { $0["correctable"]?.bool == true }
        .map { DocumentCheckResult.CorrectableField(field: $0["field"]?.string ?? "", code: $0["code"]?.string ?? "") }
      XCTAssertEqual(result.correctable, correctable, vector.name)
    }
  }

  /// The receipt is the Worker's own statement: which request and observations it answered, under
  /// which adapter, what it sent upstream, and each provider check with its metadata unaltered.
  func testEveryWorkerReplyCarriesItsReceiptAndTheProviderChecksVerbatim() throws {
    let checker = checker()
    var sawMetadata = false
    for vector in fixture.responses {
      let request = try requestFor(vector)
      let bytes = try vectorBytes(vector.name)
      let result = try checker.result(of: DocumentCheckReply(statusCode: bytes.status, encoded: bytes.data), for: request)
      let body = try XCTUnwrap(vector.body.object)
      XCTAssertEqual(result.receipt?.answeredRequestSHA256, body["requestHash"]?.string, vector.name)
      XCTAssertEqual(result.receipt?.answeredRequestSHA256, Self.hex(SHA256.hash(data: request.encoded)), vector.name)
      XCTAssertEqual(result.receipt?.observationSHA256, body["observationSHA256"]?.string, vector.name)
      XCTAssertEqual(result.receipt?.serviceVersion, body["adapterVersion"]?.string, vector.name)
      XCTAssertEqual(result.submittedFields, body["plan"]?.object?["aamva"]?.object?.compactMapValues(\.string), vector.name)
      XCTAssertEqual(result.frontFields?["name-last"], "EXAMPLE", vector.name)
      XCTAssertEqual(result.frontFields?["identification-number"], "SYNTHETIC000001", vector.name)
      let checks = (body["licence"]?.object?["checks"]?.array ?? []).compactMap(\.object)
      XCTAssertEqual(result.providerChecks.map(\.name), checks.map { $0["name"]?.string ?? "" }, vector.name)
      XCTAssertEqual(result.providerChecks.map(\.status), checks.map { $0["status"]?.string ?? "" }, vector.name)
      for (check, worker) in zip(result.providerChecks, checks) {
        guard let metadata = worker["metadata"] else {
          XCTAssertNil(check.metadataJSON, vector.name)
          continue
        }
        sawMetadata = true
        let expected = try JSONSerialization.data(
          withJSONObject: metadata.foundation, options: [.sortedKeys, .withoutEscapingSlashes])
        XCTAssertEqual(check.metadataJSON, String(decoding: expected, as: UTF8.self), vector.name)
      }
    }
    XCTAssertTrue(sawMetadata, "precondition: a Worker vector carries provider check metadata")
  }

  func testAWorkerReplyToAnotherOperationIsRefused() throws {
    let other = checker(operationID: "11111111-1111-4111-9111-111111111111")
    let request = try other.request(for: reading(), captureID: captureID)
    let bytes = try vectorBytes("complete")
    XCTAssertThrowsError(try other.result(of: DocumentCheckReply(statusCode: bytes.status, encoded: bytes.data), for: request))
  }

  // MARK: Corrections

  func testACorrectionIsTheNextRevisionChainedToTheWorkersPayloadHash() throws {
    let checker = checker()
    let vector = try XCTUnwrap(fixture.responses.first { $0.name == "needsCorrection" })
    let first = try requestFor(vector)
    let asked = try vectorBytes("needsCorrection")
    let corrected = try checker.correctedRequest(
      first, after: DocumentCheckReply(statusCode: asked.status, encoded: asked.data),
      corrections: [DocumentCheckCorrection(field: "issuingJurisdiction", value: "OR")])
    XCTAssertEqual(corrected.revision, 1)
    XCTAssertEqual(corrected.operationID, operationID)
    let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: corrected.encoded) as? [String: Any])
    // The Worker's store chains a correction to the stored payload hash of the request it answered.
    XCTAssertEqual(payload["previousRequestHash"] as? String, vector.body.object?["requestHash"]?.string)
    XCTAssertEqual(payload["observationBase64"] as? String, vector.request.object?["observationBase64"]?.string)
    let corrections = try XCTUnwrap(payload["corrections"] as? [[String: Any]])
    XCTAssertEqual(corrections.count, 1)
    XCTAssertEqual(corrections.first?["field"] as? String, "issuingJurisdiction")
    XCTAssertEqual(corrections.first?["value"] as? String, "OR")
  }

  func testOnlyFieldsTheWorkerOfferedCanBeCorrectedAndOnlyWhenItAsked() throws {
    let checker = checker()
    let first = try requestFor(try XCTUnwrap(fixture.responses.first { $0.name == "needsCorrection" }))
    let asked = try vectorBytes("needsCorrection")
    XCTAssertThrowsError(try checker.correctedRequest(
      first, after: DocumentCheckReply(statusCode: asked.status, encoded: asked.data),
      corrections: [DocumentCheckCorrection(field: "nameFirst", value: "ALEX")]))
    let complete = try vectorBytes("complete")
    let answered = try requestFor(try XCTUnwrap(fixture.responses.first { $0.name == "complete" }))
    XCTAssertThrowsError(try checker.correctedRequest(
      answered, after: DocumentCheckReply(statusCode: complete.status, encoded: complete.data),
      corrections: [DocumentCheckCorrection(field: "issuingJurisdiction", value: "OR")]))
  }

  // MARK: - Fixtures

  private func checker(
    transport: RecordingTransport = RecordingTransport(reply: (200, Data("{}".utf8))),
    signer: RecordingSigner = RecordingSigner(), operationID: String? = nil
  ) -> WorkerDocumentChecker {
    let id = operationID ?? self.operationID
    return WorkerDocumentChecker(
      configuration: PulseAamvaConfiguration(baseURL: URL(string: "https://worker.example")!),
      authorize: { domain, canonical in try await signer.sign(domain: domain, canonical: canonical) },
      transport: transport, mintOperationID: { id })
  }

  private func reading() -> DocumentObservationReading {
    DocumentObservationReading(format: "regula.document-observations.v2", encoded: observation, sourceSHA256: observationSource)
  }

  /// The vector's own request, built through the adapter and required to be the Worker's bytes.
  private func requestFor(_ vector: Vector) throws -> DocumentCheckRequest {
    let object = try XCTUnwrap(vector.request.object)
    let data = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(object["observationBase64"]?.string)))
    let source = try XCTUnwrap((try JSONSerialization.jsonObject(with: data) as? [String: Any])?["sourceSHA256"] as? String)
    let capture = try XCTUnwrap(UUID(uuidString: try XCTUnwrap(object["captureId"]?.string)))
    let request = try checker(operationID: object["operationId"]?.string).request(
      for: DocumentObservationReading(format: "regula.document-observations.v2", encoded: data, sourceSHA256: source),
      captureID: capture)
    XCTAssertEqual(try AnyJSON(any: try JSONSerialization.jsonObject(with: request.encoded)), vector.request, vector.name)
    return request
  }

  private func vectorBytes(_ name: String) throws -> (status: Int, data: Data) {
    let vector = try XCTUnwrap(fixture.responses.first { $0.name == name })
    return (vector.statusCode, try JSONSerialization.data(withJSONObject: vector.body.foundation, options: [.sortedKeys]))
  }

  private static func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
    digest.map { String(format: "%02x", $0) }.joined()
  }
}

private actor RecordingTransport: PulseAamvaTransport {
  private let reply: (status: Int, data: Data)
  private(set) var requests: [URLRequest] = []
  init(reply: (Int, Data)) { self.reply = reply }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let response = try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil))
    return (reply.data, response)
  }
}

private actor RecordingSigner {
  private let wrongHash: Bool
  private(set) var calls: [(domain: String, canonical: String)] = []
  init(wrongHash: Bool = false) { self.wrongHash = wrongHash }
  func sign(domain: String, canonical: String) -> PulseSSNAuthorization {
    calls.append((domain, canonical))
    let hash = PulseAttestedPayloadHash.clientDataHash(domain: domain, canonicalJSON: wrongHash ? canonical + " " : canonical)
    return PulseSSNAuthorization(
      installationToken: "installation-token",
      assertion: PulseAppAttestAssertion(keyID: "key", clientDataHash: hash.base64EncodedString(), assertionObject: "object"))
  }
}

/// Order-insensitive JSON for comparing the Worker's fixture with what is posted.
private indirect enum AnyJSON: Decodable, Equatable {
  case object([String: AnyJSON]), array([AnyJSON]), string(String), number(Double), bool(Bool), null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null }
    else if let value = try? container.decode(Bool.self) { self = .bool(value) }
    else if let value = try? container.decode(Double.self) { self = .number(value) }
    else if let value = try? container.decode(String.self) { self = .string(value) }
    else if let value = try? container.decode([AnyJSON].self) { self = .array(value) }
    else { self = .object(try container.decode([String: AnyJSON].self)) }
  }

  init(any value: Any) throws {
    self = try JSONDecoder().decode(AnyJSON.self, from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
  }

  var object: [String: AnyJSON]? { if case .object(let value) = self { value } else { nil } }
  var array: [AnyJSON]? { if case .array(let value) = self { value } else { nil } }
  var string: String? { if case .string(let value) = self { value } else { nil } }
  var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
  var foundation: Any {
    switch self {
    case .object(let value): value.mapValues(\.foundation)
    case .array(let value): value.map(\.foundation)
    case .string(let value): value
    case .number(let value): value.rounded() == value && abs(value) < 9e15 ? Int(value) as Any : value
    case .bool(let value): value
    case .null: NSNull()
    }
  }
}


extension WorkerDocumentCheckerContractTests {
  func testFrontReadingsExcludeMergedBarcodeAndOtherPageValues() throws {
    let payload = try frontPayload(fields: [
      observed(8, values: [value("FRONT"), value("BARCODE", source: 18), value("BACK", page: 1)]),
      observed(2, values: [value("ONLY BARCODE", source: 18)]),
      observed(5, values: [value("OTHER PAGE", page: 1)]),
      observed(79, values: []),
    ])
    XCTAssertEqual(try WorkerDocumentFrontFields.read(payload), ["name-last": "FRONT"])
  }

  func testFrontProjectionPreservesComparisonFailureButOmitsAmbiguousVisualAlternatives() throws {
    let payload = try frontPayload(fields: [
      observed(8, values: [value("FRONT"), value("DIFFERENT", source: 18)], comparisonStatus: 0),
      observed(2, values: [value("ONE"), value("TWO")]),
      observed(79, values: [value("12345"), value("12345")]),
      observed(77, values: [value("CITY"), value(" CITY")]),
    ])
    XCTAssertEqual(try WorkerDocumentFrontFields.read(payload), ["name-last": "FRONT", "address-postal-code": "12345"])
  }

  func testHolderCorrectionsCannotReplaceFrontEvidenceAndGivenNamesAreNotInvented() throws {
    let payload = try frontPayload(fields: [observed(8, values: [value("ORIGINAL")]),
      observed(9, values: [value("MARY ANN")])], corrected: true)
    XCTAssertEqual(payload.corrections.first?.value, "CORRECTED")
    XCTAssertEqual(try WorkerDocumentFrontFields.read(payload), ["name-last": "ORIGINAL", "name-given": "MARY ANN"])
    let single = try frontPayload(fields: [observed(9, values: [value("ALEX")])])
    XCTAssertEqual(try WorkerDocumentFrontFields.read(single), ["name-first": "ALEX", "name-given": "ALEX"])
  }

  func testResultFrontFieldsRoundTripAndOlderSavedResultDecodesWithoutThem() throws {
    let vector = try XCTUnwrap(fixture.responses.first { $0.name == "complete" })
    let bytes = try vectorBytes(vector.name)
    let result = try checker().result(of: .init(statusCode: bytes.status, encoded: bytes.data), for: requestFor(vector))
    let encoded = try JSONEncoder().encode(result)
    XCTAssertEqual(try JSONDecoder().decode(DocumentCheckResult.self, from: encoded).frontFields, result.frontFields)
    var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    legacy.removeValue(forKey: "frontFields")
    let restored = try JSONDecoder().decode(DocumentCheckResult.self, from: JSONSerialization.data(withJSONObject: legacy))
    XCTAssertNil(restored.frontFields)
    XCTAssertEqual(restored.submittedFields, result.submittedFields)
  }

  private func frontPayload(fields: [[String: Any]], corrected: Bool = false) throws -> PulsePersonaRegulaPayload {
    var body = try XCTUnwrap(JSONSerialization.jsonObject(with: observation) as? [String: Any])
    body["fields"] = fields
    return try PulsePersonaRegulaPayload(operationID: operationID, captureID: captureID.uuidString.lowercased(),
      observationData: JSONSerialization.data(withJSONObject: body), sourceSHA256: observationSource,
      revision: corrected ? 1 : 0, previousRequestHash: corrected ? String(repeating: "a", count: 64) : nil,
      corrections: corrected ? [.init(field: .nameLast, value: "CORRECTED")] : [])
  }

  private func observed(_ type: Int, values: [[String: Any]], comparisonStatus: Int = 2) -> [String: Any] {
    ["fieldType": type, "lcid": 0, "value": "MERGED VALUE MUST NOT BECOME FRONT", "status": 2,
     "validityStatus": 2, "comparisonStatus": comparisonStatus, "values": values, "validity": [], "comparisons": []]
  }

  private func value(_ text: String, source: Int = 17, page: Int = 0) -> [String: Any] {
    ["sourceType": source, "value": text, "originalValue": text, "pageIndex": page, "probability": 100]
  }
}
