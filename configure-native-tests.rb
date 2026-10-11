require 'xcodeproj'
require 'fileutils'
require 'open3'

# A separate UIKit host executes only the delivered public native API. It has no React startup,
# service registration, camera, sensor collection or source-package dependencies.
def configure_native_tests(project, host, app_id, signing)
  group = project.main_group
  native = project.targets.find { |target| target.name == 'ArtifactNativeTestHost' } ||
    project.new_target(:application, 'ArtifactNativeTestHost', :ios, '18.0')
  tests = project.targets.find { |target| target.name == 'ArtifactNativeTests' } ||
    project.new_target(:unit_test_bundle, 'ArtifactNativeTests', :ios, '18.0')
  tests.add_dependency(native) unless tests.dependencies.any? { |dependency| dependency.target == native }
  [[native, 'NativeArtifactTestHost.swift'], [tests, 'ArtifactNativeTests.swift']].each do |target, name|
    FileUtils.cp(File.join(__dir__, name), File.join(host, 'ios', name))
    ref = project.files.find { |file| file.path == name } || group.new_file(name)
    target.source_build_phase.add_file_reference(ref, true)
    target.build_configurations.each do |configuration|
      values = configuration.build_settings
      values['PRODUCT_NAME'] = '$(TARGET_NAME)'
      values['PRODUCT_BUNDLE_IDENTIFIER'] = app_id + '.' + target.name
      values['GENERATE_INFOPLIST_FILE'] = 'YES'
      values['SWIFT_VERSION'] = '6.0'
      values['IPHONEOS_DEPLOYMENT_TARGET'] = '18.0'
      values['TARGETED_DEVICE_FAMILY'] = '1,2'
      values['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks']
      if signing[:team]
        values['DEVELOPMENT_TEAM'] = signing[:team]
        values['CODE_SIGN_STYLE'] = 'Automatic'
      end
    end
  end
  native.build_configurations.each do |configuration|
    configuration.build_settings['INFOPLIST_KEY_UILaunchScreen_Generation'] = 'YES'
  end
  tests.build_configurations.each do |configuration|
    configuration.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/ArtifactNativeTestHost.app/ArtifactNativeTestHost'
    configuration.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'
  end
  embed = native.copy_files_build_phases.find { |phase| phase.name == 'Embed installed SDK frameworks' } ||
    native.new_copy_files_build_phase('Embed installed SDK frameworks')
  embed.dst_subfolder_spec = '10'
  frameworks = Dir.glob(File.join(host, 'node_modules/@kenshiki/identity-capture/Frameworks/*.xcframework')).sort
  raise 'The installed binary SDK has no XCFrameworks' if frameworks.empty?
  frameworks.each do |framework|
    relative = '../' + framework.delete_prefix(host + '/')
    ref = project.files.find { |file| file.path == relative } || group.new_file(relative)
    ref.last_known_file_type = 'wrapper.xcframework'
    tests.frameworks_build_phase.add_file_reference(ref, true)
    # Static archives link into the test bundle; only dynamic frameworks belong in the host.
    # Check every slice so device and simulator cannot silently disagree about linkage.
    info = Xcodeproj::Plist.read_from_path(File.join(framework, 'Info.plist'))
    kinds = info.fetch('AvailableLibraries').map do |library|
      path = File.join(framework, library.fetch('LibraryIdentifier'), library.fetch('LibraryPath'))
      path = File.join(path, File.basename(path, '.framework')) if path.end_with?('.framework')
      kind, status = Open3.capture2('/usr/bin/file', '-b', path)
      raise 'Cannot inspect installed framework linkage: ' + path unless status.success?
      if kind.include?('dynamically linked shared library')
        :dynamic
      elsif kind.include?('ar archive') || kind.include?('static library')
        :static
      else
        raise 'Unsupported installed framework linkage: ' + path
      end
    end.uniq
    raise 'Installed framework slices disagree about linkage: ' + framework unless kinds.length == 1
    next unless kinds.first == :dynamic
    native.frameworks_build_phase.add_file_reference(ref, true)
    file = embed.add_file_reference(ref, true)
    file.settings = { 'ATTRIBUTES' => ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] }
  end
  scheme = Xcodeproj::XCScheme.new
  scheme.add_build_target(native)
  scheme.set_launch_target(native)
  scheme.add_test_target(tests)
  scheme.test_action.build_configuration = 'Debug'
  scheme.save_as(project.path, 'ArtifactNative', true)
end
