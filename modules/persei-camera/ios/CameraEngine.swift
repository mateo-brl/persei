import AVFoundation
import Foundation

enum CameraEngineError: Error, LocalizedError {
  case deviceUnavailable
  case notRunning
  case captureFailed(String)

  var errorDescription: String? {
    switch self {
    case .deviceUnavailable: return "Camera device unavailable"
    case .notRunning: return "Camera session is not running"
    case .captureFailed(let reason): return "Capture failed: \(reason)"
    }
  }
}

/// Owns the AVCaptureSession and exposes full manual control over the camera:
/// custom exposure (ISO + shutter duration), manual lens position, white
/// balance in kelvin, lens switching, and RAW/ProRAW capture.
final class CameraEngine: NSObject {
  static let shared = CameraEngine()

  let session = AVCaptureSession()

  // All session/device mutations happen on this queue.
  private let sessionQueue = DispatchQueue(label: "app.persei.camera.session")
  private var device: AVCaptureDevice?
  private var videoInput: AVCaptureDeviceInput?
  private let photoOutput = AVCapturePhotoOutput()
  // Keeps capture delegates alive until their capture completes.
  private var inFlightCaptures: [Int64: PhotoCaptureDelegate] = [:]

  /// Live sensor readout pushed to JS (set by the module while observed).
  var onExposureUpdate: (([String: Any]) -> Void)?
  private var observations: [NSKeyValueObservation] = []
  private var lastEmit = Date.distantPast

  private static let lensDeviceTypes: [String: AVCaptureDevice.DeviceType] = [
    "ultraWide": .builtInUltraWideCamera,
    "wide": .builtInWideAngleCamera,
    "telephoto": .builtInTelephotoCamera,
  ]

  // MARK: - Session lifecycle

