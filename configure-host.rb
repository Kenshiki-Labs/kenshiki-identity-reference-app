require 'xcodeproj'
require 'fileutils'
require 'optparse'
require_relative 'configure-native-tests'
# Signing for a physical iPhone, all optional: --bundle-identifier, --development-team (automatic
# signing) and --app-attest-environment. create-host.py passes whichever it was given.
signing = {}
OptionParser.new do |options|
  options.on('--bundle-identifier ID') { |value| signing[:bundle_identifier] = value }
  options.on('--development-team TEAM') { |value| signing[:team] = value }
  options.on('--app-attest-environment ENVIRONMENT', %w[development production]) do |value|
    signing[:app_attest] = value
  end
end.parse!
host = File.expand_path(ARGV.fetch(0))
# The name under the app icon: brand.appName in locales/en.jsonc, which create-host.py passes.
app_name = ARGV.fetch(1)
project = Xcodeproj::Project.open(File.join(host, 'ios/IdentitySDKHost.xcodeproj'))
app = project.targets.find { |target| target.name == 'IdentitySDKHost' }
app.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = signing[:bundle_identifier] if signing[:bundle_identifier]
  if signing[:team]
    config.build_settings['DEVELOPMENT_TEAM'] = signing[:team]
    config.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
  end
end
FileUtils.cp(File.join(__dir__, 'AppDelegate.swift'), File.join(host, 'ios/IdentitySDKHost/AppDelegate.swift'))
info_path = File.join(host, 'ios/IdentitySDKHost/Info.plist')
info = Xcodeproj::Plist.read_from_path(info_path)
# The reference delivery uses its embedded bundle. The CLI's Metro exception must not
# travel into Release; developers can opt in through a separate Debug-only Info.plist.
transport = info['NSAppTransportSecurity'] || {}
transport.delete('NSAllowsLocalNetworking')
transport['NSAllowsArbitraryLoads'] = false
info['NSAppTransportSecurity'] = transport
info['CFBundleDisplayName'] = app_name
info['NSCameraUsageDescription'] = 'Scan your ID or passport and take a selfie when you start an identity check.'
info['NSMotionUsageDescription'] = 'Read motion and air pressure when you choose to collect sensor readings.'
info['NSLocationWhenInUseUsageDescription'] = 'Use your position and altitude when you request a location fix, local weather, or an Air Check.'
info['NSLocationAlwaysAndWhenInUseUsageDescription'] = 'Allow Always Location for continuity checks, including when the app is not in use.'
info['NSBluetoothAlwaysUsageDescription'] = 'Read Bluetooth availability when you choose to enable sensor readings. No nearby devices are scanned.'
info['NFCReaderUsageDescription'] = 'Read your passport chip when you choose to continue.'
info['com.apple.developer.nfc.readersession.iso7816.select-identifiers'] = ['A0000002471001']
# Keep an empty template purpose string out of the host.
location = 'NSLocationWhenInUseUsageDescription'
info.delete(location) if info.key?(location) && info[location].to_s.strip.empty?
Xcodeproj::Plist.write_to_path(info, info_path)
# Merge the NFC tag-reading format into the app's entitlements, keeping any entitlement already there.
entitlements_setting = app.build_configurations.first.build_settings['CODE_SIGN_ENTITLEMENTS'] ||
  'IdentitySDKHost/IdentitySDKHost.entitlements'
entitlements = File.join(host, 'ios', entitlements_setting)
granted = File.exist?(entitlements) ? Xcodeproj::Plist.read_from_path(entitlements) : {}
formats = Array(granted['com.apple.developer.nfc.readersession.formats'])
granted['com.apple.developer.nfc.readersession.formats'] = (formats + ['TAG']).uniq
# App Attest: the environment must match the server the app attests to (a production server refuses
# a development attestation).
granted['com.apple.developer.devicecheck.appattest-environment'] = signing[:app_attest] if signing[:app_attest]
Xcodeproj::Plist.write_to_path(granted, entitlements)
app.build_configurations.each { |config| config.build_settings['CODE_SIGN_ENTITLEMENTS'] = entitlements_setting }
resources = File.join(host, 'ios/CaptureResources')
if File.directory?(resources) && !project.files.any? { |ref| ref.path == 'CaptureResources' }
  ref = project.main_group.new_file('CaptureResources'); ref.last_known_file_type = 'folder'
  app.resources_build_phase.add_file_reference(ref)
