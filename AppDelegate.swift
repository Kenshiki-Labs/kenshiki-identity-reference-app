import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(_ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    window = UIWindow(frame: UIScreen.main.bounds)
    // The HOST chooses and locates its resources. The shipped SDK never searches Bundle.main.
    var configuration: [String: String] = [:]
    for (key, name, extensionName) in [
      ("trustAnchorsURL", "masterList", "pem"),
      ("embedderURL", "embedder", "mlmodelc"),
      ("detectorURL", "detector", "mlmodelc"),
    ] {
      configuration[key] = Bundle.main.url(forResource: name, withExtension: extensionName,
        subdirectory: "CaptureResources")?.absoluteString
    }
    factory.startReactNative(withModuleName: "IdentitySDKHost", in: window,
      initialProperties: ["configuration": configuration], launchOptions: launchOptions)
    return true
  }
}
class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? { bundleURL() }
  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
