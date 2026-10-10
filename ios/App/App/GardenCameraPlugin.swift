import AVFoundation
import Capacitor
import CoreMotion
import ImageIO
import PhotosUI
import UIKit
import UniformTypeIdentifiers

func gardenCameraDirectory() throws -> URL {
    let root = try FileManager.default.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
    )
    let dir = root.appendingPathComponent("GardenCamera", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

@objc(GardenCameraPlugin)
public class GardenCameraPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GardenCameraPlugin"
    public let jsName = "GardenCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
        call.resolve(["available": device != nil])
    }

    @objc func capture(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("The camera has nowhere to appear.")
                return
            }
            let camera = GardenCameraViewController()
            camera.modalPresentationStyle = .fullScreen
            camera.onFinished = { result in
                presenter.dismiss(animated: true) {
                    switch result {
                    case .cancelled:
                        call.reject("cancelled", "USER_CANCELLED")
                    case .failed(let message):
                        call.reject(message)
                    case .photo(let payload):
                        call.resolve(payload)
                    }
                }
            }
            presenter.present(camera, animated: true)
        }
    }

    /// Deletes a file this plugin wrote, after the web layer has read the bytes.
    @objc func release(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.resolve()
            return
        }
        do {
            let root = try gardenCameraDirectory().standardizedFileURL
            let file = URL(fileURLWithPath: path).standardizedFileURL
            if file.path.hasPrefix(root.path + "/") {
                try? FileManager.default.removeItem(at: file)
            }
        } catch {
            /* The upload already has the bytes. */
        }
        call.resolve()
    }
}

fileprivate enum CameraFinish {
    case cancelled
    case failed(String)
    case photo([String: Any])
}

final class GardenCameraViewController: UIViewController, AVCapturePhotoCaptureDelegate, PHPickerViewControllerDelegate {
    fileprivate var onFinished: ((CameraFinish) -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "garden.camera.session")
    private let photoOutput = AVCapturePhotoOutput()
    private let previewLayer = AVCaptureVideoPreviewLayer()
    private var device: AVCaptureDevice?
    private var focusObservation: NSKeyValueObservation?
    private let motion = CMMotionManager()
    private let motionQueue = OperationQueue()
    private let motionBuffer = MotionBuffer()

    private var focusLocked = false
    private var exposureLocked = false
    private var lockedLensPosition: Float?
    private var tapInProgress = false
    private var captureWhenSettled = false
    private var applyingLock = false
    private var busy = false
    private var configuredZoom: CGFloat = 1
    private var pendingExt = "jpg"
    private var pendingMime = "image/jpeg"
    /// One coordinator for this device and preview. Creating a new one per frame
    /// reads the angle before the coordinator has tracked the phone.
    private var horizonRotation: AnyObject?
    private weak var horizonRotationDevice: AVCaptureDevice?

    private let hint = UILabel()
    private let shutter = UIButton(type: .custom)
    private let cancelButton = UIButton(type: .system)
    private let libraryButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.session = session
        view.layer.addSublayer(previewLayer)