end
app.build_configurations.each { |config| config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '18.0' }
# The UI tests run the Debug build: only simulator Debug offers the developer checks. Embed the
# JavaScript bundle so those tests do not depend on a running Metro server.
app.build_configurations.each { |config| config.build_settings['FORCE_BUNDLING'] = 'YES' if config.name == 'Debug' }
# Declare the generated resource so incremental builds invalidate the app's resource signature
# when JavaScript changes. The template's output-less script can leave a stale signed seal.
bundle_phase = app.shell_script_build_phases.find { |phase| phase.name == 'Bundle React Native code and images' }
raise 'React Native bundle build phase is missing' unless bundle_phase
bundle_phase.always_out_of_date = '1'
bundle_phase.output_paths |= ['$(BUILT_PRODUCTS_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/main.jsbundle']
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
device_test = File.join(host, 'ios/DeviceAcceptanceTests.swift')
FileUtils.cp(File.join(__dir__, 'DeviceAcceptanceTests.swift'), device_test)
unless project.files.any? { |ref| ref.path == 'DeviceAcceptanceTests.swift' }
  ref = project.main_group.new_file('DeviceAcceptanceTests.swift')
  tests.source_build_phase.add_file_reference(ref)
end
tests.build_configurations.each do |config|
    config.build_settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
    config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = app_id + '.ArtifactIntegrationTests'
    config.build_settings['SWIFT_VERSION'] = '6.0'
    config.build_settings['TEST_TARGET_NAME'] = 'IdentitySDKHost'
    if signing[:team]
      config.build_settings['DEVELOPMENT_TEAM'] = signing[:team]
      config.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
    end
end
# The brand, from the host's brand/ folder (create-host.py copies it there). The one Icon Composer
# source supplies the layered icon and its appearance variants, named after its folder.
brand = File.join(host, 'brand')
icons = Dir.glob(File.join(brand, '*.icon'))
raise "brand/ must hold exactly one .icon, found #{icons.length}" unless icons.length == 1
icon_name = File.basename(icons.first, '.icon')
icon_path = File.join(host, 'ios', icon_name + '.icon')
FileUtils.rm_rf(icon_path)
FileUtils.cp_r(icons.first, icon_path)
icon_ref = project.files.find { |ref| ref.path == icon_name + '.icon' }
unless icon_ref
  icon_ref = project.main_group.new_file(icon_name + '.icon')
  icon_ref.last_known_file_type = 'folder.icon'
  app.resources_build_phase.add_file_reference(icon_ref)
end
app.build_configurations.each do |config|
  config.build_settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = icon_name
end
# The launch screen replaces the template's, and the images and colors it names join the app's
# asset catalog, which the template already builds.
FileUtils.cp(File.join(brand, 'LaunchScreen.storyboard'), File.join(host, 'ios/IdentitySDKHost/LaunchScreen.storyboard'))
catalog = File.join(host, 'ios/IdentitySDKHost/Images.xcassets')
Dir.glob(File.join(brand, '*.{imageset,colorset}')).each do |asset|
  target = File.join(catalog, File.basename(asset))
  FileUtils.rm_rf(target)
  FileUtils.cp_r(asset, target)
end
configure_native_tests(project, host, app_id, signing)
project.save
scheme_path = File.join(host, 'ios/IdentitySDKHost.xcodeproj/xcshareddata/xcschemes/IdentitySDKHost.xcscheme')
scheme = Xcodeproj::XCScheme.new(scheme_path)
scheme.test_action.testables.each { |testable| testable.xml_element.remove }
scheme.add_test_target(tests)
scheme.test_action.build_configuration = 'Debug'
scheme.save_as(project.path, 'IdentitySDKHost', true)
