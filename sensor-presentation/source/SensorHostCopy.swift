import Foundation
import KenshikiEvidenceCore
import KenshikiContinuity
import KenshikiSensors
import IdentityAirCheck
import LocationCapture

// swiftlint:disable file_length type_body_length line_length

/// Every word this host shows a person, from `Localizable.xcstrings`.
///
/// THE FAÇADE IS THE ONLY PLACE A SENTENCE LIVES IN SWIFT. View and model code ask this type for
/// words and never hold a literal a person reads; that is what makes "no string escaped the catalog"
/// something a grep can check. The house standard is pulse-ios's
/// `docs/string-catalog-migration.md`: one catalog per target, EXPLICIT KEYS with `defaultValue:`
/// (never source-string-as-key, which strands every translation when the English is edited), and
/// a translator comment on every entry.
///
/// THE WORDING RULES (owner, 2026-09-18). Sentence case: only the first letter is capitalised. No
/// Swift type, SDK, module or code names in any string, and no raw token the SDK reports
/// (`not_collected`, `powered_on` …) reaches the screen: each one is mapped to plain words here.
/// Section titles are the plain name only. Footers say what a person holding the phone sees and
/// can do, in one or two short sentences; a footer that only explained internals was dropped.
///
/// KEYS are `<section>.<element>[.<detail>]`, where the section is the screen section the words
/// sit in (`motion`, `location`, `permissions` …) or a shared vocabulary (`common`, `unit`,
/// `supportStatus`, `sdkValue` …). Row labels are `<section>.row.<name>`, section titles
/// `<section>.header`, footers `<section>.footer`, captions under a row `<section>.note.<name>`.
///
/// VALUES GO IN AS ARGUMENTS, never by concatenation, so a translator can move them. Every argument
/// is a String the caller has already formatted for the locale (`SensorHostFormat`); the catalog
/// entry is `%@`, or `%1$@` / `%2$@` when there are two. Counts that change a noun use a catalog
/// plural variation instead (`%lld`).
///
/// WHAT IS NOT COPY and so is not here: SDK type names used as LOOKUP KEYS (store and tracker
/// names are matched here and never shown), defaults keys, and the raw data a row reports as-is —
/// a file path, a defaults suite name, a bundle identifier, a Wi-Fi name, a platform name.
enum SensorHostCopy {

    // MARK: - Tabs and navigation

    enum Tab {
        static var sensors: String { String(localized: "tab.sensors.title", defaultValue: "Sensors", comment: "Tab bar item for the tab that shows live sensor readings.") }
        static var settings: String { String(localized: "tab.settings.title", defaultValue: "Settings", comment: "Tab bar item for this app's own settings tab: permissions, reading times, erase. Not iOS Settings.") }
        static var sensorsNavigationTitle: String { String(localized: "tab.sensors.navigationTitle", defaultValue: "Sensors", comment: "Large title at the top of the Sensors tab.") }
        static var settingsNavigationTitle: String { String(localized: "tab.settings.navigationTitle", defaultValue: "Settings", comment: "Large title at the top of this app's Settings tab. Not iOS Settings.") }
    }

    // MARK: - Shared vocabulary

    /// The one row per sensor section that opens the sensor's page. It replaced a chevron on
    /// every row: each of those led to the same page, which made the list look like a menu.
    enum SensorPage {
        static func about(_ sensor: String) -> String { String(localized: "sensorPage.about", defaultValue: "About \(sensor)", comment: "Row at the end of a sensor's section that opens its page. The placeholder is the sensor's own name, e.g. 'About Barometer'.") }
        /// Only on the sensors that compute something: the row that opens the working.
        static func algorithm(_ sensor: String) -> String { String(localized: "sensorPage.algorithm", defaultValue: "How \(sensor) is worked out", comment: "Row under 'About …' that opens the part of the page describing the computation. The placeholder is the sensor's name.") }
    }

    /// One line per sensor: what it tells you about the phone, borrowed in spirit from pulse-ios's
    /// Live tab, where every card carries its meaning rather than only its numbers.
    enum Meaning {
        static var status: String { String(localized: "meaning.status", defaultValue: "How often the app asks every sensor for a fresh reading.", comment: "One-line meaning under the Status section.") }
        static var audioRoute: String { String(localized: "meaning.audioRoute", defaultValue: "Where sound would come out, and how often that has changed. Plugging in headphones or getting into a car shows up here.", comment: "One-line meaning under the Audio route section.") }
        static var barometer: String { String(localized: "meaning.barometer", defaultValue: "Air pressure around the phone. It falls as you climb, so it can tell a floor from the one above it.", comment: "One-line meaning under the Barometer section.") }
        static var bluetooth: String { String(localized: "meaning.bluetooth", defaultValue: "Whether the Bluetooth radio is on and what kind of audio device it is connected to. No device names are read.", comment: "One-line meaning under the Bluetooth section.") }
        static var callActivity: String { String(localized: "meaning.callActivity", defaultValue: "Whether a call is in progress, and how often that has changed. No numbers, names or audio.", comment: "One-line meaning under the Calls section.") }
        static var connectivity: String { String(localized: "meaning.connectivity", defaultValue: "How this phone reaches the network right now, and whether it recognises the Wi-Fi.", comment: "One-line meaning under the Network section.") }
        static var deviceSurface: String { String(localized: "meaning.deviceSurface", defaultValue: "What this device says it is: the system it runs, its kind, and the app asking.", comment: "One-line meaning under the Device section.") }
        static var location: String { String(localized: "meaning.location", defaultValue: "Where the phone is, how precise that is, and how old the reading is. Nothing here is saved.", comment: "One-line meaning under the Location section.") }
        static var magnetometer: String { String(localized: "meaning.magnetometer", defaultValue: "The strength of the magnetic field around the phone. Steel, speakers and cars all bend it.", comment: "One-line meaning under the Magnetic field section.") }
        static var motion: String { String(localized: "meaning.motion", defaultValue: "How the phone is being moved and held, worked out from its accelerometer and gyroscope.", comment: "One-line meaning under the Motion section.") }
        static var telephony: String { String(localized: "meaning.telephony", defaultValue: "What the mobile radio reports: the network generation, whether a SIM matches, and data service changes.", comment: "One-line meaning under the Mobile network section.") }
        static var weather: String { String(localized: "meaning.weather", defaultValue: "What the air is doing around you, from the nearest weather station. Pressure here is what the barometer can be checked against.", comment: "One-line meaning under the Weather section.") }
        static var thermalAndPower: String { String(localized: "meaning.thermalAndPower", defaultValue: "How charged and how warm the phone is, which is also how hard it has been working.", comment: "One-line meaning under the Battery and heat section.") }
    }

    /// The two groups the Sensors tab is split into.
    enum SensorGroup {
        static var free: String { String(localized: "sensorGroup.free", defaultValue: "No permission needed", comment: "Title above the sensors iOS lets any app read.") }
        static var freeNote: String { String(localized: "sensorGroup.free.note", defaultValue: "iOS lets any app read these. Nobody is asked.", comment: "Line under the no-permission group title.") }
        static var permissioned: String { String(localized: "sensorGroup.permissioned", defaultValue: "Needs your permission", comment: "Title above the sensors that require the person to allow them.") }
        static var permissionedNote: String { String(localized: "sensorGroup.permissioned.note", defaultValue: "iOS asks you first, and each stays empty until you allow it. The switches are on the Settings tab.", comment: "Line under the permission group title.") }
        static var now: String { String(localized: "sensorGroup.now", defaultValue: "Now", comment: "Row label for a sensor's single glanceable value, as iOS labels a current state.") }
        static var simulatorNotice: String { String(localized: "sensorGroup.notice.simulator", defaultValue: "This is the Simulator. It has no barometer, magnetometer or radios, so most sensors read as unavailable.", comment: "Notice at the top of the Sensors tab when the app runs on a simulator.") }
        static var motionNotice: String { String(localized: "sensorGroup.notice.motion", defaultValue: "Motion & Fitness is off, so the barometer stays empty. Turn it on from the Settings tab.", comment: "Notice at the top of the Sensors tab when the permission the barometer needs is off.") }
    }

    // MARK: - Sensors tab: Weather

    enum Weather {
        static var header: String { String(localized: "weather.header", defaultValue: "Weather", comment: "Section title on the Sensors tab: the area's weather, read for the phone's position.") }
        static var footer: String { String(localized: "weather.footer", defaultValue: "The only reading here that is not from this phone: a weather station some kilometres away, found from your position. Air check compares it with the barometer.", comment: "Footer under the Weather section.") }
        static var read: String { String(localized: "weather.button.read", defaultValue: "Read weather", comment: "Button that takes a position and asks the weather service for the nearest station's reading.") }
        static var reading: String { String(localized: "weather.button.reading", defaultValue: "Reading…", comment: "The button's title while the weather is being read.") }
        static var readAt: String { String(localized: "weather.row.readAt", defaultValue: "Read at", comment: "Row label: when this weather reading was taken.") }
        static var pressure: String { String(localized: "weather.row.pressure", defaultValue: "Pressure at sea level", comment: "Row label: the area's air pressure reduced to sea level.") }
        static var noFix: String { String(localized: "weather.failure.noFix", defaultValue: "No position, so there is no area to ask about.", comment: "Shown when no position could be taken.") }
        static var noStation: String { String(localized: "weather.failure.noStation", defaultValue: "The selected station did not supply a usable reading.", comment: "Shown when stations were asked and none could answer.") }
        static var stationsTried: String { String(localized: "weather.stationsTried", defaultValue: "Stations asked", comment: "Section title above the list of stations the reader asked, nearest first.") }
        static var outcomeUsed: String { String(localized: "weather.outcome.used", defaultValue: "Used", comment: "What happened with one station: its reading was used.") }
        static var outcomeNoPressure: String { String(localized: "weather.outcome.noPressure", defaultValue: "Reports no pressure", comment: "What happened with one station: it reports no pressure at all.") }
        static var outcomeTooOld: String { String(localized: "weather.outcome.tooOld", defaultValue: "Reading too old", comment: "What happened with one station: its readings are older than allowed.") }
        static var outcomeUnreachable: String { String(localized: "weather.outcome.unreachable", defaultValue: "Didn't answer", comment: "What happened with one station: the service failed for it.") }


    }

    // MARK: - Settings tab: units

    enum Units {
        static var header: String { String(localized: "units.header", defaultValue: "Units", comment: "Section title on the Settings tab: which units readings are shown in.") }
        static var footer: String { String(localized: "units.footer", defaultValue: "Only how readings are shown. The SDK reports metres, kilopascals and Celsius whatever you pick, and the conversion happens where the number becomes words.", comment: "Footer under the Units section.") }
        static var system: String { String(localized: "units.system", defaultValue: "Follow phone", comment: "Unit choice: whatever this phone's region setting implies.") }
        static var metric: String { String(localized: "units.metric", defaultValue: "Metric", comment: "Unit choice: metres, hectopascals, Celsius.") }
        static var imperial: String { String(localized: "units.imperial", defaultValue: "Imperial", comment: "Unit choice: feet, inches of mercury, Fahrenheit.") }
        static var metricExample: String { String(localized: "units.metric.example", defaultValue: "metres · hPa · °C", comment: "What metric shows, as three short unit names.") }
        static var imperialExample: String { String(localized: "units.imperial.example", defaultValue: "feet · inHg · °F", comment: "What imperial shows, as three short unit names.") }

        static func words(_ units: SensorHostUnits) -> String {
            switch units {
            case .system: system
            case .metric: metric
            case .imperial: imperial
            }
        }
    }

    // MARK: - Air check: the working

    enum AirCheckMath {
        static var title: String { String(localized: "airCheckMath.title", defaultValue: "The working", comment: "Title of the sheet showing the formulas behind one air check, with this run's numbers.") }
        static var row: String { String(localized: "airCheckMath.row", defaultValue: "How this was worked out", comment: "Row on the Air check tab that opens the working.") }
        static var columnHeader: String { String(localized: "airCheckMath.column.header", defaultValue: "1. The air column", comment: "Section title: the first step, how fast pressure falls here.") }
        static var columnNote: String { String(localized: "airCheckMath.column.note", defaultValue: "H is the height over which pressure falls to about a third. Warmer air is less dense, so a warm column is taller and pressure falls more slowly. Half the standard lapse rate stands for the column's mean rather than its surface.", comment: "Footer explaining the air column step.") }
        static var expectedHeader: String { String(localized: "airCheckMath.expected.header", defaultValue: "2. The expected pressure", comment: "Section title: the second step, the pressure implied at your height.") }
        static var expectedNote: String { String(localized: "airCheckMath.expected.note", defaultValue: "Where the station's height is known, the reading is brought down to the station first and then to you, which keeps the station's own elevation visible instead of hidden inside one exponent.", comment: "Footer explaining the expected-pressure step.") }
        static var allowanceHeader: String { String(localized: "airCheckMath.allowance.header", defaultValue: "3. The allowance", comment: "Section title: the third step, how far apart the two may be.") }
        static var allowanceNote: String { String(localized: "airCheckMath.allowance.note", defaultValue: "Three uncertainties added in quadrature: how precisely your height is known, how little is known about the column's temperature, and the weather's own pressure uncertainty.", comment: "Footer explaining the allowance step.") }
        static var allowanceFloorNote: String { String(localized: "airCheckMath.allowance.floorNote", defaultValue: "Three uncertainties added in quadrature came out under the floor, so the floor is the allowance: a perfect fix is not asked for perfect agreement.", comment: "Footer shown when the computed budget is smaller than the floor.") }
        static var answerHeader: String { String(localized: "airCheckMath.answer.header", defaultValue: "4. The answer", comment: "Section title: the last step, the comparison itself.") }
        static var answerNote: String { String(localized: "airCheckMath.answer.note", defaultValue: "The residual is a distance, not a judgement: the same number is a match at one allowance and a mismatch at another.", comment: "Footer under the comparison step.") }
        static var constantsHeader: String { String(localized: "airCheckMath.constants.header", defaultValue: "Constants", comment: "Section title above the fixed values the formulas use.") }
        static var constantsNote: String { String(localized: "airCheckMath.constants.note", defaultValue: "Read from the SDK, not retyped here. The floor and ceiling are read out of the comparison itself, so they cannot drift from it. These are standard atmospheric approximations, not a calibration measured against a population.", comment: "Footer under the constants, saying where they come from.") }
        static var calibration: String { String(localized: "airCheckMath.calibration", defaultValue: "Calibration", comment: "Row label: which version of the constants this answer used.") }
        static var unitMetresPerKelvin: String { String(localized: "airCheckMath.unit.metresPerKelvin", defaultValue: "m/K", comment: "Unit: metres per kelvin.") }
        static var unitKelvinPerMetre: String { String(localized: "airCheckMath.unit.kelvinPerMetre", defaultValue: "K/m", comment: "Unit: kelvin per metre.") }
        static var unitKelvin: String { String(localized: "airCheckMath.unit.kelvin", defaultValue: "K", comment: "Unit: kelvin.") }
        static var unitKilopascals: String { String(localized: "airCheckMath.unit.kilopascals", defaultValue: "kPa", comment: "Unit: kilopascals, the unit the formulas are written in.") }
    }

    // MARK: - Fusion tab

