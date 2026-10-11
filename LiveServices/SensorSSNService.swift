import DeviceCheck
import Foundation
public import IdentityGateway
public import KenshikiIdentity

enum SensorSSNError: Error {
  case unavailable, contextChanged, erasureRequired
}

/// This host names its own registration and service. Credential custody, canonical hashing,
/// bounded HTTP and the SSN state machine remain public SDK capabilities.
actor SensorSSNService {
  struct Authorization: Sendable {
    let credentials: PulseContinuityCredentials
    let assertion: PulseAppAttestAssertion
  }

  let baseURL: URL
  private let gateway: PulseCredentialGateway

  init(configuration: PulseContinuityBackendConfiguration, app: PulseContinuityAppMetadata,
       credentialService: String = "com.kenshiki.sensors.identity.registration.v1") {
    baseURL = configuration.baseURL
    gateway = PulseCredentialGateway(
      configuration: configuration, app: app,
      credentialService: credentialService,
      credentialAccount: "installation")
  }

  func credentials() async throws -> PulseContinuityCredentials {
    try Task.checkCancellation()
    let value = try await gateway.ensureRegisteredCredentials(apiBaseURL: baseURL)
    try Task.checkCancellation()
    return value
  }

  /// Context restoration must not create a fresh installation or dispatch registration.
  func retainedInstallationID() async throws -> String {
    guard let identity = try await gateway.retainedInstallationID(apiBaseURL: baseURL) else {
      throw SensorSSNError.contextChanged
    }
    return identity
  }

  func authorize(domain: String, canonical: String, credentialID: String) async throws
    -> Authorization
  {
    let value = try await credentials()
    guard value.installationID == credentialID, let keyID = value.appAttestKeyID,
      !keyID.isEmpty, DCAppAttestService.shared.isSupported
    else { throw SensorSSNError.contextChanged }
    let hash = PulseAttestedPayloadHash.clientDataHash(domain: domain, canonicalJSON: canonical)
    let assertion: Data = try await withCheckedThrowingContinuation { continuation in
      DCAppAttestService.shared.generateAssertion(keyID, clientDataHash: hash) { bytes, error in
        if let bytes {
          continuation.resume(returning: bytes)
        } else {
          continuation.resume(throwing: error ?? SensorSSNError.unavailable)
        }
      }
    }
    try Task.checkCancellation()
    let current = try await credentials()
    guard current.installationID == credentialID, current.appAttestKeyID == keyID else {
      throw SensorSSNError.contextChanged
    }
    return Authorization(
      credentials: current,
      assertion: PulseAppAttestAssertion(
        keyID: keyID, clientDataHash: hash.base64EncodedString(),
        assertionObject: assertion.base64EncodedString()))
  }
}