        hint.text = "Tap the stick, then the shutter. Focus and exposure lock on that tap."
        hint.textColor = .white
        hint.numberOfLines = 0
        hint.font = .preferredFont(forTextStyle: .body)
        hint.textAlignment = .center
        view.addSubview(hint)

        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.tintColor = .white
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancelButton)

        libraryButton.setTitle("Library", for: .normal)
        libraryButton.tintColor = .white
        libraryButton.addTarget(self, action: #selector(libraryTapped), for: .touchUpInside)
        view.addSubview(libraryButton)

        shutter.backgroundColor = .white
        shutter.accessibilityLabel = "Take survey photo"
        shutter.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
        view.addSubview(shutter)

        let tap = UITapGestureRecognizer(target: self, action: #selector(previewTapped(_:)))
        view.addGestureRecognizer(tap)
        motionQueue.maxConcurrentOperationCount = 1
        requestCamera()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer.frame = view.bounds
        let safe = view.safeAreaInsets
        let barY = view.bounds.height - safe.bottom - 92
        cancelButton.frame = CGRect(x: 16, y: barY, width: 88, height: 44)
        libraryButton.frame = CGRect(x: view.bounds.width - 104, y: barY, width: 88, height: 44)
        shutter.frame = CGRect(x: (view.bounds.width - 68) / 2, y: barY - 8, width: 68, height: 68)
        shutter.layer.cornerRadius = 34
        hint.frame = CGRect(x: 20, y: safe.top + 12, width: view.bounds.width - 40, height: 72)
        updatePreviewOrientation()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        focusObservation?.invalidate()
        motion.stopDeviceMotionUpdates()
        sessionQueue.async { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    private func requestCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.configureSession() }
                    else { self?.finish(.failed("Camera permission is off. Allow it in Settings, then try again.")) }
                }
            }
        default:
            finish(.failed("Camera permission is off. Allow it in Settings, then try again."))
        }
    }

    private func configureSession() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .photo
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
                self.session.commitConfiguration()
                self.finish(.failed("This phone has no wide back camera."))
                return
            }
            self.device = device
            do {
                let input = try AVCaptureDeviceInput(device: device)
                guard self.session.canAddInput(input), self.session.canAddOutput(self.photoOutput) else {
                    self.session.commitConfiguration()
                    self.finish(.failed("The camera session could not start."))
                    return
                }
                self.session.addInput(input)
                self.session.addOutput(self.photoOutput)
                // `.speed` keeps Smart HDR / Deep Fusion from blending the still.
                // The settings used at capture must not ask for a higher quality than this.
                self.photoOutput.maxPhotoQualityPrioritization = .speed
                if self.photoOutput.isContentAwareDistortionCorrectionSupported {
                    self.photoOutput.isContentAwareDistortionCorrectionEnabled = false
                }
                try device.lockForConfiguration()
                let zoom = min(max(1, device.minAvailableVideoZoomFactor), device.maxAvailableVideoZoomFactor)
                device.videoZoomFactor = zoom
                self.configuredZoom = zoom
                if device.isGeometricDistortionCorrectionSupported {
                    device.isGeometricDistortionCorrectionEnabled = false
                }
                if device.isFocusModeSupported(.continuousAutoFocus) {
                    device.focusMode = .continuousAutoFocus
                }
                if device.isExposureModeSupported(.continuousAutoExposure) {
                    device.exposureMode = .continuousAutoExposure
                }
                device.unlockForConfiguration()
                self.session.commitConfiguration()
                // The .photo preset is applied only after commit. supportedMaxPhotoDimensions
                // before that is the previous format, so the still size is chosen here.
                if #available(iOS 16.0, *) {
                    if let dims = self.preferredPhotoDimensions(on: device) {
                        self.photoOutput.maxPhotoDimensions = dims
                    }
                }
                self.session.startRunning()
                DispatchQueue.main.async {
                    self.observeFocus(device)
                    self.startMotion()
                    self.updatePreviewOrientation()
                }
            } catch {
                self.session.commitConfiguration()
                self.finish(.failed("The camera did not start."))
            }
        }
    }

    private func observeFocus(_ device: AVCaptureDevice) {
        focusObservation = device.observe(\.isAdjustingFocus, options: [.new]) { [weak self] device, _ in
            self?.sessionQueue.async {
                guard let self, !self.applyingLock, self.tapInProgress, !device.isAdjustingFocus else { return }
                self.tapInProgress = false
                self.lockNow()
                if self.captureWhenSettled {
                    self.captureWhenSettled = false
                    self.shoot()
                }
            }
        }
    }

    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 0.01
        motion.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical, to: motionQueue) { [weak self] sample, _ in
            guard let sample else { return }
            self?.motionBuffer.add(sample)
        }
    }

    /// The same coordinator serves the preview and the still. A new device gets a new one.
    /// Only call this on `sessionQueue`. The preview and the shutter both read it there.
    @available(iOS 17.0, *)
    private func horizonCoordinator(for device: AVCaptureDevice) -> AVCaptureDevice.RotationCoordinator {
        if horizonRotationDevice === device, let existing = horizonRotation as? AVCaptureDevice.RotationCoordinator {
            return existing
        }
        let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: previewLayer)
        horizonRotation = coordinator
        horizonRotationDevice = device
        return coordinator
    }

    private func updatePreviewOrientation() {
        let fallback = fallbackVideoOrientation()
        sessionQueue.async { [weak self] in
            guard let self else { return }
            var angle: CGFloat?
            if #available(iOS 17.0, *), let device = self.device {
                angle = self.horizonCoordinator(for: device).videoRotationAngleForHorizonLevelPreview
            }
            DispatchQueue.main.async { [weak self] in
                self?.applyPreviewRotation(angle: angle, fallback: fallback)
            }
        }
    }

    private func applyPreviewRotation(angle: CGFloat?, fallback: AVCaptureVideoOrientation) {
        guard let connection = previewLayer.connection else { return }
        if #available(iOS 17.0, *), let angle, connection.isVideoRotationAngleSupported(angle) {
            connection.videoRotationAngle = angle
        } else if connection.isVideoOrientationSupported {
            connection.videoOrientation = fallback
        }
    }

    /// EXIF orientation follows the phone, not a hardcoded portrait preview.
    /// `shoot()` calls this on `sessionQueue`, which is the only queue that touches the coordinator.
    private func applyPhotoConnectionRotation() {
        guard let connection = photoOutput.connection(with: .video) else { return }
        if #available(iOS 17.0, *), let device {
            let angle = horizonCoordinator(for: device).videoRotationAngleForHorizonLevelCapture
            if connection.isVideoRotationAngleSupported(angle) {
                connection.videoRotationAngle = angle
            }
        } else if connection.isVideoOrientationSupported {
            connection.videoOrientation = fallbackVideoOrientation()
        }
    }

    /// UIDevice landscape left/right are swapped relative to AVCaptureVideoOrientation.
    private func fallbackVideoOrientation() -> AVCaptureVideoOrientation {
        switch UIDevice.current.orientation {
        case .landscapeLeft:
            return .landscapeRight
        case .landscapeRight:
            return .landscapeLeft
        case .portraitUpsideDown:
            return .portraitUpsideDown
        default:
            return .portrait
        }
    }

    @objc private func previewTapped(_ gesture: UITapGestureRecognizer) {
        let point = previewLayer.captureDevicePointConverted(fromLayerPoint: gesture.location(in: view))
        sessionQueue.async { [weak self] in
            self?.focus(at: point)
        }
    }

    private func focus(at point: CGPoint) {
        guard let device else { return }
        tapInProgress = true
        focusLocked = false
        exposureLocked = false
        do {
            try device.lockForConfiguration()
            if device.isFocusPointOfInterestSupported {
                device.focusPointOfInterest = point
            }
            if device.isExposurePointOfInterestSupported {
                device.exposurePointOfInterest = point
            }
            if device.isFocusModeSupported(.autoFocus) {
                device.focusMode = .autoFocus
            }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            device.unlockForConfiguration()
        } catch {
            tapInProgress = false
        }
        sessionQueue.asyncAfter(deadline: .now() + 0.45) { [weak self] in
            guard let self, self.tapInProgress, let device = self.device, !device.isAdjustingFocus else { return }
            self.tapInProgress = false
            self.lockNow()
            if self.captureWhenSettled {
                self.captureWhenSettled = false
                self.shoot()
            }
        }
    }

    @objc private func shutterTapped() {
        sessionQueue.async { [weak self] in
            guard let self, !self.busy else { return }
            if self.focusLocked || !self.tapInProgress {
                self.lockNow()
                self.shoot()
            } else {
                self.captureWhenSettled = true
                self.sessionQueue.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                    guard let self, self.captureWhenSettled else { return }
                    self.captureWhenSettled = false
                    self.tapInProgress = false
                    self.lockNow()
                    self.shoot()
                }
            }
        }
    }

    private func lockNow() {
        guard !focusLocked, let device else { return }
        applyingLock = true
        defer { applyingLock = false }
        do {
            try device.lockForConfiguration()
            let position = device.lensPosition
            if device.isFocusModeSupported(.locked) {
                device.setFocusModeLocked(lensPosition: position, completionHandler: nil)
                lockedLensPosition = position
                focusLocked = true
            }
            if device.isExposureModeSupported(.locked) {
                device.exposureMode = .locked
                exposureLocked = true
            }
            device.unlockForConfiguration()
        } catch {
            /* The still is still the camera file if capture proceeds. */
        }
    }

    private func shoot() {
        guard !busy else { return }
        busy = true
        let settings: AVCapturePhotoSettings
        if photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
            settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            pendingExt = "jpg"
            pendingMime = "image/jpeg"
        } else if photoOutput.availablePhotoCodecTypes.contains(.hevc) {
            settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
            pendingExt = "heic"
            pendingMime = "image/heic"
        } else {
            settings = AVCapturePhotoSettings()
            pendingExt = "jpg"
            pendingMime = "image/jpeg"
        }
        settings.photoQualityPrioritization = .speed
        settings.isAutoRedEyeReductionEnabled = false
        if photoOutput.supportedFlashModes.contains(.off) {
            settings.flashMode = .off
        }
        if #available(iOS 16.0, *) {
            let dims = photoOutput.maxPhotoDimensions
            if dims.width > 0 && dims.height > 0 {
                settings.maxPhotoDimensions = dims
            }
        }
        applyPhotoConnectionRotation()
        photoOutput.capturePhoto(with: settings, delegate: self)
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error {
            finish(.failed(error.localizedDescription))
            return
        }
        guard let data = photo.fileDataRepresentation() else {
            finish(.failed("The camera did not return a file."))
            return
        }
        do {
            let url = try write(data, ext: pendingExt)
            let exif = imageFacts(at: url)
            let motionSample = motionBuffer.sample(at: hostSeconds(for: photo))
            let matrix = intrinsicMatrix(of: photo)
            var payload: [String: Any] = [
                "path": url.path,
                "fileName": url.lastPathComponent,
                "mimeType": pendingMime,
                "byteSize": data.count,
                "source": "shutter",
                "deviceType": AVCaptureDevice.DeviceType.builtInWideAngleCamera.rawValue,
                "videoZoomFactor": Double(configuredZoom),
                "focusLocked": focusLocked,
                "exposureLocked": exposureLocked,
                "photoQualityPrioritization": "speed",
                "autoRedEyeReductionEnabled": false,
                "motionInterpolated": motionSample?.interpolated ?? false,
            ]
            if #available(iOS 16.0, *) {
                let dims = photoOutput.maxPhotoDimensions
                if dims.width > 0 && dims.height > 0 {
                    payload["requestedWidth"] = Int(dims.width)
                    payload["requestedHeight"] = Int(dims.height)
                }
            }
            if let lockedLensPosition {
                payload["lensPosition"] = Double(lockedLensPosition)
            }
            if let device {
                payload["geometricDistortionCorrectionSupported"] = device.isGeometricDistortionCorrectionSupported
                payload["geometricDistortionCorrectionEnabled"] = device.isGeometricDistortionCorrectionEnabled
            }
            payload["contentAwareDistortionCorrectionSupported"] = output.isContentAwareDistortionCorrectionSupported
            payload["contentAwareDistortionCorrectionEnabled"] = output.isContentAwareDistortionCorrectionEnabled
            if let connection = output.connection(with: .video) {
                payload["stabilization"] = stabilizationName(connection.activeVideoStabilizationMode)
            }
            payload.merge(exif) { _, new in new }
            if let matrix {
                payload["intrinsicMatrix"] = matrix.values
                payload["intrinsicReferenceWidth"] = matrix.width
                payload["intrinsicReferenceHeight"] = matrix.height
            }
            if let motionSample {
                payload["gravityX"] = motionSample.x
                payload["gravityY"] = motionSample.y
                payload["gravityZ"] = motionSample.z
            }
            finish(.photo(payload))
        } catch {
            finish(.failed("The camera file could not be saved."))
        }
    }

    @objc private func cancelTapped() {
        finish(.cancelled)
    }

    @objc private func libraryTapped() {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider else { return }
        let types = provider.registeredTypeIdentifiers
        if types.contains(UTType.rawImage.identifier)
            && !types.contains(UTType.jpeg.identifier)
            && !types.contains(UTType.heic.identifier) {
            finish(.failed("DNG and ProRAW are not survey photos. Shoot JPEG or HEIC."))
            return
        }
        let type = types.first { $0 == UTType.heic.identifier || $0 == UTType.jpeg.identifier } ?? UTType.image.identifier
        provider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, error in
            guard let self else { return }
            if let error {
                self.finish(.failed(error.localizedDescription))
                return
            }
            guard let url else {
                self.finish(.failed("The library did not return a file."))
                return
            }
            do {
                let ext = self.ext(for: type, url: url)
                let data = try Data(contentsOf: url)
                let stored = try self.write(data, ext: ext)
                var payload = self.imageFacts(at: stored)
                payload["path"] = stored.path
                payload["fileName"] = stored.lastPathComponent
                payload["mimeType"] = ext == "heic" ? "image/heic" : "image/jpeg"
                payload["byteSize"] = data.count
                payload["source"] = "library"
                payload["deviceType"] = "photo-library"
                payload["focusLocked"] = false
                payload["exposureLocked"] = false
                payload["motionInterpolated"] = false
                self.finish(.photo(payload))
            } catch {
                self.finish(.failed("The library file could not be saved."))
            }
        }
    }

    private func write(_ data: Data, ext: String) throws -> URL {
        let url = try gardenCameraDirectory()
            .appendingPathComponent("GP-\(UUID().uuidString)")
            .appendingPathExtension(ext)
        try data.write(to: url, options: .atomic)
        return url
    }

    private func ext(for type: String, url: URL) -> String {
        if type == UTType.heic.identifier || url.pathExtension.lowercased() == "heic" { return "heic" }
        if url.pathExtension.lowercased() == "heif" { return "heic" }
        return "jpg"
    }

    private func imageFacts(at url: URL) -> [String: Any] {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return [:] }
        var facts: [String: Any] = [:]
        if let width = props[kCGImagePropertyPixelWidth] as? NSNumber { facts["width"] = width.intValue }
        if let height = props[kCGImagePropertyPixelHeight] as? NSNumber { facts["height"] = height.intValue }
        if let orientation = props[kCGImagePropertyOrientation] as? NSNumber { facts["orientation"] = orientation.intValue }
        let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any]
        if let focal = exif?[kCGImagePropertyExifFocalLength] as? NSNumber { facts["focalLengthMm"] = focal.doubleValue }
        if let eq = exif?[kCGImagePropertyExifFocalLenIn35mmFilm] as? NSNumber { facts["focalLength35mm"] = eq.intValue }
        if let lens = exif?[kCGImagePropertyExifLensModel] as? String { facts["lensModel"] = lens }
        return facts
    }

    private func intrinsicMatrix(of photo: AVCapturePhoto) -> (values: [Double], width: Int, height: Int)? {
        guard let cal = photo.cameraCalibrationData else { return nil }
        let m = cal.intrinsicMatrix
        let values = [
            Double(m.columns.0.x), Double(m.columns.0.y), Double(m.columns.0.z),
            Double(m.columns.1.x), Double(m.columns.1.y), Double(m.columns.1.z),
            Double(m.columns.2.x), Double(m.columns.2.y), Double(m.columns.2.z),
        ]
        let size = cal.intrinsicMatrixReferenceDimensions
        return (values, Int(size.width), Int(size.height))
    }

    /// 4032×3024 when that format is offered, otherwise the largest still the active format allows.
    @available(iOS 16.0, *)
    private func preferredPhotoDimensions(on device: AVCaptureDevice) -> CMVideoDimensions? {
        var match: CMVideoDimensions?
        var largest: CMVideoDimensions?
        var largestArea = 0
        for dims in device.activeFormat.supportedMaxPhotoDimensions {
            let area = Int(dims.width) * Int(dims.height)
            if area > largestArea {
                largestArea = area
                largest = dims
            }
            if dims.width == 4032 && dims.height == 3024 {
                match = dims
            }
        }
        return match ?? largest
    }

    private func hostSeconds(for photo: AVCapturePhoto) -> TimeInterval? {
        if #available(iOS 15.4, *) {
            guard let clock = session.synchronizationClock else { return nil }
            let host = CMSyncConvertTime(photo.timestamp, from: clock, to: CMClockGetHostTimeClock())
            guard host.isValid else { return nil }
            let seconds = CMTimeGetSeconds(host)
            return seconds.isFinite ? seconds : nil
        }
        return nil
    }

    private func stabilizationName(_ mode: AVCaptureVideoStabilizationMode) -> String {
        switch mode {
        case .off: return "off"
        case .standard: return "standard"
        case .cinematic: return "cinematic"
        case .cinematicExtended: return "cinematicExtended"
        case .auto: return "auto"
        default: return "other"
        }
    }

    private func finish(_ result: CameraFinish) {
        guard let callback = onFinished else { return }
        onFinished = nil
        focusObservation?.invalidate()
        motion.stopDeviceMotionUpdates()
        sessionQueue.async { [session] in
            if session.isRunning { session.stopRunning() }
            DispatchQueue.main.async { callback(result) }
        }
    }
}