    enum FusionTab {
        static var tab: String { String(localized: "fusion.tab", defaultValue: "Fusion", comment: "Tab title: readings from several sensors put together into one answer.") }
        static var navigationTitle: String { String(localized: "fusion.navigationTitle", defaultValue: "Fusion", comment: "Large title at the top of the Fusion tab.") }
        static var footer: String { String(localized: "fusion.footer", defaultValue: "Each of these says something no single sensor can, and shows the working behind it.", comment: "Footer under the list of fusions.") }
        static func open(_ fusion: String) -> String { String(localized: "fusion.open", defaultValue: "Open \(fusion)", comment: "Row that opens one fusion's own screen. The placeholder is the fusion's name.") }
        static var notRunYet: String { String(localized: "fusion.notRunYet", defaultValue: "Not run yet", comment: "Glance value before a fusion has an answer.") }
        static var readingReady: String { String(localized: "fusion.readingReady", defaultValue: "A reading is ready to judge", comment: "Glance value for continuity when a sensor pass exists but the screen has not been opened.") }

        static var proofsHeader: String { String(localized: "fusion.proofs.header", defaultValue: "Three proofs, not one", comment: "Title of the card at the top of the Fusion tab explaining what proves what.") }
        static var proofDevice: String { String(localized: "fusion.proofs.device", defaultValue: "Which phone — a key inside this phone's Secure Enclave signs every reading, and a chain makes an edited history stop lining up.", comment: "The first of three proofs.") }
        static var proofPresence: String { String(localized: "fusion.proofs.presence", defaultValue: "Where it was — a position, how long it stayed, and the phone's own air pressure agreeing with the weather. Cheap to read once, expensive to fake for months.", comment: "The second of three proofs.") }
        static var proofPerson: String { String(localized: "fusion.proofs.person", defaultValue: "Who the person is — Face ID, the passport chip, the licence, the face match. Signed by the same key, into the same chain, as everything else.", comment: "The third of three proofs.") }
        static var proofsNote: String { String(localized: "fusion.proofs.note", defaultValue: "Continuity is the middle one: it will say \"same phone\" about a stolen phone and be right, because it was never a claim about who is holding it. That claim is the third proof — and one key signs both, which is what lets the two be read as a single record.", comment: "Footer under the three proofs, saying what continuity is not.") }

        static var airCheckMeaning: String { String(localized: "fusion.airCheck.meaning", defaultValue: "The barometer against the nearest weather station, worked out for the height you are at.", comment: "One line under Air check on the Fusion tab.") }
        static var continuityMeaning: String { String(localized: "fusion.continuity.meaning", defaultValue: "This pass against the one before it: the same phone, in the same circumstances, or not.", comment: "One line under Continuity on the Fusion tab.") }
    }

    // MARK: - Fusion: continuity

    enum Continuity {
        static var header: String { String(localized: "continuity.header", defaultValue: "Continuity", comment: "Title of the continuity screen.") }
        static var answerHeader: String { String(localized: "continuity.answer.header", defaultValue: "Answer", comment: "Section title above the continuity verdict.") }
        static var answerNote: String { String(localized: "continuity.answer.note", defaultValue: "Compared with the pass before this one. A changed network or a sensor you turned off never breaks continuity; only the phone itself changing does.", comment: "Footer under the continuity verdict.") }
        static var firstPassNote: String { String(localized: "continuity.firstPass.note", defaultValue: "Nothing has been saved from an earlier pass yet, so there is nothing to compare against. The next reading will have one.", comment: "Footer on the first run, when no earlier pass exists.") }
        static var held: String { String(localized: "continuity.held", defaultValue: "Same phone as before", comment: "Verdict: continuity held.") }
        static var broke: String { String(localized: "continuity.broke", defaultValue: "Something changed", comment: "Verdict: continuity broke.") }
        static var firstPass: String { String(localized: "continuity.firstPass", defaultValue: "Nothing to compare with yet", comment: "Verdict on the very first pass.") }
        static var waiting: String { String(localized: "continuity.waiting", defaultValue: "Waiting for a reading from the Sensors tab.", comment: "Shown before the first collection pass has finished.") }
        static var breakReason: String { String(localized: "continuity.row.breakReason", defaultValue: "What changed", comment: "Row label: why continuity broke.") }
        static var evaluatedAt: String { String(localized: "continuity.row.evaluatedAt", defaultValue: "Worked out at", comment: "Row label: when this judgement was made.") }
        static var working: String { String(localized: "continuity.row.working", defaultValue: "How this was worked out", comment: "Row that opens the continuity working.") }
        // MARK: What actually anchors "the same phone"

        static var anchorHeader: String { String(localized: "continuity.anchor.header", defaultValue: "What makes it the same phone", comment: "Section title above the key, the signature and the chain.") }
        static var anchorNote: String { String(localized: "continuity.anchor.note", defaultValue: "The sensors never prove sameness. This does: a key that exists in one phone's silicon and cannot be copied out, a signature over every reading, and a chain in which each reading commits to the ones before it.", comment: "Footer under the anchor section.") }
        static var keyKind: String { String(localized: "continuity.row.keyKind", defaultValue: "Key held in", comment: "Row label: whether the signing key lives in the Secure Enclave or in software.") }
        static var keySecureEnclave: String { String(localized: "continuity.key.secureEnclave", defaultValue: "Secure Enclave", comment: "The signing key lives in dedicated silicon and cannot be read out. Apple's own name for it; keep it.") }
        static var keySoftware: String { String(localized: "continuity.key.software", defaultValue: "Software (this phone has no enclave)", comment: "The signing key is an ordinary Keychain key, e.g. on the Simulator.") }
        static var keyFingerprint: String { String(localized: "continuity.row.keyFingerprint", defaultValue: "Public key", comment: "Row label: a short form of the public half of the signing key.") }
        static var signature: String { String(localized: "continuity.row.signature", defaultValue: "Signature", comment: "Row label: whether this reading's signature checks out.") }
        static var signatureValid: String { String(localized: "continuity.signature.valid", defaultValue: "Checks out", comment: "The signature verifies against the public key in the receipt.") }
        static var signatureInvalid: String { String(localized: "continuity.signature.invalid", defaultValue: "Does not check out", comment: "The signature failed verification.") }
        static var attestation: String { String(localized: "continuity.row.attestation", defaultValue: "App Attest", comment: "Row label: Apple's statement that this is a genuine app on a genuine device.") }
        static var chainRoot: String { String(localized: "continuity.row.chainRoot", defaultValue: "Chain now", comment: "Row label: the Merkle root after this reading.") }
        static var chainPrevious: String { String(localized: "continuity.row.chainPrevious", defaultValue: "Chain before", comment: "Row label: the Merkle root before this reading.") }
        static var chainPosition: String { String(localized: "continuity.row.chainPosition", defaultValue: "Reading number", comment: "Row label: this reading's place in the chain, e.g. '12 of 40'.") }
        static var payloadHash: String { String(localized: "continuity.row.payloadHash", defaultValue: "This reading's hash", comment: "Row label: the hash of the signed reading.") }
        static var unsigned: String { String(localized: "continuity.unsigned", defaultValue: "This reading carries no receipt, so nothing anchors it.", comment: "Shown when signing is off or a receipt is missing.") }

        static var scoreHeader: String { String(localized: "continuity.score.header", defaultValue: "The estimate", comment: "Section title above the continuity score and its uncertainty.") }
        static var scoreNote: String { String(localized: "continuity.score.note", defaultValue: "An estimate with its uncertainty, not a verdict. It needs both a history worth something and a live reading worth something: either one near zero pulls it down. A break throws the history away, and it has to be earned again.", comment: "Footer under the score.") }
        static var estimate: String { String(localized: "continuity.row.estimate", defaultValue: "Continuity", comment: "Row label: the continuity estimate itself, from 0 to 100 percent.") }
        static var lowerBound: String { String(localized: "continuity.row.lowerBound", defaultValue: "At least", comment: "Row label: the conservative lower bound of the estimate.") }
        static var certainty: String { String(localized: "continuity.row.certainty", defaultValue: "How tight", comment: "Row label: how close the lower bound is to the estimate.") }
        static var passes: String { String(localized: "continuity.row.passes", defaultValue: "Readings so far", comment: "Row label: how many collection passes this install has recorded.") }
        static var sinceBreak: String { String(localized: "continuity.row.sinceBreak", defaultValue: "History restarted", comment: "Row label: when the earned history was last thrown away by a break.") }
        static var days: String { String(localized: "continuity.row.days", defaultValue: "Days so far", comment: "Row label: days since the first reading of this install.") }

        static var coverageHeader: String { String(localized: "continuity.coverage.header", defaultValue: "What this rests on", comment: "Section title above the two fractions.") }
        static var coverageNote: String { String(localized: "continuity.coverage.note", defaultValue: "Two fractions, kept apart on purpose. A sensor this phone lacks, or a permission you refused, makes a lane unavailable: it lowers how much could be said, never how much you are believed.", comment: "Footer under the two fractions.") }
        static var lanesEligible: String { String(localized: "continuity.row.lanesEligible", defaultValue: "Sensors that could read", comment: "Row label: how many sensors were able to read at all, out of all the ones continuity knows.") }
        static var lanesObserved: String { String(localized: "continuity.row.lanesObserved", defaultValue: "Sensors that did read", comment: "Row label: how many of those actually produced a reading.") }
        static var breadth: String { String(localized: "continuity.row.breadth", defaultValue: "Breadth", comment: "Row label: eligible lanes as a share of all lanes.") }
        static var coverage: String { String(localized: "continuity.row.coverage", defaultValue: "Coverage", comment: "Row label: observed lanes as a share of eligible ones.") }
        static var lanesHeader: String { String(localized: "continuity.lanes.header", defaultValue: "Every sensor continuity looks at", comment: "Section title above the per-sensor list.") }
        static var lanesNote: String { String(localized: "continuity.lanes.note", defaultValue: "What each one gave this time, and why not when it gave nothing.", comment: "Footer under the per-sensor list.") }
        static var networkHeader: String { String(localized: "continuity.network.header", defaultValue: "Network", comment: "Section title above the Wi-Fi comparison.") }
        static var networkNote: String { String(localized: "continuity.network.note", defaultValue: "The network is compared as a private code, never as its name, and a change is normal: it grades how much a change weighs, and never breaks continuity.", comment: "Footer under the network rows.") }
        static var networkStability: String { String(localized: "continuity.row.networkStability", defaultValue: "Same network", comment: "Row label: whether the Wi-Fi is the same as last pass.") }
        static var networkFamiliarity: String { String(localized: "continuity.row.networkFamiliarity", defaultValue: "Seen before", comment: "Row label: how familiar this network is.") }
        static var forgetHeader: String { String(localized: "continuity.forget.header", defaultValue: "Start again", comment: "Section title above the button that deletes the saved fingerprint.") }
        static var forget: String { String(localized: "continuity.button.forget", defaultValue: "Forget the earlier pass", comment: "Button that deletes the saved fingerprint so the next pass has nothing to compare with.") }
        static var forgetNote: String { String(localized: "continuity.forget.note", defaultValue: "The saved fingerprint is the only judgement this app keeps between launches. Erase on the Settings tab clears the SDK's own stores.", comment: "Footer under the forget button.") }

        static func words(_ reason: ContinuityBreakReason) -> String {
            switch reason {
            case .deviceChange: String(localized: "continuity.break.deviceChange", defaultValue: "A different device", comment: "Break reason: the device itself changed.")
            case .simSwap: String(localized: "continuity.break.simSwap", defaultValue: "The SIM changed", comment: "Break reason: a SIM was inserted or removed.")
            }
        }

        static func words(_ stability: NetworkStability) -> String {
            switch stability {
            case .stable: String(localized: "continuity.network.stable", defaultValue: "Yes", comment: "The Wi-Fi network is the same as last pass.")
            case .changed: String(localized: "continuity.network.changed", defaultValue: "No, a different one", comment: "The Wi-Fi network changed since last pass.")
            case .unknown: String(localized: "continuity.network.unknown", defaultValue: "Can't tell", comment: "Either pass had no Wi-Fi code, so no comparison is possible.")
            }
        }

        static func words(_ state: ContinuityEvidenceState) -> String {
            switch state {
            case .observed: String(localized: "continuity.state.observed", defaultValue: "Gave a reading", comment: "Lane state: this sensor produced a usable reading this time.")
            case .empty: String(localized: "continuity.state.empty", defaultValue: "No reading", comment: "Lane state: the sensor could have read but produced nothing.")
            case .unavailable: String(localized: "continuity.state.unavailable", defaultValue: "Not available", comment: "Lane state: the sensor or permission is not there, which is context and not evidence.")
            case .stale: String(localized: "continuity.state.stale", defaultValue: "Too old", comment: "Lane state: its reading was older than the freshness window.")
            case .contradictory: String(localized: "continuity.state.contradictory", defaultValue: "Contradicts itself", comment: "Lane state: its reading disagreed with itself.")
            }
        }

        static func words(_ lane: ContinuityEvidenceLane) -> String {
            switch lane {
            case .battery: SensorHostCopy.Power.header
            case .motion: SensorHostCopy.Motion.header
            case .magnetometer: SensorHostCopy.Magnetometer.header
            case .barometer: SensorHostCopy.Barometer.header
            case .telephony: SensorHostCopy.Telephony.header
            case .connectivity: SensorHostCopy.Connectivity.header
            case .bluetooth: SensorHostCopy.Bluetooth.header
            case .mediaOutput: SensorHostCopy.AudioRoute.header
            case .deviceSurface: SensorHostCopy.DeviceSurface.header
            case .place: SensorHostCopy.Location.header
            case .ambientLight: String(localized: "continuity.lane.ambientLight", defaultValue: "Screen light (retired)", comment: "Lane name: a reading the SDK no longer takes, kept so old evidence still decodes.")
            case .displayProjection: String(localized: "continuity.lane.displayProjection", defaultValue: "Screen sharing (retired)", comment: "Lane name: a reading the SDK no longer takes.")
            case .focus: String(localized: "continuity.lane.focus", defaultValue: "Focus (retired)", comment: "Lane name: a reading the SDK no longer takes.")
            case .interaction: String(localized: "continuity.lane.interaction", defaultValue: "Interaction", comment: "Lane name: how the phone is being used.")
            }
        }
    }

    enum ContinuityMath {
        static var title: String { String(localized: "continuityMath.title", defaultValue: "The working", comment: "Title of the sheet showing how a continuity answer was reached.") }
        static var claimHeader: String { String(localized: "continuityMath.claim.header", defaultValue: "What continuity claims", comment: "Section title: the statement the whole computation is about.") }
        static var claimGloss: String { String(localized: "continuityMath.claim.gloss", defaultValue: "A chain of readings from one phone. The break test says whether the chain snapped; the estimate says what the chain is worth.", comment: "Line under the claim, in plain words.") }
        static var claimNote: String { String(localized: "continuityMath.claim.note", defaultValue: "It is not a claim about a person. A phone taken from you carries its continuity with it, which is why this is one lane of evidence beside a document and a face, never the whole answer.", comment: "Footer under the claim.") }
        static var anchorHeader: String { String(localized: "continuityMath.anchor.header", defaultValue: "What proves it is the same phone", comment: "Section title: the three mechanisms behind sameness.") }
        static var anchorNote: String { String(localized: "continuityMath.anchor.note", defaultValue: "Three mechanisms, three questions. The key answers which phone, the chain answers whether the history was edited, and the sensors answer whether that phone was really present. Only the third is scored below; the first two are either true or the evidence is worthless.", comment: "Footer under the three mechanisms.") }
        static var anchorKeyGloss: String { String(localized: "continuityMath.anchor.key", defaultValue: "The private key is generated inside the phone and cannot be read out or copied, not even by this app. Only the public half travels. A new phone, a wipe or a reinstall means a new key, and a new key cannot claim the old one's history.", comment: "Plain-words line under the key formula.") }
        static var anchorChainGloss: String { String(localized: "continuityMath.anchor.chain", defaultValue: "Each reading is hashed and committed together with the root before it. Alter a past reading and every root after it stops matching; delete or insert one and the count and position no longer line up.", comment: "Plain-words line under the chain formula.") }
        static var anchorSensorsGloss: String { String(localized: "continuityMath.anchor.sensors", defaultValue: "A key can be exercised by anything holding the phone. The sensors are what say a phone was actually there, in real air, on a known network — cheap to read, expensive to fake for months.", comment: "Plain-words line under the sensor formula.") }
        static var inEnclave: String { String(localized: "continuityMath.inEnclave", defaultValue: "in the Secure Enclave", comment: "Where the key lives.") }
        static var inSoftware: String { String(localized: "continuityMath.inSoftware", defaultValue: "in software", comment: "Where the key lives when there is no enclave.") }
        static var verifies: String { String(localized: "continuityMath.verifies", defaultValue: "verifies", comment: "The signature checks out.") }
        static var doesNotVerify: String { String(localized: "continuityMath.doesNotVerify", defaultValue: "does not verify", comment: "The signature fails.") }

