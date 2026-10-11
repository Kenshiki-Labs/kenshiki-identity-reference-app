import Foundation
import IdentityCaptureRuntime
import os
import XCTest

/// Public API execution against the installed XCFramework. No SDK testable import, source
/// dependency, licence, document, vendor analysis, service request or UI automation is involved.
@MainActor
final class ArtifactNativeTests: XCTestCase {
  private let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)

  private func configuration(fields: [Int] = [1], observation: Int = 1024,
    portraitBytes: Int = 1024, portraitPixels: Int = 1024) throws -> RegulaDocumentConfiguration {
    try .init(licenseURL: directory.appendingPathComponent("regula.license"),
      databaseURL: directory.appendingPathComponent("db.dat"),
      provenanceURL: directory.appendingPathComponent("regula-provenance.json"), fieldTypes: fields,
      maximumObservationBytes: observation, maximumPortraitEncodedBytes: portraitBytes,
      maximumPortraitDecodedPixels: portraitPixels)
  }

  private func runtime() -> CaptureRuntime { CaptureRuntime(monotonicClock: { 1 }, wallClock: { Date() }) }

  private func session(_ runtime: CaptureRuntime, provider: String) throws -> String {
    let config: [String: Any] = ["document": [
      "directoryURL": directory.absoluteString,
      "keychainService": "org.example.artifact-native." + UUID().uuidString,
      "keychainAccount": "synthetic", "requiresLocation": false,
      "check": ["providerID": provider, "recordDomain": "artifact-native-v1"],
    ]]
    return try runtime.createSession(String(decoding: JSONSerialization.data(withJSONObject: config), as: UTF8.self))
  }

  private func release(_ runtime: CaptureRuntime, _ session: String) async {
    let error: String? = await withCheckedContinuation { continuation in
      runtime.releaseSessionChecked(session) { continuation.resume(returning: $0) }
    }
    XCTAssertNil(error)
  }

  func testRegistrationAndSessionOpeningDoNotReadAbsentResourcesOrCallProvider() async throws {
    XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    let runtime = runtime(), provider = NoDispatchDocumentProvider()
    try runtime.registerRegulaDocumentCheckProvider(provider, identifier: "fixture", configuration: configuration())
    let id = try session(runtime, provider: "fixture")
    await release(runtime, id)
    XCTAssertEqual(provider.calls, [])
    XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
  }

  func testResourceURLsMustBeDistinctLocalFiles() throws {
    let local = directory.appendingPathComponent("resource")
    for url in [URL(string: "https://example.invalid/licence")!, directory] {
      XCTAssertThrowsError(try RegulaDocumentConfiguration(licenseURL: url,
        databaseURL: local, provenanceURL: directory.appendingPathComponent("provenance"), fieldTypes: [1],
        maximumObservationBytes: 1, maximumPortraitEncodedBytes: 1, maximumPortraitDecodedPixels: 1))
    }
    XCTAssertThrowsError(try RegulaDocumentConfiguration(licenseURL: local,
      databaseURL: local, provenanceURL: directory.appendingPathComponent("provenance"), fieldTypes: [1],
      maximumObservationBytes: 1, maximumPortraitEncodedBytes: 1, maximumPortraitDecodedPixels: 1))
  }

  func testFieldAllowlistAndBudgetsRefuseInvalidValues() throws {
    for fields in [[], [-1], [1, 1]] { XCTAssertThrowsError(try configuration(fields: fields)) }
    for value in [0, -1] {
      XCTAssertThrowsError(try configuration(observation: value))
      XCTAssertThrowsError(try configuration(portraitBytes: value))
      XCTAssertThrowsError(try configuration(portraitPixels: value))
    }
    XCTAssertNoThrow(try configuration(fields: [0, 1], observation: 1, portraitBytes: 1, portraitPixels: 1))
  }

  func testConfigurationRetainsItsOriginalAllowlistAndBudgets() throws {
    var fields = [1, 2]
    let config = try configuration(fields: fields, observation: 10, portraitBytes: 20, portraitPixels: 30)
    fields.append(3)
    XCTAssertEqual(config.fieldTypes, [1, 2])
    XCTAssertEqual(config.maximumObservationBytes, 10)
    XCTAssertEqual(config.maximumPortraitEncodedBytes, 20)
    XCTAssertEqual(config.maximumPortraitDecodedPixels, 30)
    XCTAssertEqual(config.licenseURL, directory.appendingPathComponent("regula.license"))
  }

  func testEmptyDuplicateAndExternalReplacementRegistrationAreRefused() throws {
    let runtime = runtime(), provider = NoDispatchDocumentProvider(), config = try configuration()
    XCTAssertThrowsError(try runtime.registerRegulaDocumentCheckProvider(provider, identifier: "", configuration: config))
    try runtime.registerRegulaDocumentCheckProvider(provider, identifier: "fixture", configuration: config)
    XCTAssertThrowsError(try runtime.registerRegulaDocumentCheckProvider(provider, identifier: "fixture", configuration: config))
    XCTAssertThrowsError(try runtime.registerDocumentCheckProvider(provider, identifier: "fixture"))
    XCTAssertEqual(provider.calls, [])
  }

  func testRegistrationAfterSessionOpeningIsRefused() async throws {
    let runtime = runtime(), provider = NoDispatchDocumentProvider()
    try runtime.registerRegulaDocumentCheckProvider(provider, identifier: "fixture", configuration: configuration())
    let id = try session(runtime, provider: "fixture")
    XCTAssertThrowsError(try runtime.registerRegulaDocumentCheckProvider(provider, identifier: "later", configuration: configuration()))
    await release(runtime, id)
    XCTAssertEqual(provider.calls, [])
  }

  func testUnknownProviderCannotOpenDocumentSession() throws {
    XCTAssertThrowsError(try session(runtime(), provider: "not-registered"))
  }

  func testConsentAndMissingRetainedFrontRefuseBeforeProviderCalls() async throws {
    let runtime = runtime(), provider = NoDispatchDocumentProvider()
    try runtime.registerRegulaDocumentCheckProvider(provider, identifier: "fixture", configuration: configuration())
    let id = try session(runtime, provider: "fixture")
    for (operation, payload, expected) in [
      ("documentCheck", "{}", "consentRequired"),
      ("documentCheck", #"{"consent":true}"#, "documentFrontRequired"),
      ("documentCheckRestore", "{}", "documentFrontRequired"),
    ] {
      let outcome: (String?, String?) = await withCheckedContinuation { continuation in
        runtime.perform(id, operation: operation, payload: payload) { continuation.resume(returning: ($0, $1)) }
      }
      XCTAssertNil(outcome.0)
      XCTAssertEqual(outcome.1, expected)
    }
    await release(runtime, id)
    XCTAssertEqual(provider.calls, [])
  }
}

private final class NoDispatchDocumentProvider: NSObject, DocumentCheckProvider {
  private let recorded = OSAllocatedUnfairLock(initialState: [String]())
  var calls: [String] { recorded.withLock { $0 } }
  private func refused(_ method: String) -> NSError {
    recorded.withLock { $0.append(method) }
    return NSError(domain: "SyntheticArtifactProvider", code: 1)
  }
  func readDocument(_ original: Data, captureID: String, sourceSHA256: String) async throws -> DocumentProviderReading {
    throw refused("read")
  }
  func documentRequest(_ observations: Data, format: String, captureID: String) throws -> DocumentProviderRequest {
    throw refused("request")
  }
  func correctedDocumentRequest(_ request: DocumentProviderRequest, reply: DocumentProviderReply,
    corrections: [String: String]) throws -> DocumentProviderRequest { throw refused("correct") }
  func sendDocumentRequest(_ request: DocumentProviderRequest) async throws -> DocumentProviderReply { throw refused("send") }
  func documentResult(_ reply: DocumentProviderReply, request: DocumentProviderRequest) throws -> Data { throw refused("result") }
}
