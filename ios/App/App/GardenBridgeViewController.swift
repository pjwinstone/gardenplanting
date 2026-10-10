import Capacitor
import UIKit

/// Registers the survey camera and the system-browser Microsoft sign-in.
class GardenBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GardenCameraPlugin())
        bridge?.registerPluginInstance(GardenAuthPlugin())
    }
}