        static var fractionsHeader: String { String(localized: "continuityMath.fractions.header", defaultValue: "1. What read, and what could have", comment: "Section title: the two fractions.") }
        static var liveHeader: String { String(localized: "continuityMath.live.header", defaultValue: "2. How good this moment is", comment: "Section title: the live-evidence term.") }
        static var liveNote: String { String(localized: "continuityMath.live.note", defaultValue: "A geometric mean, so one weak part drags the result down and cannot be made up for by the others. The floor stops a single zero from wiping it out. Coherence is the only place a network change counts, and it is a nudge, not a verdict.", comment: "Footer under the live-evidence term.") }
        static var maturityHeader: String { String(localized: "continuityMath.maturity.header", defaultValue: "3. How much history is behind it", comment: "Section title: the maturity term.") }
        static var maturityNote: String { String(localized: "continuityMath.maturity.note", defaultValue: "Days count on a slow curve rather than a cliff, and readings saturate. Readings are weighted by breadth, so a hundred readings from one sensor never look like a hundred from twelve.", comment: "Footer under the maturity term.") }
        static var estimateHeader: String { String(localized: "continuityMath.estimate.header", defaultValue: "4. The estimate", comment: "Section title: the final estimate and its bound.") }
        static var estimateNote: String { String(localized: "continuityMath.estimate.note", defaultValue: "History and the live moment are combined the same soft way: both must be worth something. The lower bound is the tenth percentile of a Beta posterior with a weak sceptical prior, so few readings mean a wide gap and a low tightness.", comment: "Footer under the estimate.") }
        static var constantsHeader: String { String(localized: "continuityMath.constants.header", defaultValue: "Constants", comment: "Section title above the model's tunables.") }
        static var constantsNote: String { String(localized: "continuityMath.constants.note", defaultValue: "Read from the SDK, not retyped here. They are chosen shapes rather than measured ones: the half-maturity point says when a history counts for half, not what a person is.", comment: "Footer under the constants.") }
        static var unitDays: String { String(localized: "continuityMath.unit.days", defaultValue: "days", comment: "Unit: days.") }
        static var unitReadings: String { String(localized: "continuityMath.unit.readings", defaultValue: "readings", comment: "Unit: readings, used for the model's prior strength.") }
        static var fractionsNote: String { String(localized: "continuityMath.fractions.note", defaultValue: "Breadth discounts how much this pass can claim. Coverage measures only the lanes that were able to speak, so an unavailable lane never counts as a silence held against you.", comment: "Footer under the fractions.") }
        static var breakHeader: String { String(localized: "continuityMath.break.header", defaultValue: "2. The break rule", comment: "Section title: the rule that decides a break.") }
        static var breakNote: String { String(localized: "continuityMath.break.note", defaultValue: "Only the phone's own identity and its SIM can break continuity. The network is compared, but a change never breaks it: people move.", comment: "Footer under the break rule.") }
        static var broke: String { String(localized: "continuityMath.broke", defaultValue: "Broke", comment: "Shown before the reason when continuity broke.") }
        static var noBreak: String { String(localized: "continuityMath.noBreak", defaultValue: "No term was true, so continuity held.", comment: "Shown when nothing broke.") }
        static var statesHeader: String { String(localized: "continuityMath.states.header", defaultValue: "Sensors, counted by what they gave", comment: "Section title: how many sensors were in each state.") }
        static var statesNote: String { String(localized: "continuityMath.states.note", defaultValue: "These add up to the numerators above, so the fractions can be checked by counting.", comment: "Footer under the state counts.") }
    }

    // MARK: - Settings tab: the evidence export

    enum Export {
        static var header: String { String(localized: "export.header", defaultValue: "Check this yourself", comment: "Section title on the Settings tab: exporting signed readings so somebody else can verify them.") }
        static var footer: String { String(localized: "export.footer", defaultValue: "Hand the file to anyone with Python and OpenSSL. tools/verify-evidence.py recomputes the hashes, the chain and every signature, without this app or the SDK, and says which reading fails and why.", comment: "Footer under the export section.") }
        static var kept: String { String(localized: "export.row.kept", defaultValue: "Readings kept", comment: "Row label: how many signed readings are stored for export.") }
        static var share: String { String(localized: "export.button.share", defaultValue: "Export signed readings", comment: "Button that writes the export file and offers to share it.") }
        static var tamper: String { String(localized: "export.button.tamper", defaultValue: "Alter the newest reading", comment: "Button that edits a kept reading so the check has something to catch.") }
        static var tampered: String { String(localized: "export.tampered", defaultValue: "The newest reading was altered. Export it and run the check.", comment: "Shown after the tamper button is used.") }
        static var forget: String { String(localized: "export.button.forget", defaultValue: "Delete kept readings", comment: "Button that deletes the stored readings.") }
        static var failed: String { String(localized: "export.failed", defaultValue: "The export could not be written.", comment: "Shown when writing the file failed.") }
        /// Appended to a session id by the alter button, so a verifier sees content that no longer
        /// matches its own hash. Not shown as words anywhere.
        static let tamperMarker = "-altered-after-signing"
    }

    // MARK: - Fusion tab: the three proofs, in full

    enum ThreeProofs {
        static var title: String { String(localized: "threeProofs.title", defaultValue: "Three proofs", comment: "Title of the screen explaining what proves what.") }
        static var row: String { String(localized: "threeProofs.row", defaultValue: "What each proof carries, and how they join", comment: "Row on the Fusion tab that opens the full explanation.") }
        static var footer: String { String(localized: "threeProofs.footer", defaultValue: "Kept apart, each proof is honest about what it can carry. Signed into one chain by one key, together they say who, where, on which phone, and in what order — which is more than any of them claims alone, and exactly as much as the three of them can back.", comment: "Footer at the end of the three proofs.") }

        static var deviceHeader: String { String(localized: "threeProofs.device.header", defaultValue: "1. Which phone, and its connection to your number", comment: "Section title: the device proof.") }
        static var deviceHow: String { String(localized: "threeProofs.device.how", defaultValue: "The phone generates a private signing key inside its Secure Enclave and the private key stays there. Signed evidence is checked with the matching public key, and each record commits to the history before it, so a verifier can check both the signatures and the order.", comment: "How the device proof works.") }
        static var deviceProves: String { String(localized: "threeProofs.device.proves", defaultValue: "A persistent cryptographic identity for the device's evidence. A completed SMS code check records access to the number at that time. Available carrier and line checks provide separate context.", comment: "What the device proof proves.") }
        static var deviceNotProves: String { String(localized: "threeProofs.device.notProves", defaultValue: "The device key identifies the signer. Receiving an SMS code does not prove which SIM or handset received it, or who was holding the phone.", comment: "What the device proof does not prove.") }
        static var deviceBreaks: String { String(localized: "threeProofs.device.breaks", defaultValue: "A wipe, a reinstall, a restore to a new handset, or deleting the app all destroy the key, because it is marked to this device and never included in a backup. The next run makes a new key, and a new key cannot claim the old one's history.", comment: "What breaks the device proof.") }
        static var deviceWhere: String { String(localized: "threeProofs.device.where", defaultValue: "KenshikiIdentity/EvidenceIntegrity.swift — signed(_:), verify(_:)", comment: "Where the device proof lives in the SDK. A file path and two function names; do not translate.") }
        static var thisPhoneKey: String { String(localized: "threeProofs.thisPhone.key", defaultValue: "This phone's key", comment: "Row label: the short form of this phone's public key hash.") }
        static var thisPhoneHeld: String { String(localized: "threeProofs.thisPhone.held", defaultValue: "Held in", comment: "Row label: where this phone's key lives.") }
        static var thisPhoneChain: String { String(localized: "threeProofs.thisPhone.chain", defaultValue: "This reading's place", comment: "Row label: where this reading sits in the chain.") }

        static var presenceHeader: String { String(localized: "threeProofs.presence.header", defaultValue: "2. Where it was, how it moved, what surrounded it", comment: "Section title: the presence proof.") }
        static var presenceHow: String { String(localized: "threeProofs.presence.how", defaultValue: "Core Location supplies fixes and their accuracy; visits supply arrival, departure and duration. The surrounding radio environment — Bluetooth, Wi-Fi, cellular and connection context — recurs and ties to a place. The barometer's reading is checked against the pressure expected at that elevation, and the magnetometer's against the field NOAA's model predicts there.", comment: "How the presence proof works.") }
        static var presenceProves: String { String(localized: "threeProofs.presence.proves", defaultValue: "Repeated visits, nights and time spent somewhere build a pattern across time. A single fix and a recurring pattern carry different weight, and the evidence records when each observation happened and how accurately it placed the phone.", comment: "What the presence proof proves.") }
        static var presenceNotProves: String { String(localized: "threeProofs.presence.notProves", defaultValue: "The constellation is assessed as a combination, not as independent location measurements: its sources have different precision and different dependencies. A place is not a person until the third proof is signed alongside it.", comment: "What the presence proof does not prove.") }
        static var presenceAbsence: String { String(localized: "threeProofs.presence.absence", defaultValue: "Missing permission, absent hardware and an unreported result stay visible as limits on the evidence. A result such as \"not reported\" remains exactly that, and is never converted into a confirmed absence of change.", comment: "How absence is handled in the presence proof.") }
        static var presenceWhere: String { String(localized: "threeProofs.presence.where", defaultValue: "LocationCapture · KenshikiSensors/DevicePhysicsCollector.swift · IdentityAirCheck", comment: "Where the presence proof lives in the SDK. File paths; do not translate.") }

        static var personHeader: String { String(localized: "threeProofs.person.header", defaultValue: "3. Who the person is, and recurring authentication", comment: "Section title: the person proof.") }
        static var personHow: String { String(localized: "threeProofs.person.how", defaultValue: "The passport's printed page and its NFC chip, with the issuer signature, the certificate's path to a government trust root and the hashes of the signed data groups reported separately from mere chip access. A driving licence checked field by field against the issuing jurisdiction's records. A live face compared with the document portrait, on the phone, with presentation-attack detection.", comment: "How the person proof works.") }
        static var personProves: String { String(localized: "threeProofs.person.proves", defaultValue: "A named human being, holding a genuine document, present at that moment. Face ID at every app open adds recurring authentication afterwards: the document-to-face check establishes who the person is, and Face ID re-authenticates them against the phone's enrolled biometric each time.", comment: "What the person proof proves.") }
        static var personNotProves: String { String(localized: "threeProofs.person.notProves", defaultValue: "A matched field, an unmatched field and a field the issuer did not report keep their different meanings. Agreement elsewhere never turns an unmatched document into a matched one.", comment: "What the person proof does not prove.") }
        static var personWhere: String { String(localized: "threeProofs.person.where", defaultValue: "KenshikiCapture · CaptureSelfie · IdentityEvidenceApple (not shown in this app yet)", comment: "Where the person proof lives in the SDK. Module names; do not translate.") }

        static var togetherHeader: String { String(localized: "threeProofs.together.header", defaultValue: "What the three make together", comment: "Section title: how the proofs compose.") }
        static var togetherHow: String { String(localized: "threeProofs.together.how", defaultValue: "One key signs it, and each record commits to the history before it, so the order is fixed and nothing can be inserted or re-dated afterwards.", comment: "How the proofs are bound together.") }
        static var togetherProves: String { String(localized: "threeProofs.together.proves", defaultValue: "The document and live face establish a named identity relationship. Carrier verification contributes phone verification. The device key identifies what signed the evidence. Face ID supplies recurring authentication. Visits, motion, overnight observations, the radio constellation, pressure and magnetism contribute continuing context.", comment: "What the composition proves.") }
        static var togetherClaim: String { String(localized: "threeProofs.together.claim", defaultValue: "A continuing, inspectable relationship between a verified person, their authenticated use of a phone, and the evidence that phone accumulates over time. The claim rests on the composition and on the history, not on any one proof.", comment: "The claim the three proofs together support.") }
        static var togetherLimit: String { String(localized: "threeProofs.together.limit", defaultValue: "Continuous assurance means re-evaluating that relationship as new evidence arrives, and keeping the distinction between a directly verified event and continuity inferred from the record around it. The percentage is that component's estimate — not a probability that a named person is present, and not a NIST assurance level.", comment: "The one limit of the composition.") }
        static var togetherToday: String { String(localized: "threeProofs.together.today", defaultValue: "In this app, only the first two are wired: the sensors are signed, the position is read for the Air check but not written into the evidence, and visits and document capture live in the Pulse app waiting to be brought across. The mechanism is the same for all of them, which is the point of showing it on the cheap ones first.", comment: "What this app actually signs today, as opposed to what the SDK supports.") }

        static var checkHeader: String { String(localized: "threeProofs.check.header", defaultValue: "What can be verified", comment: "Section title: how to check the claims independently.") }
        static var checkHow: String { String(localized: "threeProofs.check.how", defaultValue: "A signature establishes that the signed content was produced with the matching private key and has not changed since. A linked chain establishes the relationships and the ordering recorded inside the history you were given.", comment: "How to check the claims.") }
        static var checkCompleteness: String { String(localized: "threeProofs.check.completeness", defaultValue: "Whether the history you were handed is the whole history used to need a commitment published somewhere else. It no longer does: every reading carries the counter Apple keeps for this app's key, which the app cannot set or skip, so readings removed from a run leave a gap in the count that the run itself shows.", comment: "How completeness is established.") }
        static var checkTime: String { String(localized: "threeProofs.check.time", defaultValue: "Times here are the phone's own. Nothing on this screen establishes trusted wall-clock time, which needs a time source outside the device — so treat the order as proven and the clock as reported.", comment: "Which timestamps are device-reported.") }
        static var checkAttestation: String { String(localized: "threeProofs.check.attestation", defaultValue: "Apple's own check of the app reports its state, and a challenge still outstanding is not a completed attestation. The two are kept apart on the continuity screen for that reason.", comment: "Attestation state versus completed attestation.") }
        static var checkCoverage: String { String(localized: "threeProofs.check.coverage", defaultValue: "This app signs its sensor readings. Document capture and visits live in the Pulse app, and the position used for the Air check is not yet written into the evidence here. Shared mechanisms make the rest possible; what is actually signed is what can be claimed.", comment: "What this app covers versus what Pulse covers.") }

        static var checkWhere: String { String(localized: "threeProofs.check.where", defaultValue: "tools/verify-evidence.py", comment: "The verifier's path. Do not translate.") }
        static var checkTamper: String { String(localized: "threeProofs.check.tamper", defaultValue: "There is a button beside the export that alters a reading after it was signed. Use it, export again, and watch the check refuse that reading and name it. A check that never fails proves nothing.", comment: "How to prove the check is not decoration.") }
    }

