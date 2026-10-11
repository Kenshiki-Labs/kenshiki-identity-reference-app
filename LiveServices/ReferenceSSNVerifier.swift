import Foundation
internal import IdentityGateway
internal import IdentityPhonePossession
internal import IdentitySSN

/// Composes the SDK's five-check adapter with the exact native document and text-in completion.
/// Resolve again at each suspension boundary; a replaced document, erased phone journal or
/// new installation must invalidate confirmation rather than silently change its subject.
@MainActor
final class ReferenceSSNVerifier: NativeSSNContextVerifying {
  private let reference: String
  private let phones: NativePhoneSelectionRegistry
  private let authorization: SensorSSNService

  init(reference: String, phones: NativePhoneSelectionRegistry, authorization: SensorSSNService) {
    self.reference = reference
    self.phones = phones
    self.authorization = authorization
  }

  func resolveContext() async throws -> SSNVerificationContext {
    do {
      let (document, completion) = try await phones.source(reference: reference)
      let credentialID = try await authorization.retainedInstallationID()
      let (current, retained) = try await phones.source(reference: reference)
      guard current == document, retained == completion, credentialID == document.credentialID,
        completion.binding == document.binding,
        completion.receipt.subjectComparison?.status != .contradicted,
        completion.receipt.subscriberComparison?.evaluation.status != .notSatisfied
      else { throw SSNVerificationFailure.contextChanged }
      let fields = document.documentSubject
      return try SSNVerificationContext(
        binding: SSNBinding(installationID: completion.challenge.installationID,
          enrollmentID: completion.challenge.enrollmentID,
          documentOperationID: document.documentOperationID,
          phoneChallengeID: completion.challenge.challengeID),
        subject: SSNDocumentSubject(givenName: fields["givenName"], familyName: fields["familyName"],
          birthdate: fields["birthdate"], street: fields["street"], locality: fields["locality"],
          region: fields["region"], postalCode: fields["postalCode"], country: fields["country"]),
        phone: PulseSSNPhoneReceipt.input(challengeID: completion.receipt.challengeID,
          sender: completion.receipt.sender, messageHash: completion.receipt.messageHash,
          receivedAt: completion.receipt.receivedAt, completedAt: completion.receipt.completedAt))
    } catch is CancellationError { throw CancellationError() }
    catch let failure as SSNVerificationFailure { throw failure }
    catch { throw SSNVerificationFailure.contextChanged }
  }

  func check(digits: String, operationID: UUID, context: SSNVerificationContext) async throws -> SSNVerificationStatus {
    let verifier = try await verifier(context)
    let result = try await verifier.check(digits: digits, operationID: operationID, context: context)
    try await requireCurrent(context)
    return result
  }

  func status(operationID: UUID, context: SSNVerificationContext) async throws -> SSNVerificationStatus {
    let verifier = try await verifier(context)
    let result = try await verifier.status(operationID: operationID, context: context)
    try await requireCurrent(context)
    return result
  }

  private func requireCurrent(_ context: SSNVerificationContext) async throws {
    try Task.checkCancellation()
    guard try await resolveContext() == context else { throw SSNVerificationFailure.contextChanged }
  }

  private func verifier(_ context: SSNVerificationContext) async throws -> PulseSSNVerifier {
    try await requireCurrent(context)
    let credentialID = try await authorization.retainedInstallationID()
    return await PulseSSNVerifier(baseURL: authorization.baseURL, authorize: { [self] domain, canonical in
      try await requireCurrent(context)
      let proof = try await authorization.authorize(domain: domain, canonical: canonical,
        credentialID: credentialID)
      try await requireCurrent(context)
      return .init(installationToken: proof.credentials.token, assertion: proof.assertion)
    })
  }
}
