import Foundation
public import IdentityDocumentCheck
public import IdentityPhonePossession

/// Subject fields come from the accepted service request, never raw OCR or a JavaScript object.
/// Both native reference hosts use the same mapping into the document-bound phone contract.
enum SensorPhoneDocumentContext {
  static func resolve(result: DocumentCheckResult, credentialID: String) throws -> PhonePossessionContext {
    guard result.outcome == .recordMatched, let operation = UUID(uuidString: result.operationID),
      let fields = result.submittedFields else { throw PhonePossessionFailure.contextChanged }
    let mapping = ["name-first": "givenName", "name-last": "familyName", "birthdate": "birthdate",
      "address-street-1": "street", "address-city": "locality", "address-subdivision": "region",
      "address-postal-code": "postalCode", "country-code": "country"]
    var subject: [String: String] = [:]
    for (source, destination) in mapping {
      if let value = fields[source]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
        subject[destination] = value
      }
    }
    guard subject["givenName"] != nil, subject["familyName"] != nil else {
      throw PhonePossessionFailure.contextChanged
    }
    return try PhonePossessionContext(
      credentialID: credentialID, documentOperationID: operation, documentSubject: subject)
  }
}