    /// The words that do real work here, defined where they are used rather than assumed.
    enum Glossary {
        static var title: String { String(localized: "glossary.title", defaultValue: "Words used here", comment: "Title of the glossary screen.") }
        static var row: String { String(localized: "glossary.row", defaultValue: "Words used here", comment: "Row that opens the glossary.") }

        static var secureEnclaveTerm: String { String(localized: "glossary.secureEnclave.term", defaultValue: "Secure Enclave", comment: "Glossary term. Apple's own name; keep it.") }
        static var secureEnclaveBody: String { String(localized: "glossary.secureEnclave.body", defaultValue: "A separate processor inside the iPhone with its own memory, built to hold keys. A key made there can be used — asked to sign something — but never read out, not by this app, not by iOS, not by anyone with the phone unlocked in their hand. That is what makes a signature evidence of a particular phone rather than of some software that knows a secret.", comment: "Glossary definition of the Secure Enclave.") }

        static var merkleTerm: String { String(localized: "glossary.merkle.term", defaultValue: "Merkle chain", comment: "Glossary term.") }
        static var merkleBody: String { String(localized: "glossary.merkle.body", defaultValue: "A way of committing to a list so that it cannot be edited quietly. Each reading is hashed; pairs of hashes are hashed together, then pairs of those, up to one value called the root. Every new reading is added and a new root computed, and each reading records the root before it. Change, delete or insert anything and every root after it stops matching — so tampering is not merely detectable, it is visible at the exact position.", comment: "Glossary definition of a Merkle chain.") }

        static var hashTerm: String { String(localized: "glossary.hash.term", defaultValue: "Hash", comment: "Glossary term.") }
        static var hashBody: String { String(localized: "glossary.hash.body", defaultValue: "A short fingerprint of some data, produced by a fixed recipe. The same data always gives the same fingerprint, any change gives a completely different one, and you cannot work backwards from the fingerprint to the data. Here it is SHA-256, and it is how a reading is summarised before being signed or chained.", comment: "Glossary definition of a hash.") }

        static var signatureTerm: String { String(localized: "glossary.signature.term", defaultValue: "Signature", comment: "Glossary term.") }
        static var signatureBody: String { String(localized: "glossary.signature.body", defaultValue: "Proof that a particular key approved a particular piece of data. The private half signs; the public half, which anyone may hold, checks. Unlike a password, checking it reveals nothing that would let you forge the next one. Here it is ECDSA on the P-256 curve, over a SHA-256 hash.", comment: "Glossary definition of a signature.") }

        static var appAttestTerm: String { String(localized: "glossary.appAttest.term", defaultValue: "App Attest", comment: "Glossary term. Apple's own name; keep it.") }
        static var appAttestBody: String { String(localized: "glossary.appAttest.body", defaultValue: "Apple's own statement that this is an unmodified build of this app, running on a genuine Apple device. It needs a one-time number from a server to answer fully; without one it reports that a challenge is required, which is a state and not a failure.", comment: "Glossary definition of App Attest.") }

        static var canonicalTerm: String { String(localized: "glossary.canonical.term", defaultValue: "Canonical form", comment: "Glossary term.") }
        static var canonicalBody: String { String(localized: "glossary.canonical.body", defaultValue: "One exact way of writing the data down, so that signing and checking agree byte for byte: keys in alphabetical order, no stray spaces, times written one fixed way. Without it, two programs could describe the same reading differently and a perfectly good signature would appear broken.", comment: "Glossary definition of canonical form.") }

        static var enclaveKeyTerm: String { String(localized: "glossary.chainRoot.term", defaultValue: "Root", comment: "Glossary term: the Merkle root.") }
        static var enclaveKeyBody: String { String(localized: "glossary.chainRoot.body", defaultValue: "The single value at the top of the chain, standing for every reading beneath it. Two people holding the same root agree about the entire history without comparing it reading by reading.", comment: "Glossary definition of the Merkle root.") }
    }

    // MARK: - Continuity over time

    enum OverTime {
        static var title: String { String(localized: "overTime.title", defaultValue: "Over time", comment: "Title of the screen showing how continuity behaves as days and readings accumulate.") }
        static var row: String { String(localized: "overTime.row", defaultValue: "How this behaves over time", comment: "Row on the continuity screen that opens the over-time explanation.") }

        static var readingHeader: String { String(localized: "overTime.reading.header", defaultValue: "What a reading is", comment: "Section title: the unit everything else counts.") }
        static var readingIs: String { String(localized: "overTime.reading.is", defaultValue: "One reading is one pass over the sensors, signed and added to the chain. It takes about a second and a half, and it is the unit every count on these screens is made of.", comment: "What a reading is.") }
        static var readingWhen: String { String(localized: "overTime.reading.when", defaultValue: "This app takes one whenever the Sensors tab is open, a few seconds apart, so a chain builds quickly here. A real app would take one when it is used, or once in the background, not continuously.", comment: "When readings happen in this app.") }
        static var readingNoSchedule: String { String(localized: "overTime.reading.noSchedule", defaultValue: "The SDK has no schedule of its own and never wakes the phone. How often to read is the app's decision, and the numbers below simply reflect whatever it decided.", comment: "That the SDK sets no cadence.") }

        static var timelineHeader: String { String(localized: "overTime.timeline.header", defaultValue: "What it is worth, as time passes", comment: "Section title: the timeline of estimates.") }
        static var timelineNote: String { String(localized: "overTime.timeline.note", defaultValue: "Computed with this phone's current reading quality held fixed, so only time and the count move. Days count on a slow curve with no cliff — half weight at 45 days — and readings saturate, so the first few matter far more than the hundredth.", comment: "Footer under the timeline.") }
        static func milestone(days: String, readings: String) -> String { String(localized: "overTime.milestone", defaultValue: "Day \(days), \(readings) readings", comment: "A row in the timeline. First placeholder is a number of days, second a number of readings.") }
        static func rowDetail(maturity: String, atLeast: String, tight: String) -> String { String(localized: "overTime.rowDetail", defaultValue: "history \(maturity) · at least \(atLeast) · tightness \(tight)", comment: "The terms under one timeline row: the history term, the lower bound, and how tight the estimate is.") }

        static var gapHeader: String { String(localized: "overTime.gap.header", defaultValue: "What a gap costs", comment: "Section title: what stopping does.") }
        static var gapHow: String { String(localized: "overTime.gap.how", defaultValue: "A reading stays fully fresh for a day, then decays to nothing over the next two. Earned history stays where it is: it is the live half that fades, so an unused phone keeps its past and stops being able to say anything about its present.", comment: "How a gap affects the numbers.") }
        static func gapLabel(hours: String) -> String { String(localized: "overTime.gap.label", defaultValue: "\(hours) hours since the last reading", comment: "Row label in the gap table. The placeholder is a number of hours.") }
        static var gapMeaning: String { String(localized: "overTime.gap.meaning", defaultValue: "The live half falls to nothing after three days, but the earned half stays where it is, and the estimate is the geometric mean of the two — so it drops a long way and never reaches zero while a history exists. One reading restores it.", comment: "What the gap numbers mean together.") }

        static var resetHeader: String { String(localized: "overTime.reset.header", defaultValue: "Two ways it can end", comment: "Section title: break versus key loss.") }
        static var breakIs: String { String(localized: "overTime.break.is", defaultValue: "A break is the phone changing underneath the key: a different device kind, or a SIM inserted or removed. The key survives, the chain keeps extending, and the earned history restarts from zero.", comment: "What a break is.") }
        static var breakNarrow: String { String(localized: "overTime.break.narrow", defaultValue: "The test is deliberately narrow. A new network, a new city, a refused permission, an OS update: all normal life, none of them a break. A test that fired on those would be noise, and nobody would trust the times it did fire.", comment: "Why the break test is narrow.") }
        static var keyLossIs: String { String(localized: "overTime.keyLoss.is", defaultValue: "Losing the key is the other ending: a wipe, a restore to a new handset, or deleting the app. The key cannot be backed up or carried across, so the next run generates a new one.", comment: "What key loss is.") }
        static var keyLossDiffers: String { String(localized: "overTime.keyLoss.differs", defaultValue: "This is the heavier of the two. A break restarts the count under the same identity; losing the key ends that identity. The old chain stays verifiable forever, but nothing new can ever be added to it, and the new key starts a chain of its own.", comment: "How key loss differs from a break.") }
        static var resetNote: String { String(localized: "overTime.reset.note", defaultValue: "Neither is a judgement about a person. Both are facts about a device, which is all continuity has ever claimed to be about.", comment: "Footer under the two endings.") }
    }

    enum Common {
        static func fraction(_ count: String, _ total: String) -> String { String(localized: "common.fraction", defaultValue: "\(count) of \(total)", comment: "A count out of a total, e.g. '7 of 12'. Both placeholders are numbers.") }

        static var done: String { String(localized: "common.done", defaultValue: "Done", comment: "Button that closes a sheet. Use the word iOS uses in your language.") }
        static var none: String { String(localized: "common.none", defaultValue: "—", comment: "Shown in place of a value the phone did not report. An em dash; use your language's usual 'no value' mark.") }
        static var yes: String { String(localized: "common.yes", defaultValue: "Yes", comment: "Value of a yes/no row, e.g. 'External: Yes'.") }
        static var no: String { String(localized: "common.no", defaultValue: "No", comment: "Value of a yes/no row, e.g. 'External: No'.") }
        static var status: String { String(localized: "common.row.status", defaultValue: "Status", comment: "Row label at the top of every sensor section: whether that sensor could be read. Value is a supportStatus word.") }
        static var samples: String { String(localized: "common.row.samples", defaultValue: "Samples", comment: "Row label in the Motion, Magnetic field and Barometer sections: how many readings arrived during the last reading time.") }
        static var notGiven: String { String(localized: "common.notGiven", defaultValue: "Not given", comment: "Value when iOS or the app gave no value, e.g. no height above sea level.") }
        static var notValid: String { String(localized: "common.notValid", defaultValue: "Not valid", comment: "Value of a position's speed or direction when iOS marks it as not usable.") }
        static var unknown: String { String(localized: "common.unknown", defaultValue: "Unknown", comment: "Value when the phone reports a state it cannot name.") }
    }

    /// Whether a sensor could be read, from the SDK's `SignalSupportStatus`, and the plain line
    /// under it. The SDK's own reason sentence is not shown: it names internals.
    enum SupportStatus {
        static func words(_ status: SignalSupportStatus) -> String {
            switch status {
            case .available: String(localized: "supportStatus.available", defaultValue: "Available", comment: "Status row value: the sensor was read.")
            case .unavailable: String(localized: "supportStatus.unavailable", defaultValue: "Unavailable", comment: "Status row value: the sensor exists but could not be read right now.")
            case .notSupportedByPlatform: String(localized: "supportStatus.notSupportedByPlatform", defaultValue: "Not on this device", comment: "Status row value: this device has no such sensor.")
            case .disabledByConfiguration: String(localized: "supportStatus.disabledByConfiguration", defaultValue: "Turned off in this app", comment: "Status row value: this app chose not to read the sensor.")
            case .notCollected: String(localized: "supportStatus.notCollected", defaultValue: "Not read yet", comment: "Status row value: the sensor was not read this time, often for lack of permission. A hint line follows.")
            }
        }

        /// The line under the status row, or nil when the status needs no explanation.
        static func explanation(_ status: SignalSupportStatus) -> String? {
            switch status {
            case .available: nil
            case .unavailable: String(localized: "supportStatus.explanation.unavailable", defaultValue: "This phone can't give a reading right now.", comment: "Line under a status of Unavailable.")
            case .notSupportedByPlatform: String(localized: "supportStatus.explanation.notSupportedByPlatform", defaultValue: "This device doesn't have this sensor.", comment: "Line under a status of Not on this device.")
            case .disabledByConfiguration: String(localized: "supportStatus.explanation.disabledByConfiguration", defaultValue: "This app has turned this reading off.", comment: "Line under a status of Turned off in this app.")
            case .notCollected: String(localized: "supportStatus.explanation.notCollected", defaultValue: "iOS gave no reading this time.", comment: "Line under a status of Not read yet, for sensors that need no permission.")
            }
        }

        /// For motion, the magnetometer and the barometer, which need Motion & Fitness: what to do next.
        static var motionPermissionNotAsked: String { String(localized: "supportStatus.hint.motionNotAsked", defaultValue: "Turn on Motion & Fitness on the Settings tab.", comment: "Line under 'Not read yet' in the Motion, Magnetic field and Barometer sections when the permission was never asked. 'Settings tab' is this app's tab.") }
        static var motionPermissionOff: String { String(localized: "supportStatus.hint.motionOff", defaultValue: "Motion & Fitness is off. Turn it on in iOS Settings.", comment: "Line under 'Not read yet' in the Motion, Magnetic field and Barometer sections when the permission was refused.") }
        static var compassNeedsCalibration: String { String(localized: "supportStatus.hint.compassCalibration", defaultValue: "No reading yet. Move the phone in a figure-eight.", comment: "Line under 'Not read yet' in the Magnetic field section when the permission is on: the magnetometer needs calibrating.") }
        static var barometerTooSlow: String { String(localized: "supportStatus.hint.barometerSlow", defaultValue: "No reading arrived in time. Try a longer wait on the Settings tab.", comment: "Line under 'Not read yet' in the Barometer section when the permission is on: the wait was too short.") }
    }