  func start(lens: String, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    sessionQueue.async {
      do {
        let capabilities = try self.configureSession(lens: lens)
        if !self.session.isRunning {
          self.session.startRunning()
        }
        completion(.success(capabilities))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func stop() {
    sessionQueue.async {
      if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  private func configureSession(lens: String) throws -> [String: Any] {
    let deviceType = Self.lensDeviceTypes[lens] ?? .builtInWideAngleCamera
    guard let newDevice = AVCaptureDevice.default(deviceType, for: .video, position: .back)
      ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    else {
      throw CameraEngineError.deviceUnavailable
    }

    session.beginConfiguration()
    session.sessionPreset = .photo

    if let currentInput = videoInput {
      session.removeInput(currentInput)
      videoInput = nil
    }

    let input = try AVCaptureDeviceInput(device: newDevice)
    guard session.canAddInput(input) else {
      session.commitConfiguration()
      throw CameraEngineError.deviceUnavailable
    }
    session.addInput(input)
    videoInput = input
    device = newDevice

    if !session.outputs.contains(photoOutput) {
      guard session.canAddOutput(photoOutput) else {
        session.commitConfiguration()
        throw CameraEngineError.deviceUnavailable
      }
      session.addOutput(photoOutput)
    }

    photoOutput.maxPhotoQualityPrioritization = .quality
    if let maxDimensions = newDevice.activeFormat.supportedMaxPhotoDimensions.last {
      photoOutput.maxPhotoDimensions = maxDimensions
    }
    if photoOutput.isAppleProRAWSupported {
      photoOutput.isAppleProRAWEnabled = true
    }

    session.commitConfiguration()
    startObserving(newDevice)
    return capabilities(of: newDevice)
  }

  // MARK: - Live readout

  private func startObserving(_ device: AVCaptureDevice) {
    observations.forEach { $0.invalidate() }
    observations = [
      device.observe(\.iso, options: [.initial, .new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.exposureDuration, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.lensPosition, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.deviceWhiteBalanceGains, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.exposureTargetBias, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.videoZoomFactor, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
    ]
  }

  private func emitUpdate() {
    guard let device, let onExposureUpdate else { return }
    let now = Date()
    // ~10 Hz max vers JS.
    guard now.timeIntervalSince(lastEmit) > 0.1 else { return }
    lastEmit = now

    var kelvin = 0.0
    let gains = device.deviceWhiteBalanceGains
    let maxGain = device.maxWhiteBalanceGain
    if gains.redGain >= 1, gains.greenGain >= 1, gains.blueGain >= 1,
       gains.redGain <= maxGain, gains.greenGain <= maxGain, gains.blueGain <= maxGain {
      kelvin = Double(device.temperatureAndTintValues(for: gains).temperature)
    }

    onExposureUpdate([
      "iso": Double(device.iso),
      "shutter": device.exposureDuration.seconds,
      "lensPosition": Double(device.lensPosition),
      "exposureBias": Double(device.exposureTargetBias),
      "whiteBalanceKelvin": kelvin,
      "zoom": Double(device.videoZoomFactor),
    ])
  }

  private func capabilities(of device: AVCaptureDevice) -> [String: Any] {
    let format = device.activeFormat
    let discovery = AVCaptureDevice.DiscoverySession(
      deviceTypes: [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera],
      mediaType: .video,
      position: .back
    )
    let lenses = discovery.devices.compactMap { available -> String? in
      Self.lensDeviceTypes.first { $0.value == available.deviceType }?.key
    }
    let maxDimensions = format.supportedMaxPhotoDimensions.last
    let maxMegapixels = maxDimensions.map { Double($0.width) * Double($0.height) / 1_000_000.0 } ?? 12.0

    return [
      "minIso": Double(format.minISO),
      "maxIso": Double(format.maxISO),
      "minShutter": format.minExposureDuration.seconds,
      "maxShutter": format.maxExposureDuration.seconds,
      "minExposureBias": Double(device.minExposureTargetBias),
      "maxExposureBias": Double(device.maxExposureTargetBias),
      "supportsRaw": !photoOutput.availableRawPhotoPixelFormatTypes.isEmpty,
      "supportsProRaw": photoOutput.isAppleProRAWSupported,
      "maxMegapixels": maxMegapixels,
      "lenses": lenses,
      "minZoom": Double(device.minAvailableVideoZoomFactor),
      "maxZoom": Double(device.maxAvailableVideoZoomFactor),
    ]
  }

  // MARK: - Manual controls

  private func withLockedDevice(_ body: (AVCaptureDevice) throws -> Void) throws {
    var result: Result<Void, Error> = .success(())
    sessionQueue.sync {
      guard let device = self.device else {
        result = .failure(CameraEngineError.notRunning)
        return
      }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        try body(device)
      } catch {
        result = .failure(error)
      }
    }
    try result.get()
  }

  func setManualExposure(iso: Double, shutterSeconds: Double) throws {
    try withLockedDevice { device in
      let format = device.activeFormat
      let clampedIso = min(max(Float(iso), format.minISO), format.maxISO)
      let clampedSeconds = min(
        max(shutterSeconds, format.minExposureDuration.seconds),
        format.maxExposureDuration.seconds
      )
      let duration = CMTime(seconds: clampedSeconds, preferredTimescale: 1_000_000_000)
      device.setExposureModeCustom(duration: duration, iso: clampedIso, completionHandler: nil)
    }
  }

  func setAutoExposure() throws {
    try withLockedDevice { device in
      if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
    }
  }

  func setExposureBias(_ bias: Double) throws {
    try withLockedDevice { device in
      let clamped = min(max(Float(bias), device.minExposureTargetBias), device.maxExposureTargetBias)
      device.setExposureTargetBias(clamped, completionHandler: nil)
    }
  }

  func setLensPosition(_ position: Double) throws {
    try withLockedDevice { device in
      guard device.isLockingFocusWithCustomLensPositionSupported else { return }
      let clamped = min(max(Float(position), 0.0), 1.0)
      device.setFocusModeLocked(lensPosition: clamped, completionHandler: nil)
    }
  }

  func setAutoFocus() throws {
    try withLockedDevice { device in
      if device.isFocusModeSupported(.continuousAutoFocus) {
        device.focusMode = .continuousAutoFocus
      }
    }
  }

  func setWhiteBalanceKelvin(_ kelvin: Double) throws {
    try withLockedDevice { device in
      let temperatureAndTint = AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(
        temperature: Float(kelvin),
        tint: 0
      )
      var gains = device.deviceWhiteBalanceGains(for: temperatureAndTint)
      let maxGain = device.maxWhiteBalanceGain
      gains.redGain = min(max(gains.redGain, 1.0), maxGain)
      gains.greenGain = min(max(gains.greenGain, 1.0), maxGain)
      gains.blueGain = min(max(gains.blueGain, 1.0), maxGain)
      device.setWhiteBalanceModeLocked(with: gains, completionHandler: nil)
    }
  }

  func setAutoWhiteBalance() throws {
    try withLockedDevice { device in
      if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
        device.whiteBalanceMode = .continuousAutoWhiteBalance
      }
    }
  }

  func setZoom(_ factor: Double) throws {
    try withLockedDevice { device in
      let clamped = min(
        max(CGFloat(factor), device.minAvailableVideoZoomFactor),
        device.maxAvailableVideoZoomFactor
      )
      device.videoZoomFactor = clamped
    }
  }

  /// Point d'intérêt (coordonnées device, 0-1) : focus one-shot toujours,
  /// exposition seulement si l'utilisateur n'est pas en exposition manuelle.
  func setPointOfInterest(_ point: CGPoint) {
    try? withLockedDevice { device in
      if device.isFocusPointOfInterestSupported {
        device.focusPointOfInterest = point
        if device.isFocusModeSupported(.autoFocus) {
          device.focusMode = .autoFocus
        }
      }
      if device.isExposurePointOfInterestSupported, device.exposureMode != .custom {
        device.exposurePointOfInterest = point
        if device.isExposureModeSupported(.continuousAutoExposure) {
          device.exposureMode = .continuousAutoExposure
        }
      }
    }
  }

  // MARK: - Capture

  func capturePhoto(raw: Bool, completion: @escaping (Result<[String], Error>) -> Void) {
    sessionQueue.async {
      guard self.session.isRunning else {
        completion(.failure(CameraEngineError.notRunning))
        return
      }

      let settings = self.makePhotoSettings(raw: raw)
      let captureId = settings.uniqueID
      let delegate = PhotoCaptureDelegate { [weak self] result in
        self?.sessionQueue.async {
          self?.inFlightCaptures.removeValue(forKey: captureId)
        }
        completion(result)
      }
      self.inFlightCaptures[captureId] = delegate
      self.photoOutput.capturePhoto(with: settings, delegate: delegate)
    }
  }

  private func makePhotoSettings(raw: Bool) -> AVCapturePhotoSettings {
    let hevcAvailable = photoOutput.availablePhotoCodecTypes.contains(.hevc)
    let processedFormat: [String: Any]? = hevcAvailable ? [AVVideoCodecKey: AVVideoCodecType.hevc] : nil

    let settings: AVCapturePhotoSettings
    let rawTypes = photoOutput.availableRawPhotoPixelFormatTypes
    if raw, !rawTypes.isEmpty {
      // Prefer ProRAW when the device offers it, otherwise Bayer RAW.
      let proRawType = rawTypes.first { AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) }
      let rawType = proRawType ?? rawTypes[0]
      if let processedFormat {
        settings = AVCapturePhotoSettings(rawPixelFormatType: rawType, processedFormat: processedFormat)
      } else {
        settings = AVCapturePhotoSettings(rawPixelFormatType: rawType)
      }
    } else if let processedFormat {
      settings = AVCapturePhotoSettings(format: processedFormat)
    } else {
      settings = AVCapturePhotoSettings()
    }

    settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
    settings.photoQualityPrioritization = photoOutput.maxPhotoQualityPrioritization
    return settings
  }
}

/// Collects every representation (RAW + processed) of a single capture and
/// resolves once the whole capture finishes.
private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
  private let completion: (Result<[String], Error>) -> Void
  private var fileUris: [String] = []
  private var firstError: Error?

  init(completion: @escaping (Result<[String], Error>) -> Void) {
    self.completion = completion
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishProcessingPhoto photo: AVCapturePhoto,
    error: Error?
  ) {
    if let error {
      if firstError == nil { firstError = error }
      return
    }
    guard let data = photo.fileDataRepresentation() else {
      if firstError == nil {
        firstError = CameraEngineError.captureFailed("empty photo data")
      }
      return
    }
    let fileExtension = photo.isRawPhoto ? "dng" : "heic"
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("persei-\(UUID().uuidString).\(fileExtension)")
    do {
      try data.write(to: url)
      fileUris.append(url.absoluteString)
    } catch {
      if firstError == nil { firstError = error }
    }
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
    error: Error?
  ) {
    if let error = firstError ?? error {
      completion(.failure(error))
    } else {
      completion(.success(fileUris))
    }
  }
}