private final class MotionBuffer {
    private let lock = NSLock()
    private var samples: [(t: TimeInterval, x: Double, y: Double, z: Double)] = []

    func add(_ motion: CMDeviceMotion) {
        lock.lock()
        samples.append((motion.timestamp, motion.gravity.x, motion.gravity.y, motion.gravity.z))
        let cutoff = motion.timestamp - 2
        samples.removeAll { $0.t < cutoff }
        lock.unlock()
    }

    func sample(at time: TimeInterval?) -> (x: Double, y: Double, z: Double, interpolated: Bool)? {
        lock.lock()
        defer { lock.unlock() }
        guard let last = samples.last else { return nil }
        guard let time else { return (last.x, last.y, last.z, false) }
        if time <= samples[0].t {
            let s = samples[0]
            return (s.x, s.y, s.z, false)
        }
        if time >= last.t { return (last.x, last.y, last.z, false) }
        for index in 1..<samples.count {
            let after = samples[index]
            if time <= after.t {
                let before = samples[index - 1]
                let span = after.t - before.t
                let u = span > 0 ? (time - before.t) / span : 0
                return (
                    before.x + (after.x - before.x) * u,
                    before.y + (after.y - before.y) * u,
                    before.z + (after.z - before.z) * u,
                    true
                )
            }
        }
        return (last.x, last.y, last.z, false)
    }
}