    /// Plain words for the tokens the SDK reports as text. A token not listed here is shown
    /// humanized (underscores to spaces, first letter capitalised) by `SensorHostFormat.sdkValue`.
    enum SDKValue {
        static func words(_ token: String) -> String? {
            switch token {
            // Shared
            case "unknown": Common.unknown
            case "none": String(localized: "sdkValue.none", defaultValue: "None", comment: "An audio or Bluetooth connection value: nothing connected.")
            case "other": String(localized: "sdkValue.other", defaultValue: "Other", comment: "A connection value: a kind iOS does not name.")
            // Temperature
            case "nominal": String(localized: "sdkValue.thermal.nominal", defaultValue: "Normal", comment: "Phone temperature: normal.")
            case "fair": String(localized: "sdkValue.thermal.fair", defaultValue: "Warm", comment: "Phone temperature: slightly raised.")
            case "serious": String(localized: "sdkValue.thermal.serious", defaultValue: "Hot", comment: "Phone temperature: high, iOS is slowing things down.")
            case "critical": String(localized: "sdkValue.thermal.critical", defaultValue: "Very hot", comment: "Phone temperature: critical.")
            // Battery
            case "unplugged": String(localized: "sdkValue.battery.unplugged", defaultValue: "Not charging", comment: "Battery power state: no charger connected.")
            case "charging": String(localized: "sdkValue.battery.charging", defaultValue: "Charging", comment: "Battery power state: charging.")
            case "full": String(localized: "sdkValue.battery.full", defaultValue: "Full", comment: "Battery power state: plugged in and full.")
            // Magnetometer calibration
            case "raw": String(localized: "sdkValue.calibration.raw", defaultValue: "Uncorrected", comment: "Magnetometer calibration: the reading is straight from the sensor, not corrected.")
            case "uncalibrated": String(localized: "sdkValue.calibration.uncalibrated", defaultValue: "Not calibrated", comment: "Magnetometer calibration: not calibrated yet.")
            case "low": String(localized: "sdkValue.calibration.low", defaultValue: "Low", comment: "Magnetometer calibration: low accuracy.")
            case "medium": String(localized: "sdkValue.calibration.medium", defaultValue: "Medium", comment: "Magnetometer calibration: medium accuracy.")
            case "high": String(localized: "sdkValue.calibration.high", defaultValue: "High", comment: "Magnetometer calibration: high accuracy.")
            // Audio output
            case "bluetooth": String(localized: "sdkValue.route.bluetooth", defaultValue: "Bluetooth", comment: "Audio plays through a Bluetooth device.")
            case "airplay": String(localized: "sdkValue.route.airplay", defaultValue: "AirPlay", comment: "Audio plays through AirPlay. Apple's product name.")
            case "car": String(localized: "sdkValue.route.car", defaultValue: "Car", comment: "Audio plays through a car.")
            case "wired": String(localized: "sdkValue.route.wired", defaultValue: "Wired", comment: "Audio plays through wired headphones, or the network is a wired connection.")
            case "speaker": String(localized: "sdkValue.route.speaker", defaultValue: "Speaker", comment: "Audio plays through the phone's loudspeaker.")
            case "receiver": String(localized: "sdkValue.route.receiver", defaultValue: "Earpiece", comment: "Audio plays through the phone's earpiece, as in a call.")
            case "display": String(localized: "sdkValue.route.display", defaultValue: "Display", comment: "Audio plays through a connected screen.")
            case "usb": String(localized: "sdkValue.route.usb", defaultValue: "USB", comment: "Audio plays through a USB device.")
            case "external": String(localized: "sdkValue.route.external", defaultValue: "External", comment: "Audio plays through something outside the phone.")
            case "on_device": String(localized: "sdkValue.route.onDevice", defaultValue: "On the phone", comment: "Audio plays through the phone itself.")
            // Bluetooth permission and radio
            case "allowed": String(localized: "sdkValue.bluetooth.allowed", defaultValue: "Allowed", comment: "Bluetooth permission: allowed.")
            case "denied": String(localized: "sdkValue.bluetooth.denied", defaultValue: "Denied", comment: "Bluetooth permission: refused.")
            case "restricted": String(localized: "sdkValue.restricted", defaultValue: "Restricted", comment: "Bluetooth permission or mobile data: blocked by a restriction.")
            case "not_determined": String(localized: "sdkValue.bluetooth.notDetermined", defaultValue: "Not asked yet", comment: "Bluetooth permission: never asked.")
            case "not_authorized": String(localized: "sdkValue.bluetooth.notAuthorized", defaultValue: "Not allowed", comment: "Bluetooth permission: not allowed.")
            case "powered_on": String(localized: "sdkValue.bluetooth.poweredOn", defaultValue: "On", comment: "Bluetooth radio: on.")
            case "powered_off": String(localized: "sdkValue.bluetooth.poweredOff", defaultValue: "Off", comment: "Bluetooth radio: off.")
            case "unauthorized": String(localized: "sdkValue.bluetooth.unauthorized", defaultValue: "Not allowed", comment: "Bluetooth radio state: this app may not use it.")
            case "unsupported": String(localized: "sdkValue.bluetooth.unsupported", defaultValue: "Not on this device", comment: "Bluetooth radio state: this device has no Bluetooth.")
            case "resetting": String(localized: "sdkValue.bluetooth.resetting", defaultValue: "Restarting", comment: "Bluetooth radio state: restarting.")
            // Mobile network
            case "5g": String(localized: "sdkValue.radio.5g", defaultValue: "5G", comment: "Mobile network generation.")
            case "4g": String(localized: "sdkValue.radio.4g", defaultValue: "4G", comment: "Mobile network generation.")
            case "3g": String(localized: "sdkValue.radio.3g", defaultValue: "3G", comment: "Mobile network generation.")
            case "2g": String(localized: "sdkValue.radio.2g", defaultValue: "2G", comment: "Mobile network generation.")
            case "visible": String(localized: "sdkValue.radio.visible", defaultValue: "Visible", comment: "Whether the mobile radio could be seen: yes.")
            case "hidden_by_ios": String(localized: "sdkValue.radio.hiddenByIOS", defaultValue: "Hidden by iOS", comment: "Whether the mobile radio could be seen: iOS hides it.")
            case "not_observed": String(localized: "sdkValue.radio.notObserved", defaultValue: "Not checked", comment: "Whether the mobile radio could be seen: not checked.")
            case "not_restricted": String(localized: "sdkValue.cellular.notRestricted", defaultValue: "Allowed", comment: "Mobile data for this app: allowed.")
            // Network
            case "satisfied": String(localized: "sdkValue.path.satisfied", defaultValue: "Connected", comment: "Network status: connected.")
            case "unsatisfied": String(localized: "sdkValue.path.unsatisfied", defaultValue: "Not connected", comment: "Network status: not connected.")
            case "requires_connection": String(localized: "sdkValue.path.requiresConnection", defaultValue: "Needs to connect", comment: "Network status: available, but must connect first.")
            case "not_available": String(localized: "sdkValue.path.notAvailable", defaultValue: "No network", comment: "Why not connected: no network in reach.")
            case "cellular_denied": String(localized: "sdkValue.path.cellularDenied", defaultValue: "Mobile data off for this app", comment: "Why not connected: mobile data is turned off for this app.")
            case "wifi_denied": String(localized: "sdkValue.path.wifiDenied", defaultValue: "Wi-Fi off for this app", comment: "Why not connected: Wi-Fi is turned off for this app.")
            case "local_network_denied": String(localized: "sdkValue.path.localNetworkDenied", defaultValue: "Local network off for this app", comment: "Why not connected: local network access is off for this app.")
            case "vpn_inactive": String(localized: "sdkValue.path.vpnInactive", defaultValue: "VPN not connected", comment: "Why not connected: the VPN is not connected.")
            case "wifi": String(localized: "sdkValue.interface.wifi", defaultValue: "Wi-Fi", comment: "Connection type: Wi-Fi.")
            case "cellular": String(localized: "sdkValue.interface.cellular", defaultValue: "Mobile data", comment: "Connection type: mobile data.")
            case "loopback": String(localized: "sdkValue.interface.loopback", defaultValue: "This device only", comment: "Connection type: a connection to this device itself.")
            // Wi-Fi seen before
            case "unavailable": String(localized: "sdkValue.wifi.unavailable", defaultValue: "Can't tell", comment: "Wi-Fi seen before: the app could not check.")
            case "new": String(localized: "sdkValue.wifi.new", defaultValue: "First time", comment: "Wi-Fi seen before: first time on this network.")
            case "known": String(localized: "sdkValue.wifi.known", defaultValue: "Seen before", comment: "Wi-Fi seen before: seen before, but not often.")
            case "familiar": String(localized: "sdkValue.wifi.familiar", defaultValue: "Often", comment: "Wi-Fi seen before: seen on several different days, like home or work.")
            // Device type
            case "unspecified": String(localized: "sdkValue.idiom.unspecified", defaultValue: "Not stated", comment: "Device type: iOS did not say.")
            case "phone": String(localized: "sdkValue.idiom.phone", defaultValue: "iPhone", comment: "Device type. Apple's product name.")
            case "pad": String(localized: "sdkValue.idiom.pad", defaultValue: "iPad", comment: "Device type. Apple's product name.")
            case "tv": String(localized: "sdkValue.idiom.tv", defaultValue: "Apple TV", comment: "Device type. Apple's product name.")
            case "car_play": String(localized: "sdkValue.idiom.carPlay", defaultValue: "CarPlay", comment: "Device type. Apple's product name.")
            case "mac": String(localized: "sdkValue.idiom.mac", defaultValue: "Mac", comment: "Device type. Apple's product name.")
            case "vision": String(localized: "sdkValue.idiom.vision", defaultValue: "Apple Vision Pro", comment: "Device type. Apple's product name.")
            default: nil
            }
        }
    }

    /// Units written after a number. The number argument is already formatted for the locale.
    enum Unit {
        static func seconds(_ number: String) -> String { String(localized: "unit.seconds", defaultValue: "\(number) s", comment: "A reading time in seconds, e.g. '1.5 s'. %@ is the formatted number.") }
        static func metres(_ number: String) -> String { String(localized: "unit.metres", defaultValue: "\(number) m", comment: "A height in metres, e.g. '12.3 m'. %@ is the formatted number.") }
        static func plusMinusMetres(_ number: String) -> String { String(localized: "unit.plusMinusMetres", defaultValue: "± \(number) m", comment: "How far off a position may be, in metres, e.g. '± 5.0 m'. %@ is the formatted number.") }
        static func metresPerSecond(_ number: String) -> String { String(localized: "unit.metresPerSecond", defaultValue: "\(number) m/s", comment: "A speed in metres per second, e.g. '1.2 m/s'. %@ is the formatted number.") }
        static func degrees(_ number: String) -> String { String(localized: "unit.degrees", defaultValue: "\(number)°", comment: "A direction in degrees from north, e.g. '270°'. %@ is the formatted number.") }
        static func g(_ number: String) -> String { String(localized: "unit.g", defaultValue: "\(number) g", comment: "Acceleration in g (multiples of Earth's gravity), e.g. '0.012 g'. %@ is the formatted number.") }
        static func radiansPerSecond(_ number: String) -> String { String(localized: "unit.radiansPerSecond", defaultValue: "\(number) rad/s", comment: "Rotation speed in radians per second, e.g. '0.003 rad/s'. %@ is the formatted number.") }
        static func microtesla(_ number: String) -> String { String(localized: "unit.microtesla", defaultValue: "\(number) µT", comment: "Magnetic field strength in microtesla, e.g. '42.100 µT'. %@ is the formatted number.") }
        static func hectopascals(_ number: String) -> String { String(localized: "unit.hectopascals", defaultValue: "\(number) hPa", comment: "Air pressure in hectopascals, e.g. '1013.25 hPa'. %@ is the formatted number.") }
        static func celsius(_ number: String) -> String { String(localized: "unit.celsius", defaultValue: "\(number) °C", comment: "An air temperature in degrees Celsius, e.g. '12.4 °C'. %@ is the formatted number.") }
        static func feet(_ number: String) -> String { String(localized: "unit.feet", defaultValue: "\(number) ft", comment: "A height in feet, e.g. '40.4 ft'. %@ is the formatted number.") }
        static func plusMinusFeet(_ number: String) -> String { String(localized: "unit.plusMinusFeet", defaultValue: "± \(number) ft", comment: "How far off a position may be, in feet. %@ is the formatted number.") }
        static func fahrenheit(_ number: String) -> String { String(localized: "unit.fahrenheit", defaultValue: "\(number) °F", comment: "An air temperature in degrees Fahrenheit. %@ is the formatted number.") }
        static func inchesOfMercury(_ number: String) -> String { String(localized: "unit.inchesOfMercury", defaultValue: "\(number) inHg", comment: "Air pressure in inches of mercury, as US weather reports give it, e.g. '30.12 inHg'. %@ is the formatted number.") }
        static func percent(_ number: String) -> String { String(localized: "unit.percent", defaultValue: "\(number)%", comment: "A relative humidity in percent, e.g. '62%'. %@ is the formatted number.") }
    }

    // MARK: - Sensors tab: Status

    enum Collection {
        static var header: String { String(localized: "collection.header", defaultValue: "Status", comment: "Section title at the top of the Sensors tab: when the sensors were last read.") }
        static var collectedAt: String { String(localized: "collection.row.collectedAt", defaultValue: "Last read", comment: "Row label: the time the sensors were last read.") }
        static var state: String { String(localized: "collection.row.state", defaultValue: "Now", comment: "Row label: whether the sensors are being read right now.") }
        static var collecting: String { String(localized: "collection.state.collecting", defaultValue: "Reading…", comment: "Value of the Now row while the sensors are being read.") }
        static var idle: String { String(localized: "collection.state.idle", defaultValue: "Waiting", comment: "Value of the Now row between reads.") }
        static var failed: String { String(localized: "collection.failure", defaultValue: "The sensors couldn't be read. Trying again.", comment: "Red line in the Status section when a read fails. The app retries automatically.") }
    }

    // MARK: - Sensors tab: Battery and temperature

    enum Power {
        static var header: String { String(localized: "power.header", defaultValue: "Battery and heat", comment: "Section title on the Sensors tab.") }
        static var thermalState: String { String(localized: "power.row.thermalState", defaultValue: "Heat level", comment: "Row label: iOS's thermal state for the phone, a level rather than a temperature (Normal, Warm, Hot, Very hot).") }
        static var batteryLevel: String { String(localized: "power.row.batteryLevel", defaultValue: "Battery", comment: "Row label: battery charge as a percentage.") }
        static var batteryState: String { String(localized: "power.row.batteryState", defaultValue: "Power", comment: "Row label: charging, full or not charging.") }
        static var lowPowerMode: String { String(localized: "power.row.lowPowerMode", defaultValue: "Low Power Mode", comment: "Row label: whether iOS Low Power Mode is on. Use iOS's name for it in your language.") }
    }

    // MARK: - Sensors tab: Motion

    enum Motion {
        static var header: String { String(localized: "motion.header", defaultValue: "Motion", comment: "Section title on the Sensors tab: how the phone moves and turns.") }
        static var footer: String { String(localized: "motion.footer", defaultValue: "Lying still, movement and rotation stay near zero. Pick the phone up or turn it and they change.", comment: "Footer under the Motion section, telling the reader what to try.") }
        static var userAcceleration: String { String(localized: "motion.row.userAcceleration", defaultValue: "Movement", comment: "Row label: how hard the phone is being moved, in g.") }
        static var rotationRate: String { String(localized: "motion.row.rotationRate", defaultValue: "Rotation", comment: "Row label: how fast the phone is turning, in radians per second.") }
        static var gravity: String { String(localized: "motion.row.gravity", defaultValue: "Gravity", comment: "Row label: gravity as the phone feels it, in g. About 1 when still.") }
    }

    // MARK: - Sensors tab: Magnetic field

    enum Magnetometer {
        static var header: String { String(localized: "magnetometer.header", defaultValue: "Magnetic field", comment: "Section title on the Sensors tab: the magnetic field sensor.") }
        static var footer: String { String(localized: "magnetometer.footer", defaultValue: "Earth's field is about 25 to 65 µT. Hold the phone near a speaker magnet and the number jumps.", comment: "Footer under the Magnetic field section. µT is microtesla.") }
        static var field: String { String(localized: "magnetometer.row.field", defaultValue: "Strength", comment: "Row label: magnetic field strength, in microtesla.") }
        static var calibration: String { String(localized: "magnetometer.row.calibration", defaultValue: "Calibration", comment: "Row label: how well the magnetometer is calibrated.") }
    }

    // MARK: - Sensors tab: Barometer

    enum Barometer {
        static var header: String { String(localized: "barometer.header", defaultValue: "Barometer", comment: "Section title on the Sensors tab: the air pressure sensor.") }
        static var footer: String { String(localized: "barometer.footer", defaultValue: "Carry the phone upstairs and pressure drops by about 0.12 hPa for each metre. Relative height is the change across one reading time.", comment: "Footer under the Barometer section. hPa is hectopascals.") }
        static var pressure: String { String(localized: "barometer.row.pressure", defaultValue: "Pressure", comment: "Row label: air pressure, in hectopascals.") }
        static var relativeAltitude: String { String(localized: "barometer.row.relativeAltitude", defaultValue: "Relative height", comment: "Row label: change in height since the first reading, in metres.") }
    }

    // MARK: - Sensors tab: Audio route

