require 'xcodeproj'
require 'fileutils'
host = File.expand_path(ARGV.fetch(0))
project = Xcodeproj::Project.open(File.join(host, 'ios/IdentitySDKHost.xcodeproj'))
app = project.targets.find { |target| target.name == 'IdentitySDKHost' }
FileUtils.cp(File.join(__dir__, 'AppDelegate.swift'), File.join(host, 'ios/IdentitySDKHost/AppDelegate.swift'))
info_path = File.join(host, 'ios/IdentitySDKHost/Info.plist')
info = Xcodeproj::Plist.read_from_path(info_path)
info['NSCameraUsageDescription'] = 'Scan your ID or passport and take a selfie when you start an identity check.'
info['NFCReaderUsageDescription'] = 'Read your passport chip when you choose to continue.'
info['com.apple.developer.nfc.readersession.iso7816.select-identifiers'] = ['A0000002471001']
Xcodeproj::Plist.write_to_path(info, info_path)
entitlements = File.join(host, 'ios/IdentitySDKHost/IdentitySDKHost.entitlements')
Xcodeproj::Plist.write_to_path({'com.apple.developer.nfc.readersession.formats' => ['TAG']}, entitlements)
app.build_configurations.each { |config| config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'IdentitySDKHost/IdentitySDKHost.entitlements' }
resources = File.join(host, 'ios/CaptureResources')
if File.directory?(resources) && !project.files.any? { |ref| ref.path == 'CaptureResources' }
  ref = project.main_group.new_file('CaptureResources'); ref.last_known_file_type = 'folder'
  app.resources_build_phase.add_file_reference(ref)
end
app.build_configurations.each { |config| config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '18.0' }
# The UI tests run the Debug build: only simulator Debug offers the developer checks. Embed the
# JavaScript bundle so those tests do not depend on a running Metro server.
app.build_configurations.each { |config| config.build_settings['FORCE_BUNDLING'] = 'YES' if config.name == 'Debug' }
# The UI-test bundle identifier follows the app's own identifier, so it stays in whatever App ID
# namespace the adopting team signs the app with. Rerun this script after changing the app's ID.
app_name = app.build_configurations.first.build_settings['PRODUCT_NAME'] || app.name
app_id = app.build_configurations.first.build_settings['PRODUCT_BUNDLE_IDENTIFIER']
  .gsub('$(PRODUCT_NAME:rfc1034identifier)', app_name.gsub('$(TARGET_NAME)', app.name).gsub(/[^A-Za-z0-9.-]/, '-'))
tests = project.targets.find { |target| target.name == 'ArtifactIntegrationTests' }
unless tests
  tests = project.new_target(:ui_test_bundle, 'ArtifactIntegrationTests', :ios, '18.0')
  tests.add_dependency(app)
  source = File.join(host, 'ios/ArtifactIntegrationTests.swift')
  FileUtils.cp(File.join(__dir__, 'ArtifactIntegrationTests.swift'), source)
  ref = project.main_group.new_file('ArtifactIntegrationTests.swift')
  tests.source_build_phase.add_file_reference(ref)
end
FileUtils.cp(File.join(__dir__, 'ArtifactIntegrationTests.swift'), File.join(host, 'ios/ArtifactIntegrationTests.swift'))
tests.build_configurations.each do |config|
    config.build_settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
    config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = app_id + '.ArtifactIntegrationTests'
    config.build_settings['SWIFT_VERSION'] = '6.0'
    config.build_settings['TEST_TARGET_NAME'] = 'IdentitySDKHost'
end
project.save
scheme_path = File.join(host, 'ios/IdentitySDKHost.xcodeproj/xcshareddata/xcschemes/IdentitySDKHost.xcscheme')
scheme = Xcodeproj::XCScheme.new(scheme_path)
scheme.test_action.testables.each { |testable| testable.xml_element.remove }
scheme.add_test_target(tests)
scheme.test_action.build_configuration = 'Debug'
scheme.save_as(project.path, 'IdentitySDKHost', true)