    enum AudioRoute {
        static var header: String { String(localized: "audioRoute.header", defaultValue: "Audio route", comment: "Section title on the Sensors tab: where sound plays.") }
        static var footer: String { String(localized: "audioRoute.footer", defaultValue: "Connect headphones and each count goes up by one. The counts are kept after the app closes, until you erase them.", comment: "Footer under the Audio route section.") }
        static var routeClass: String { String(localized: "audioRoute.row.routeClass", defaultValue: "Plays through", comment: "Row label: where sound plays (Speaker, Bluetooth, Car …).") }
        static var external: String { String(localized: "audioRoute.row.external", defaultValue: "External", comment: "Row label: whether sound plays through something outside the phone. Value is Yes or No.") }
        static var otherAudioPlaying: String { String(localized: "audioRoute.row.otherAudioPlaying", defaultValue: "Other audio playing", comment: "Row label: whether another app is playing sound. Value is Yes or No.") }
        static var routeChanges: String { String(localized: "audioRoute.row.routeChanges", defaultValue: "Route changes", comment: "Row label: how many times the place sound plays has changed.") }
        static var externalRouteChanges: String { String(localized: "audioRoute.row.externalRouteChanges", defaultValue: "External route changes", comment: "Row label: how many times sound moved to or from something outside the phone.") }
    }

    // MARK: - Sensors tab: Bluetooth

    enum Bluetooth {
        static var header: String { String(localized: "bluetooth.header", defaultValue: "Bluetooth", comment: "Section title on the Sensors tab.") }
        static var footer: String { String(localized: "bluetooth.footer", defaultValue: "Shows only the kind of connection: Bluetooth, car or none. No device names are read.", comment: "Footer under the Bluetooth section.") }
        static var authorization: String { String(localized: "bluetooth.row.authorization", defaultValue: "Permission", comment: "Row label: whether this app may use Bluetooth.") }
        static var radioState: String { String(localized: "bluetooth.row.radioState", defaultValue: "Bluetooth", comment: "Row label: whether Bluetooth is on.") }
        static var scanAvailable: String { String(localized: "bluetooth.row.scanAvailable", defaultValue: "Can search", comment: "Row label: whether the app could search for Bluetooth devices. Value is Yes or No.") }
        static var audioRouteClass: String { String(localized: "bluetooth.row.audioRouteClass", defaultValue: "Audio output type", comment: "Row label: the kind of audio output in use, as the audio system reports it (Bluetooth, Car, None).") }
        static var routeConnected: String { String(localized: "bluetooth.row.routeConnected", defaultValue: "Connected", comment: "Row label: whether Bluetooth audio is connected. Value is Yes or No.") }
        static var routeChanges: String { String(localized: "bluetooth.row.routeChanges", defaultValue: "Changes", comment: "Row label: how many times the Bluetooth audio connection has changed.") }
    }

    // MARK: - Sensors tab: Mobile network

    enum Telephony {
        static var header: String { String(localized: "telephony.header", defaultValue: "Mobile network", comment: "Section title on the Sensors tab: the mobile radio and SIM.") }
        static var footer: String { String(localized: "telephony.footer", defaultValue: "Only counts when the mobile data service changes. The service itself is never saved or sent.", comment: "Footer under the Mobile network section.") }
        static var radioGenerations: String { String(localized: "telephony.row.radioGenerations", defaultValue: "Network type", comment: "Row label: mobile network generations in use, e.g. 5G, 4G.") }
        static var radioVisibility: String { String(localized: "telephony.row.radioVisibility", defaultValue: "Radio visible", comment: "Row label: whether the app could see the mobile radio.") }
        static var serviceCount: String { String(localized: "telephony.row.serviceCount", defaultValue: "Mobile services", comment: "Row label: how many mobile services iOS reports a radio technology for. Apple calls each one a service, not a SIM.") }
        static var simInserted: String { String(localized: "telephony.row.simInserted", defaultValue: "Carrier SIM match", comment: "Row label: whether iOS finds a SIM matching the carrier details the app declares. Value is Yes or No.") }
        static var cellularData: String { String(localized: "telephony.row.cellularData", defaultValue: "Mobile data", comment: "Row label: whether this app may use mobile data.") }
        static var dataServiceVisible: String { String(localized: "telephony.row.dataServiceVisible", defaultValue: "Data service visible", comment: "Row label: whether a mobile data service can be seen. Value is Yes or No.") }
        static var dataServiceChanges: String { String(localized: "telephony.row.dataServiceChanges", defaultValue: "Data service changes", comment: "Row label: how many times the mobile data service changed.") }
    }

    // MARK: - Sensors tab: Calls

    enum CallActivity {
        static var header: String { String(localized: "callActivity.header", defaultValue: "Calls", comment: "Section title on the Sensors tab: phone call counts.") }
        static var footer: String { String(localized: "callActivity.footer", defaultValue: "Make or end a call and the counts change. No numbers or contacts are read.", comment: "Footer under the Calls section.") }
        static var events: String { String(localized: "callActivity.row.events", defaultValue: "Changes seen", comment: "Row label: how many call changes (start, connect, end) have been seen.") }
        static var lastEvent: String { String(localized: "callActivity.row.lastEvent", defaultValue: "Last change", comment: "Row label: time of the most recent call change.") }
        static var activeCalls: String { String(localized: "callActivity.row.activeCalls", defaultValue: "Active calls", comment: "Row label: calls not yet ended.") }
        static var connectedCalls: String { String(localized: "callActivity.row.connectedCalls", defaultValue: "Connected calls", comment: "Row label: calls that have connected.") }
        static var heldCalls: String { String(localized: "callActivity.row.heldCalls", defaultValue: "Calls on hold", comment: "Row label: calls on hold.") }
        static var observerStarted: String { String(localized: "callActivity.row.observerStarted", defaultValue: "Watching since", comment: "Row label: when this app started watching for calls.") }
    }

    // MARK: - Sensors tab: Network

    enum Connectivity {
        static var header: String { String(localized: "connectivity.header", defaultValue: "Network", comment: "Section title on the Sensors tab: the internet connection.") }
        static var pathStatus: String { String(localized: "connectivity.row.pathStatus", defaultValue: "Connection", comment: "Row label: whether the phone is online.") }
        static var unsatisfiedReason: String { String(localized: "connectivity.row.unsatisfiedReason", defaultValue: "Why not connected", comment: "Row label: why the phone is offline.") }
        static var interfaces: String { String(localized: "connectivity.row.interfaces", defaultValue: "Connection types", comment: "Row label: Wi-Fi, mobile data and so on, as a list.") }
        static var expensive: String { String(localized: "connectivity.row.expensive", defaultValue: "Costly network", comment: "Row label: whether iOS treats this network as costly, like mobile data. Value is Yes or No.") }
        static var constrained: String { String(localized: "connectivity.row.constrained", defaultValue: "Low Data Mode", comment: "Row label: whether Low Data Mode is on for this network. Use iOS's name for it. Value is Yes or No.") }
        static var wifiName: String { String(localized: "connectivity.row.wifiName", defaultValue: "Wi-Fi name", comment: "Row label: the current Wi-Fi network's name.") }
        static var wifiFamiliarity: String { String(localized: "connectivity.row.wifiFamiliarity", defaultValue: "Wi-Fi seen before", comment: "Row label: whether this Wi-Fi network has been seen before.") }
        static var wifiToken: String { String(localized: "connectivity.row.wifiToken", defaultValue: "Private Wi-Fi code", comment: "Row label: whether the app made a private code for this Wi-Fi network, so it can recognise it without keeping its name.") }
        static var present: String { String(localized: "connectivity.value.present", defaultValue: "Made", comment: "Value of the Private Wi-Fi code row when a code exists. The code itself is never shown.") }
    }

    // MARK: - Sensors tab: Device

    enum DeviceSurface {
        static var header: String { String(localized: "deviceSurface.header", defaultValue: "Device", comment: "Section title on the Sensors tab: this phone and its system.") }
        static var platform: String { String(localized: "deviceSurface.row.platform", defaultValue: "Platform", comment: "Row label: the platform, e.g. iOS.") }
        static var system: String { String(localized: "deviceSurface.row.system", defaultValue: "System", comment: "Row label: the operating system's name, e.g. iOS.") }
        static var majorVersion: String { String(localized: "deviceSurface.row.majorVersion", defaultValue: "Version", comment: "Row label: the operating system's main version number.") }
        static var idiom: String { String(localized: "deviceSurface.row.idiom", defaultValue: "Device type", comment: "Row label: iPhone, iPad and so on.") }
        static var bundleIdentifier: String { String(localized: "deviceSurface.row.bundleIdentifier", defaultValue: "App ID", comment: "Row label: this app's ID, e.g. org.example.sensorhost. The value is shown as-is.") }
        static var simulator: String { String(localized: "deviceSurface.row.simulator", defaultValue: "Simulator", comment: "Row label: whether the app runs in the Simulator on a Mac. Value is Yes or No.") }
    }

    // MARK: - Sensors tab: Location

    enum Location {
        static var header: String { String(localized: "location.header", defaultValue: "Location", comment: "Section title on the Sensors tab.") }
        static var footer: String { String(localized: "location.footer", defaultValue: "Nothing here is saved. Only the map area is sent to Apple, to draw the map.", comment: "Footer under the Location section.") }
        static var getOneFix: String { String(localized: "location.button.getOneFix", defaultValue: "Get one fix", comment: "Button: ask iOS for the phone's position once. Other notes and the location permission prompt name this button, so keep them in step.") }
        static var gettingFix: String { String(localized: "location.button.gettingFix", defaultValue: "Getting a fix…", comment: "The Get one fix button's title while iOS looks for the position.") }
        static var getOneFixNote: String { String(localized: "location.note.getOneFix", defaultValue: "Asks iOS for the phone's position once. iOS decides how long that takes.", comment: "Caption under the Get one fix button.") }
        static var result: String { String(localized: "location.row.result", defaultValue: "Result", comment: "Row label shown when iOS answered without a position.") }
        static var noFix: String { String(localized: "location.value.noFix", defaultValue: "No position", comment: "Value of the Result row when iOS gave no usable position.") }
        static var noFixNote: String { String(localized: "location.note.noFix", defaultValue: "Location may be off, or iOS couldn't find the phone.", comment: "Caption under 'Result: No position'.") }

        static var emptyNoFixes: String { String(localized: "location.map.empty.noFixes", defaultValue: "No positions yet. Press Get one fix.", comment: "Notice over the empty map when location is allowed. 'Get one fix' is the button's name.") }
        static var emptyLocationOff: String { String(localized: "location.map.empty.locationOff", defaultValue: "Location is off. Turn on Location while using on the Settings tab, then press Get one fix.", comment: "Notice over the empty map when location is not allowed. 'Location while using' is a switch on this app's Settings tab; 'Get one fix' is the button's name.") }
        static var fixesOnMap: String { String(localized: "location.map.row.fixesOnMap", defaultValue: "Dots on the map", comment: "Row label under the map: how many positions are drawn, out of the most kept.") }
        static func fixesOnMapCount(_ count: String, of limit: String) -> String { String(localized: "location.map.value.fixesOnMapCount", defaultValue: "\(count) of \(limit)", comment: "Value of the Dots on the map row, e.g. '3 of 20'. %1$@ is dots drawn, %2$@ the most kept.") }
        static var clear: String { String(localized: "location.map.button.clear", defaultValue: "Clear", comment: "Button beside Dots on the map: removes every dot.") }
        static var mapNote: String { String(localized: "location.map.note", defaultValue: "Each press of Get one fix adds a dot, inside a circle showing how far off it might be. Blue is precise, orange is approximate. The ringed dot is the app's best guess of where the phone is now.", comment: "Caption under the map. The colour words must match colors.preciseFix and colors.approximateFix in SensorHostConfig.jsonc. 'Get one fix' is the button's name.") }

        static var latitude: String { String(localized: "location.row.latitude", defaultValue: "Latitude", comment: "Row label: the position's latitude in degrees, not rounded.") }
        static var longitude: String { String(localized: "location.row.longitude", defaultValue: "Longitude", comment: "Row label: the position's longitude in degrees, not rounded.") }
        static var positionNote: String { String(localized: "location.note.position", defaultValue: "Where the phone is, exactly as iOS reported it.", comment: "Caption under the latitude and longitude rows.") }
        static var horizontalAccuracy: String { String(localized: "location.row.horizontalAccuracy", defaultValue: "Position accuracy", comment: "Row label: how far off the position may be, in metres.") }
        static var verticalAccuracy: String { String(localized: "location.row.verticalAccuracy", defaultValue: "Height accuracy", comment: "Row label: how far off the height may be, in metres.") }
        static var accuracyNote: String { String(localized: "location.note.accuracy", defaultValue: "How far off the position and the height might be. Smaller is better.", comment: "Caption under the accuracy rows.") }
        static var altitude: String { String(localized: "location.row.altitude", defaultValue: "Height above sea level", comment: "Row label: height above sea level, in metres.") }
        static var altitudeNote: String { String(localized: "location.note.altitude", defaultValue: "Shown only when iOS gives one.", comment: "Caption under the height above sea level row.") }
        static var speed: String { String(localized: "location.row.speed", defaultValue: "Speed", comment: "Row label: how fast the phone was moving, in metres per second.") }
        static var course: String { String(localized: "location.row.course", defaultValue: "Direction", comment: "Row label: which way the phone was moving, in degrees from north.") }
        static var movementNote: String { String(localized: "location.note.movement", defaultValue: "How fast and which way the phone was moving. A phone lying still usually has neither.", comment: "Caption under the speed and direction rows.") }
        static var measuredAt: String { String(localized: "location.row.measuredAt", defaultValue: "Measured at", comment: "Row label: the date and time iOS measured the position.") }
        static var age: String { String(localized: "location.row.age", defaultValue: "Age", comment: "Row label: how long ago iOS measured the position, ticking every second.") }
        static var inTheFuture: String { String(localized: "location.value.inTheFuture", defaultValue: "In the future", comment: "Value of the Age row when the position's time is later than now.") }
        static var timeNote: String { String(localized: "location.note.time", defaultValue: "iOS can hand back a position it already had, so it can be older than the button press.", comment: "Caption under the Measured at and Age rows.") }
        static var simulated: String { String(localized: "location.row.simulated", defaultValue: "Made up by software", comment: "Row label: whether iOS says software made this position up. Value is Yes, No or the no-value mark.") }
        static var fromAccessory: String { String(localized: "location.row.fromAccessory", defaultValue: "From an accessory", comment: "Row label: whether the position came from something connected, like a car. Value is Yes, No or the no-value mark.") }
        static var sourceNote: String { String(localized: "location.note.source", defaultValue: "A dash means iOS didn't say.", comment: "Caption under the source rows. 'A dash' refers to the common.none mark; keep them in step.") }
        static var fixContract: String { String(localized: "location.row.fixContract", defaultValue: "Basic checks", comment: "Row label: whether the position passed basic checks.") }
        static var accepted: String { String(localized: "location.value.accepted", defaultValue: "Passed", comment: "Value of the Basic checks row when every check passed.") }
        static var notAccepted: String { String(localized: "location.value.notAccepted", defaultValue: "Failed", comment: "Value of the Basic checks row when a check failed; the failed checks are listed below it.") }
        static var fixesDelivered: String { String(localized: "location.row.fixesDelivered", defaultValue: "Positions received", comment: "Row label: how many positions iOS sent in its answer.") }
        static var contractNote: String { String(localized: "location.note.contract", defaultValue: "The position must have a real time, be on the globe and say how accurate it is. When iOS sends several, the best one is shown.", comment: "Caption under the Basic checks rows.") }
        static var permissionThen: String { String(localized: "location.row.permissionThen", defaultValue: "Permission at the time", comment: "Row label: the location permission when this position arrived.") }
        static var precisionThen: String { String(localized: "location.row.precisionThen", defaultValue: "Precision at the time", comment: "Row label: precise or approximate, when this position arrived.") }
    }

    /// Which basic check a position failed, from the SDK's `CoreLocationFixTerm`.
    enum FixTerm {
        static func words(_ term: CoreLocationFixTerm) -> String {
            switch term {
            case .finiteTimestamp: String(localized: "fixTerm.finiteTimestamp", defaultValue: "No real time", comment: "A failed position check, listed under 'Basic checks: Failed': the position has no usable time.")
            case .finiteLatitude: String(localized: "fixTerm.finiteLatitude", defaultValue: "Latitude is not a number", comment: "A failed position check.")
            case .finiteLongitude: String(localized: "fixTerm.finiteLongitude", defaultValue: "Longitude is not a number", comment: "A failed position check.")
            case .latitudeWithinNinetyDegrees: String(localized: "fixTerm.latitudeWithinNinetyDegrees", defaultValue: "Latitude is off the globe", comment: "A failed position check: latitude beyond ±90°.")
            case .longitudeWithinOneHundredEightyDegrees: String(localized: "fixTerm.longitudeWithinOneHundredEightyDegrees", defaultValue: "Longitude is off the globe", comment: "A failed position check: longitude beyond ±180°.")
            case .finiteHorizontalAccuracy: String(localized: "fixTerm.finiteHorizontalAccuracy", defaultValue: "Accuracy not given", comment: "A failed position check: iOS gave no usable accuracy.")
            case .nonNegativeHorizontalAccuracy: String(localized: "fixTerm.nonNegativeHorizontalAccuracy", defaultValue: "iOS marked the position as not usable", comment: "A failed position check: iOS flagged the accuracy as invalid.")
            }
        }
    }

    // MARK: - Settings tab: Permissions

    enum Permissions {
        static var header: String { String(localized: "permissions.header", defaultValue: "Permissions", comment: "Section title on this app's Settings tab.") }
        static var footer: String { String(localized: "permissions.footer", defaultValue: "Each switch shows what iOS allows. Turning one on asks iOS; after that, the switch opens iOS Settings.", comment: "Footer under the Permissions section. 'iOS Settings' is the system Settings app.") }
        static var motionTitle: String { String(localized: "permissions.motion.title", defaultValue: "Motion & Fitness", comment: "Switch title: the iOS Motion & Fitness permission. Use the name iOS uses in your language.") }
        static var motionNote: String { String(localized: "permissions.motion.note", defaultValue: "Needed for the barometer.", comment: "Caption under the Motion & Fitness switch.") }
        static var bluetoothTitle: String { String(localized: "permissions.bluetooth.title", defaultValue: "Bluetooth", comment: "Switch title: the iOS Bluetooth permission for this app.") }
        static var bluetoothNote: String { String(localized: "permissions.bluetooth.note", defaultValue: "Needed to read the Bluetooth radio. Nothing is searched for or connected to.", comment: "Caption under the Bluetooth switch.") }
        static var whileUsingTitle: String { String(localized: "permissions.whileUsing.title", defaultValue: "Location while using", comment: "Switch title: location while the app is open. Other notes name this switch.") }
        static var whileUsingNote: String { String(localized: "permissions.whileUsing.note", defaultValue: "Lets this app read location while it's open. Allow Once shows as on until you leave the app.", comment: "Caption under the Location while using switch. 'Allow Once' is the iOS prompt button; use iOS's wording in your language.") }
        static var alwaysTitle: String { String(localized: "permissions.always.title", defaultValue: "Location always", comment: "Switch title: location even when the app is closed.") }
        static var alwaysNote: String { String(localized: "permissions.always.note", defaultValue: "Lets this app read location when it's closed. iOS offers Always only once.", comment: "Caption under the Location always switch. 'Always' is the iOS permission option; use iOS's wording in your language.") }
        static var alwaysGranted: String { String(localized: "permissions.always.state.granted", defaultValue: "Allowed", comment: "State under the Location always switch when iOS allows it.") }
        static var alwaysNotGranted: String { String(localized: "permissions.always.state.notGranted", defaultValue: "Not allowed", comment: "State under the Location always switch when iOS does not allow it.") }
        static var preciseTitle: String { String(localized: "permissions.precise.title", defaultValue: "Precise location", comment: "Switch title: the iOS Precise Location setting.") }
        static var preciseNote: String { String(localized: "permissions.precise.note", defaultValue: "On gives the exact spot, off gives a rough area. Only iOS Settings can change this.", comment: "Caption under the Precise location switch.") }

        /// The SDK's `MotionAuthorization.State`, under the Motion & Fitness switch.
        static func words(_ state: MotionAuthorization.State) -> String {
            switch state {
            case .given: String(localized: "permissions.motion.state.granted", defaultValue: "Allowed", comment: "State under the Motion & Fitness switch.")
            case .refused: String(localized: "permissions.motion.state.denied", defaultValue: "Denied", comment: "State under the Motion & Fitness switch: refused, or blocked e.g. by Screen Time.")
            case .notRequested: String(localized: "permissions.motion.state.notRequested", defaultValue: "Not asked yet", comment: "State under the Motion & Fitness switch: never asked.")
            case .unavailable: String(localized: "permissions.motion.state.unavailable", defaultValue: "Unavailable", comment: "State under the Motion & Fitness switch: this phone has no motion activity hardware.")
            }
        }

        /// The SDK's `BluetoothAuthorization.State`, under the Bluetooth switch.
        static func words(_ state: BluetoothAuthorization.State) -> String {
            switch state {
            case .given: String(localized: "permissions.bluetooth.state.allowed", defaultValue: "Allowed", comment: "State under the Bluetooth switch.")
            case .refused: String(localized: "permissions.bluetooth.state.denied", defaultValue: "Denied", comment: "State under the Bluetooth switch: refused, or blocked e.g. by Screen Time.")
            case .notRequested: String(localized: "permissions.bluetooth.state.notRequested", defaultValue: "Not asked yet", comment: "State under the Bluetooth switch: never asked.")
            case .unavailable: String(localized: "permissions.bluetooth.state.unavailable", defaultValue: "Unavailable", comment: "State under the Bluetooth switch: iOS reported a state this app doesn't know.")
            }
        }

        /// The SDK's `LocationAuthorization.State`, under Location while using and in the
        /// Permission at the time row.
        static func words(_ state: LocationAuthorization.State) -> String {
            switch state {
            case .notRequested: String(localized: "permissions.location.state.notRequested", defaultValue: "Not asked yet", comment: "Location permission: never asked, or an Allow Once grant ended.")
            case .given: String(localized: "permissions.location.state.allowed", defaultValue: "Allowed", comment: "Location permission: allowed.")
            case .refused: String(localized: "permissions.location.state.denied", defaultValue: "Denied", comment: "Location permission: refused, or off for the whole phone.")
            case .unavailable: String(localized: "permissions.location.state.unavailable", defaultValue: "Unavailable", comment: "Location permission: location can't be used on this device.")
            }
        }

        /// The SDK's `LocationAuthorization.Accuracy`, under Precise location and in the
        /// Precision at the time row.
        static func words(_ accuracy: LocationAuthorization.Accuracy) -> String {
            switch accuracy {
            case .full: String(localized: "permissions.location.accuracy.precise", defaultValue: "Precise", comment: "Location precision: the exact spot.")
            case .reduced: String(localized: "permissions.location.accuracy.approximate", defaultValue: "Approximate", comment: "Location precision: a rough area.")
            }
        }
    }

    // MARK: - Settings tab: Reading time

    enum CaptureWindows {
        static var header: String { String(localized: "captureWindows.header", defaultValue: "Reading time", comment: "Section title on this app's Settings tab: how long each sensor is read.") }
        static var footer: String { String(localized: "captureWindows.footer", defaultValue: "Each slider takes effect when you lift your finger. The readings are on the Sensors tab.", comment: "Footer under the Reading time section.") }
        static var motionLabel: String { String(localized: "captureWindows.motion.label", defaultValue: "Motion", comment: "Slider label: how long motion is read, in seconds.") }
        static var motionNote: String { String(localized: "captureWindows.motion.note", defaultValue: "Longer makes the Sensors tab update less often. The reading shown is the newest, not an average.", comment: "Caption under the Motion slider.") }
        static var magnetometerLabel: String { String(localized: "captureWindows.magnetometer.label", defaultValue: "Magnetic field", comment: "Slider label: how long the magnetometer is read, in seconds.") }
        static var magnetometerNote: String { String(localized: "captureWindows.magnetometer.note", defaultValue: "Read together with Motion. Waiting longer doesn't calibrate the magnetometer; a figure-eight does.", comment: "Caption under the Magnetic field slider.") }
        static var sharedCaptureRuns: String { String(localized: "captureWindows.row.sharedCaptureRuns", defaultValue: "Motion and magnetic field read for", comment: "Row label: how long motion and the magnetic field are actually read, in seconds.") }
        static var sharedCaptureNote: String { String(localized: "captureWindows.note.sharedCapture", defaultValue: "The longer of the two settings above.", comment: "Caption under the Motion and magnetic field read for row.") }
        static var barometerLabel: String { String(localized: "captureWindows.barometer.label", defaultValue: "Barometer: wait for first reading", comment: "Slider label: the longest wait for the first air pressure reading, in seconds.") }
        static var barometerNote: String { String(localized: "captureWindows.barometer.note", defaultValue: "Stops as soon as a reading arrives. Too short and pressure shows nothing; slide down to find how long this phone needs.", comment: "Caption under the Barometer slider.") }
    }

    // MARK: - Settings tab: Erase

    enum Erase {
        static var header: String { String(localized: "erase.header", defaultValue: "Erase", comment: "Section title on this app's Settings tab.") }
        static var footer: String { String(localized: "erase.footer", defaultValue: "Erases everything this app has saved, then checks again. Anything left behind is shown in orange.", comment: "Footer under the Erase section. 'orange' must match colors.warning in SensorHostConfig.jsonc.") }
        static var button: String { String(localized: "erase.button.erase", defaultValue: "Erase saved data", comment: "Destructive button: erase everything this app saved.") }
        static var erasing: String { String(localized: "erase.button.erasing", defaultValue: "Erasing…", comment: "The erase button's title while erasing.") }
        static var erased: String { String(localized: "erase.status.erased", defaultValue: "Erased", comment: "Green badge beside one kind of saved data: erased.") }
        static var failed: String { String(localized: "erase.status.failed", defaultValue: "Failed", comment: "Red badge beside one kind of saved data: could not be erased.") }
        static var erasedAndChecked: String { String(localized: "erase.outcome.erased", defaultValue: "Erased and checked.", comment: "Outcome for data that was erased and checked gone.") }
        static var leftBehind: String { String(localized: "erase.outcome.failed", defaultValue: "Some of it is still on the phone.", comment: "Red line under a Failed badge.") }
        static var erasedAt: String { String(localized: "erase.row.erasedAt", defaultValue: "Erased at", comment: "Row label: the time the last erase finished.") }
        static var keysLeft: String { String(localized: "erase.row.keysLeft", defaultValue: "Items left", comment: "Row label: how many saved items are still there after erasing. 0 is the good answer.") }
        static func stillHolds(_ name: String) -> String { String(localized: "erase.survivor", defaultValue: "\(name) still has saved data", comment: "Orange line after erasing. %@ is the plain name of one kind of saved data, e.g. 'Bluetooth history'.") }
    }

    // MARK: - Settings tab: Saved on this phone

    enum Persisted {
        static var header: String { String(localized: "persisted.header", defaultValue: "Saved on this phone", comment: "Section title on this app's Settings tab: what the app still has saved.") }
        static var footer: String { String(localized: "persisted.footer", defaultValue: "What each part still has saved. Checking doesn't change anything.", comment: "Footer under the Saved on this phone section.") }
        static var nothingPersisted: String { String(localized: "persisted.value.nothing", defaultValue: "Nothing saved", comment: "Caption under a name when nothing is saved.") }
        static func savedItems(_ count: Int) -> String { String(localized: "persisted.value.savedItems", defaultValue: "\(count) saved items", comment: "Caption under a name: how many items are saved. Plural variations by count.") }
    }

    /// Plain names and descriptions for the kinds of data the app saves, looked up by the SDK's
    /// store type name. The type name is the lookup key only and is never shown.
    enum SavedData {
        static func name(_ storeTypeName: String) -> String? {
            switch storeTypeName {
            case "BluetoothRouteTracker": String(localized: "savedData.bluetoothRoute.name", defaultValue: "Bluetooth history", comment: "Name of one kind of saved data: the last Bluetooth audio connection and how often it changed.")
            case "SignalChangeTracker": String(localized: "savedData.signalChange.name", defaultValue: "Audio route history", comment: "Name of one kind of saved data: the last audio route and how often it changed.")
            case "TelephonyDataServiceTracker": String(localized: "savedData.dataService.name", defaultValue: "Mobile data history", comment: "Name of one kind of saved data: how often the mobile data service changed.")
            case "CallActivityRecorder": String(localized: "savedData.calls.name", defaultValue: "Call counts", comment: "Name of one kind of saved data: call counts and times.")
            case "WifiNetworkIdentity": String(localized: "savedData.wifi.name", defaultValue: "Remembered Wi-Fi", comment: "Name of one kind of saved data: Wi-Fi networks seen before.")
            case "DeviceRecurrence": String(localized: "savedData.deviceRecurrence.name", defaultValue: "Device recognition", comment: "Name of one kind of saved data: a secret used to recognise this phone again.")
            case "EvidenceIntegrity": String(localized: "savedData.integrity.name", defaultValue: "Signing key and log", comment: "Name of one kind of saved data: this phone's signing key and its record of what it signed.")
            case "BiometricCeremonySigner": String(localized: "savedData.biometric.name", defaultValue: "Face ID approval key", comment: "Name of one kind of saved data: the key Face ID or Touch ID approves.")
            default: nil
            }
        }

        static func description(_ storeTypeName: String) -> String? {
            switch storeTypeName {
            case "BluetoothRouteTracker": String(localized: "savedData.bluetoothRoute.description", defaultValue: "The kind of Bluetooth audio last connected, and how often it changed.", comment: "What Bluetooth history holds.")
            case "SignalChangeTracker": String(localized: "savedData.signalChange.description", defaultValue: "Where sound last played, and how often that changed.", comment: "What Audio route history holds.")
            case "TelephonyDataServiceTracker": String(localized: "savedData.dataService.description", defaultValue: "How often the mobile data service changed, and the secret that hides it.", comment: "What Mobile data history holds.")
            case "CallActivityRecorder": String(localized: "savedData.calls.description", defaultValue: "How many calls happened and when. No numbers or contacts.", comment: "What Call counts holds.")
            case "WifiNetworkIdentity": String(localized: "savedData.wifi.description", defaultValue: "Wi-Fi networks seen before, kept as private codes, not names.", comment: "What Remembered Wi-Fi holds.")
            case "DeviceRecurrence": String(localized: "savedData.deviceRecurrence.description", defaultValue: "A secret used to recognise this phone again without naming it.", comment: "What Device recognition holds.")
            case "EvidenceIntegrity": String(localized: "savedData.integrity.description", defaultValue: "This phone's signing key and its record of what it signed.", comment: "What Signing key and log holds.")
            case "BiometricCeremonySigner": String(localized: "savedData.biometric.description", defaultValue: "The key that Face ID or Touch ID approves, and a note that it was set up.", comment: "What Face ID approval key holds.")
            default: nil
            }
        }
    }

    // MARK: - Settings tab: Where data is kept

    enum Environment {
        static var header: String { String(localized: "environment.header", defaultValue: "Where data is kept", comment: "Section title on this app's Settings tab.") }
        static var footer: String { String(localized: "environment.footer", defaultValue: "The lines below the divider show where data would go if this app named no place of its own.", comment: "Footer under the Where data is kept section.") }
        static var defaultsSuite: String { String(localized: "environment.row.defaultsSuite", defaultValue: "Settings saved in", comment: "Row label: the named settings area. The value is a technical name shown as-is.") }
        static var durableRoot: String { String(localized: "environment.row.durableRoot", defaultValue: "Files saved in", comment: "Row label: the folder files are saved in. The value is a folder path shown as-is.") }
        static var applicationIdentifier: String { String(localized: "environment.row.applicationIdentifier", defaultValue: "App ID", comment: "Row label: this app's ID. The value is shown as-is.") }
        static var clockReads: String { String(localized: "environment.row.clockReads", defaultValue: "Clock", comment: "Row label: the time the app's clock reads now, ticking every second.") }
        static var beforeSuite: String { String(localized: "environment.row.beforeSuite", defaultValue: "Otherwise, settings in", comment: "Row label: where settings would go if the app named no place.") }
        static var beforeRoot: String { String(localized: "environment.row.beforeRoot", defaultValue: "Otherwise, files in", comment: "Row label: where files would go if the app named no place.") }
        static var beforeIdentifier: String { String(localized: "environment.row.beforeIdentifier", defaultValue: "Otherwise, app ID", comment: "Row label: the app ID that would be used if the app gave none.") }
        static var standardDomain: String { String(localized: "environment.value.standardDomain", defaultValue: "The app's main settings", comment: "Value of a settings row when no separate area is named.") }
    }

    // MARK: - Settings tab: Battery reader

    enum BatterySeam {
        static var header: String { String(localized: "batterySeam.header", defaultValue: "Battery reader", comment: "Section title on this app's Settings tab: the part of this app that reads the battery.") }
        static var footer: String { String(localized: "batterySeam.footer", defaultValue: "The battery numbers come through this app's own reader. If both counts stay at zero, it isn't being used.", comment: "Footer under the Battery reader section.") }
        static var provider: String { String(localized: "batterySeam.row.provider", defaultValue: "Reader", comment: "Row label: which reader supplies battery numbers.") }
        static var providerValue: String { String(localized: "batterySeam.value.provider", defaultValue: "This app's own", comment: "Value of the Reader row.") }
        static var readingsTaken: String { String(localized: "batterySeam.row.readingsTaken", defaultValue: "Readings", comment: "Row label: how many battery readings were taken.") }
        static var monitoringEnables: String { String(localized: "batterySeam.row.monitoringEnables", defaultValue: "Times switched on", comment: "Row label: how many times battery watching was switched on.") }
    }

    // MARK: - Settings tab: What this screen can't check

    enum Gaps {
        static var header: String { String(localized: "gaps.header", defaultValue: "What this screen can't check", comment: "Section title on this app's Settings tab.") }
        static var readBackTitle: String { String(localized: "gaps.readBack.title", defaultValue: "Some saved data can't be rechecked", comment: "Title of one limit of this screen.") }
        static var readBackBody: String { String(localized: "gaps.readBack.body", defaultValue: "Only three kinds of saved data can be asked what they still hold. For the rest, this screen trusts what the erase reported.", comment: "Explanation under the title.") }
    }

    // MARK: - A sensor's page

    enum SensorPageCopy {
        static var apis: String { String(localized: "page.header.apis", defaultValue: "Apple APIs", comment: "Section title on a sensor's page: the Apple programming interfaces its values come from. Tapping one opens Apple's documentation.") }
        static var permission: String { String(localized: "page.header.permission", defaultValue: "Permission", comment: "Section title on a sensor's page: what iOS asks the person before the app can read this sensor.") }
        static var hardware: String { String(localized: "page.header.hardware", defaultValue: "Hardware", comment: "Section title on a sensor's page: the part of the phone that does the measuring, in Apple's words.") }
        static var updates: String { String(localized: "page.header.updates", defaultValue: "How it updates", comment: "Section title on a sensor's page: how often iOS delivers new values, in Apple's words.") }
        static var algorithmHeader: String { String(localized: "sensorPage.algorithm.header", defaultValue: "How it's worked out", comment: "Section title on a sensor's page, above the steps that turn readings into the value shown.") }
        static var algorithmCode: String { String(localized: "sensorPage.algorithm.code", defaultValue: "In the SDK", comment: "Row label above the file in the SDK that carries out the steps.") }
        static var about: String { String(localized: "page.header.about", defaultValue: "About these values", comment: "Section title on a sensor's page: plain facts about the values above, taken from the SDK's code.") }
        static var limits: String { String(localized: "page.header.limits", defaultValue: "Known limits", comment: "Section title on a sensor's page: what these values can't do yet.") }
        static var appleSays: String { String(localized: "page.footer.appleSays", defaultValue: "Quoted from Apple's documentation. Tap to open it.", comment: "Footer under a section of Apple quotes on a sensor's page.") }
        static var infoPlistKey: String { String(localized: "page.row.infoPlistKey", defaultValue: "Info.plist key", comment: "Caption above the name of the Info.plist key whose text iOS shows in the permission prompt. Info.plist is a file name; keep it.") }
    }

    // MARK: - Air check tab

    enum AirCheck {
        static var tab: String { String(localized: "airCheck.tab", defaultValue: "Air check", comment: "Tab title: comparing the phone's air pressure with the area's weather.") }
        static var navigationTitle: String { String(localized: "airCheck.navigationTitle", defaultValue: "Air check", comment: "Large title at the top of the Air check tab.") }
        static var header: String { String(localized: "airCheck.header", defaultValue: "Air check", comment: "Section title on the Air check tab.") }
        static var intro: String { String(localized: "airCheck.intro", defaultValue: "Reads this phone's air pressure and compares it with the nearest US weather station's reading, worked out for the height of your position. Two sensors and a weather service in one answer.", comment: "Footer under the Air check button explaining what a run does.") }
        static var run: String { String(localized: "airCheck.button.run", defaultValue: "Run air check", comment: "Button that starts one air check.") }
        static var running: String { String(localized: "airCheck.button.running", defaultValue: "Checking…", comment: "The button's title while a check is running.") }
        static var ranAt: String { String(localized: "airCheck.row.ranAt", defaultValue: "Last run", comment: "Row label: when the last check finished.") }
        static var motionNeeded: String { String(localized: "airCheck.motion.needed", defaultValue: "Needs Motion & Fitness for the barometer. Turn it on from the Settings tab.", comment: "Line shown when the permission the barometer needs is off.") }
        static var noFix: String { String(localized: "airCheck.result.noFix", defaultValue: "No position, so there was nothing to check against.", comment: "Shown when iOS gave no position at all.") }

        static var resultHeader: String { String(localized: "airCheck.result.header", defaultValue: "Answer", comment: "Section title above the result of a check.") }
        static var matches: String { String(localized: "airCheck.result.matches", defaultValue: "Matches the area", comment: "The measured pressure agreed with the area's weather.") }
        static var doesNotMatch: String { String(localized: "airCheck.result.doesNotMatch", defaultValue: "Doesn't match the area", comment: "The measured pressure did not agree with the area's weather.") }
        static var witnessPosition: String { String(localized: "airCheck.witness.position", defaultValue: "Position", comment: "Label on one corner of the air-check drawing: the position iOS gave.") }
        static var witnessAreaReport: String { String(localized: "airCheck.witness.areaReport", defaultValue: "Area report", comment: "Label on one corner of the air-check drawing: the weather station's reading.") }
        static var witnessBarometer: String { String(localized: "airCheck.witness.barometer", defaultValue: "Barometer", comment: "Label on one corner of the air-check drawing: this phone's own pressure reading.") }
        static var hatCaption: String { String(localized: "airCheck.hat.caption", defaultValue: "The ring is the allowance and the triangle is the disagreement. Inside the ring the three witnesses agree; touching it means the disagreement is exactly the allowance.", comment: "Caption under the air-check drawing, explaining what the ring and triangle mean.") }

        static var confidence: String { String(localized: "airCheck.row.confidence", defaultValue: "Confidence", comment: "Row label: how good the position was that the answer rests on.") }
        static var confidenceHigh: String { String(localized: "airCheck.confidence.high", defaultValue: "High", comment: "Confidence: the position was precise enough.") }
        static var confidenceMedium: String { String(localized: "airCheck.confidence.medium", defaultValue: "Medium", comment: "Confidence: the position was wider, so the answer rests on less.") }
        static var notAVerdict: String { String(localized: "airCheck.result.notAVerdict", defaultValue: "A mismatch is not proof of anything. Weather moves, and a rough position moves the expected pressure with it.", comment: "Footer under the answer, making clear it is evidence and not a judgement.") }

        static var measuredHeader: String { String(localized: "airCheck.measured.header", defaultValue: "The numbers", comment: "Section title above the measured and expected pressures.") }
        static var measured: String { String(localized: "airCheck.row.measured", defaultValue: "Measured here", comment: "Row label: the pressure this phone's barometer read.") }
        static var expected: String { String(localized: "airCheck.row.expected", defaultValue: "Expected here", comment: "Row label: the pressure the area's weather implies at your height.") }
        static var difference: String { String(localized: "airCheck.row.difference", defaultValue: "Difference", comment: "Row label: how far apart the two pressures are.") }
        static var allowed: String { String(localized: "airCheck.row.allowed", defaultValue: "Allowed", comment: "Row label: how far apart they may be and still match.") }
        static var allowedNote: String { String(localized: "airCheck.note.allowed", defaultValue: "The allowance is worked out from how precise the height was, how uncertain the air temperature is, and the weather's own pressure uncertainty.", comment: "Footer explaining where the allowance comes from.") }

        static var placeHeader: String { String(localized: "airCheck.place.header", defaultValue: "Where and when", comment: "Section title above the position the check used.") }
        static var altitude: String { String(localized: "airCheck.row.altitude", defaultValue: "Height", comment: "Row label: the altitude of the position used.") }
        static var verticalAccuracy: String { String(localized: "airCheck.row.verticalAccuracy", defaultValue: "Height could be off by", comment: "Row label: the vertical accuracy of the position.") }
        static var horizontalAccuracy: String { String(localized: "airCheck.row.horizontalAccuracy", defaultValue: "Position could be off by", comment: "Row label: the horizontal accuracy of the position.") }
        static var pressureReadAt: String { String(localized: "airCheck.row.pressureReadAt", defaultValue: "Pressure read", comment: "Row label: when the barometer reading was taken.") }
        static var scaleHeight: String { String(localized: "airCheck.row.scaleHeight", defaultValue: "Air column", comment: "Row label: the scale height, the height over which pressure falls by a set fraction.") }

        static var weatherHeader: String { String(localized: "airCheck.weather.header", defaultValue: "Area weather", comment: "Section title above what the weather service reported.") }
        static var seaLevel: String { String(localized: "airCheck.row.seaLevel", defaultValue: "At sea level", comment: "Row label: the area's pressure reduced to sea level.") }
        static var temperature: String { String(localized: "airCheck.row.temperature", defaultValue: "Temperature", comment: "Row label: the area's air temperature.") }
        static var humidity: String { String(localized: "airCheck.row.humidity", defaultValue: "Humidity", comment: "Row label: the area's relative humidity, in percent.") }
        static var fetchedAt: String { String(localized: "airCheck.row.fetchedAt", defaultValue: "Fetched", comment: "Row label: when the weather was fetched.") }
        static var reportedAt: String { String(localized: "airCheck.row.reportedAt", defaultValue: "Weather measured", comment: "Row label: when the weather service says its reading was taken.") }
        static var station: String { String(localized: "airCheck.row.station", defaultValue: "Station", comment: "Row label: the weather station the reading came from.") }
        static var stationDistance: String { String(localized: "airCheck.row.stationDistance", defaultValue: "Station distance", comment: "Row label: how far away that weather station is.") }
        static var stationHeight: String { String(localized: "airCheck.row.stationHeight", defaultValue: "Station height", comment: "Row label: the station's height above sea level, which the comparison uses.") }
        static var quality: String { String(localized: "airCheck.row.quality", defaultValue: "Quality check", comment: "Row label: the quality flag the weather service put on its pressure reading.") }
        static var source: String { String(localized: "airCheck.row.source", defaultValue: "Source", comment: "Row label: which weather service the reading came from.") }
        static var sourceNWS: String { String(localized: "airCheck.source.nws", defaultValue: "US National Weather Service", comment: "The weather source. Keep the service's own name.") }
        static var calibration: String { String(localized: "airCheck.row.calibration", defaultValue: "Calibration", comment: "Row label: which version of the comparison's constants was used.") }

        /// The typed reasons the package gives for having no answer.
        static func words(_ reason: AirCheckUnavailability) -> String {
            switch reason {
            case .cancelled: String(localized: "airCheck.absence.cancelled", defaultValue: "The check stopped before it finished.", comment: "No answer: the run was cancelled, e.g. the app left the screen.")
            case .timedOut: String(localized: "airCheck.absence.timedOut", defaultValue: "The check ran out of time.", comment: "No answer: it took too long.")
            case .pressureUnavailable: String(localized: "airCheck.absence.pressureUnavailable", defaultValue: "No barometer reading. The phone may have no barometer, or Motion & Fitness is off.", comment: "No answer: no pressure reading arrived.")
            case .weatherMissingInputs: String(localized: "airCheck.absence.weatherMissingInputs", defaultValue: "The selected station did not supply the measurements needed for this check.", comment: "Weather acquisition failure.")
            case .weatherStaleObservation: String(localized: "airCheck.absence.weatherStaleObservation", defaultValue: "The selected station’s observation is too old.", comment: "Weather acquisition failure.")
            case .weatherAmbiguousPressureType: String(localized: "airCheck.absence.weatherAmbiguousPressureType", defaultValue: "The station’s pressure type could not be established.", comment: "Weather acquisition failure.")
            case .weatherProviderFailure: String(localized: "airCheck.absence.weatherProviderFailure", defaultValue: "The weather service request failed. Try again.", comment: "Weather acquisition failure.")
            case .weatherRateLimited: String(localized: "airCheck.absence.weatherRateLimited", defaultValue: "The weather service asked us to wait before trying again.", comment: "Weather acquisition failure.")
            case .weatherUnavailable: String(localized: "airCheck.absence.weatherUnavailable", defaultValue: "No weather for this area. No nearby US weather station reported a recent sea-level pressure, or the service didn't answer.", comment: "No answer: the US National Weather Service gave nothing usable.")
            case .simulatedLocation: String(localized: "airCheck.absence.simulatedLocation", defaultValue: "The position is simulated, so there is nothing real to compare.", comment: "No answer: the location came from a simulator or a location spoof.")
            case .invalidLocation: String(localized: "airCheck.absence.invalidLocation", defaultValue: "The position was too rough or too odd to compare against.", comment: "No answer: the fix failed the package's admission rules.")
            case .invalidPressure: String(localized: "airCheck.absence.invalidPressure", defaultValue: "The pressure reading was outside any sensible range.", comment: "No answer: the barometer value was not usable.")
            case .invalidWeather: String(localized: "airCheck.absence.invalidWeather", defaultValue: "The weather reading was outside any sensible range.", comment: "No answer: the weather value was not usable.")
            case .pressureOutsideWindow: String(localized: "airCheck.absence.pressureOutsideWindow", defaultValue: "The pressure and the position were taken too far apart in time.", comment: "No answer: the two readings did not belong to the same moment.")
            case .weatherOutsideWindow: String(localized: "airCheck.absence.weatherOutsideWindow", defaultValue: "The weather and the position were taken too far apart in time.", comment: "No answer: the weather was too old for the position.")
            }
        }
    }
}
