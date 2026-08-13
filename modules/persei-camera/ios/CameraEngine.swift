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

/// Owns the AVCaptureSession and exposes every publicly controllable camera
/// capability: custom exposure (ISO + shutter), manual focus, white balance
/// (kelvin + tint), lens/position switching, zoom, flash/torch, Live Photos,
/// depth delivery, exposure bracketing and RAW/ProRAW capture.
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

  // Aides de visée (histogramme, peaking, zebras, loupe).
  let processor = FrameProcessor()
  private let videoDataOutput = AVCaptureVideoDataOutput()
  private let processingQueue = DispatchQueue(label: "app.persei.camera.processing")
  weak var assistView: PerseiCameraView?
  /// Histogramme 64 bins vers JS (~5 Hz quand activé).
  var onHistogram: (([Double]) -> Void)?
  /// Pression du bouton volume / Camera Control.
  var onCaptureButton: (() -> Void)?

  override init() {
    super.init()
    processor.onOverlayImage = { [weak self] image in
      DispatchQueue.main.async { self?.assistView?.setAssistOverlay(image) }
    }
    processor.onLoupeImage = { [weak self] image in
      DispatchQueue.main.async { self?.assistView?.setLoupe(image) }
    }
    processor.onHistogram = { [weak self] bins in
      self?.onHistogram?(bins)
    }
  }

  // Préférences de capture (appliquées à chaque photo).
  private var flashMode: AVCaptureDevice.FlashMode = .off
  private var preferHighResolution = true
  private var livePhotoEnabled = false
  private var depthEnabled = false

  /// Live sensor readout pushed to JS (set by the module while observed).
  var onExposureUpdate: (([String: Any]) -> Void)?
  private var observations: [NSKeyValueObservation] = []
  private var lastEmit = Date.distantPast

  // (plus de table d'objectifs discrets : l'arrière passe par le device virtuel)

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

  private func resolveDevice(lens: String) -> AVCaptureDevice? {
    if lens == "front" {
      return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
    }
    // Arrière : device virtuel comme l'app Camera d'Apple — zoom continu
    // 0,5x→télé avec bascule d'objectif automatique et macro auto.
    return AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)
      ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
      ?? AVCaptureDevice.default(.builtInDualCamera, for: .video, position: .back)
      ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
  }

  private func configureSession(lens: String) throws -> [String: Any] {
    guard let newDevice = resolveDevice(lens: lens) else {
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
    applyResolutionPreference(for: newDevice)
    if photoOutput.isAppleProRAWSupported {
      photoOutput.isAppleProRAWEnabled = true
    }
    if photoOutput.isLivePhotoCaptureSupported {
      photoOutput.isLivePhotoCaptureEnabled = livePhotoEnabled
    }
    if photoOutput.isDepthDataDeliverySupported {
      photoOutput.isDepthDataDeliveryEnabled = depthEnabled
    }
    if #available(iOS 17.0, *) {
      if photoOutput.isZeroShutterLagSupported {
        photoOutput.isZeroShutterLagEnabled = true
      }
      if photoOutput.isResponsiveCaptureSupported {
        photoOutput.isResponsiveCaptureEnabled = true
      }
      if photoOutput.isFastCapturePrioritizationSupported {
        photoOutput.isFastCapturePrioritizationEnabled = true
      }
    }

    if !session.outputs.contains(videoDataOutput) {
      videoDataOutput.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      ]
      videoDataOutput.alwaysDiscardsLateVideoFrames = true
      videoDataOutput.setSampleBufferDelegate(processor, queue: processingQueue)
      if session.canAddOutput(videoDataOutput) {
        session.addOutput(videoDataOutput)
      }
    }
    // Frames en portrait pour que les calques d'aide collent à la préview.
    if let connection = videoDataOutput.connection(with: .video) {
      if #available(iOS 17.0, *) {
        if connection.isVideoRotationAngleSupported(90) {
          connection.videoRotationAngle = 90
        }
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
    }

    session.commitConfiguration()
    startObserving(newDevice)
    return capabilities(of: newDevice)
  }

  private func applyResolutionPreference(for device: AVCaptureDevice) {
    let dimensions = device.activeFormat.supportedMaxPhotoDimensions
    guard !dimensions.isEmpty else { return }
    photoOutput.maxPhotoDimensions = preferHighResolution ? dimensions.last! : dimensions.first!
  }

  /// Pastilles de zoom façon app Apple (0,5× / 1× / 2× / 5× sur 16 Pro) :
  /// `factor` est l'affichage, `zoom` le videoZoomFactor correspondant sur le
  /// device virtuel. Le 2× vient du recadrage natif qualité optique du 48 MP.
  private func zoomPresets(of device: AVCaptureDevice) -> [[String: Double]] {
    guard device.position == .back else { return [] }
    let constituents = device.constituentDevices
    guard constituents.count >= 2 else {
      return [["factor": 1.0, "zoom": 1.0]]
    }

    var presets: [[String: Double]] = []
    let switchOvers = device.virtualDeviceSwitchOverVideoZoomFactors.map { Double(truncating: $0) }
    let hasUltraWide = constituents.contains { $0.deviceType == .builtInUltraWideCamera }
    let wideZoom = hasUltraWide ? (switchOvers.first ?? 2.0) : 1.0

    if hasUltraWide {
      presets.append(["factor": 0.5, "zoom": 1.0])
    }
    presets.append(["factor": 1.0, "zoom": wideZoom])

    if let wide = constituents.first(where: { $0.deviceType == .builtInWideAngleCamera }) {
      let crops = wide.activeFormat.secondaryNativeResolutionZoomFactors.map { Double($0) }
      if let crop = crops.first, crop > 1 {
        presets.append(["factor": crop, "zoom": wideZoom * crop])
      }
    }

    if constituents.contains(where: { $0.deviceType == .builtInTelephotoCamera }) {
      if hasUltraWide, switchOvers.count >= 2, wideZoom > 0 {
        presets.append(["factor": (switchOvers[1] / wideZoom * 10).rounded() / 10, "zoom": switchOvers[1]])
      } else if !hasUltraWide, let first = switchOvers.first {
        presets.append(["factor": first, "zoom": first])
      }
    }

    presets.sort { ($0["factor"] ?? 0) < ($1["factor"] ?? 0) }
    return presets
  }

  private func capabilities(of device: AVCaptureDevice) -> [String: Any] {
    let format = device.activeFormat
    let hasFrontCamera =
      AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) != nil
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
      "zoomPresets": zoomPresets(of: device),
      "hasFrontCamera": hasFrontCamera,
      "minZoom": Double(device.minAvailableVideoZoomFactor),
      "maxZoom": Double(device.maxAvailableVideoZoomFactor),
      "hasFlash": device.hasFlash,
      "hasTorch": device.hasTorch,
      "supportsLivePhoto": photoOutput.isLivePhotoCaptureSupported,
      "supportsDepth": photoOutput.isDepthDataDeliverySupported,
      "maxBracketCount": Int(photoOutput.maxBracketedCapturePhotoCount),
    ]
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

  func setWhiteBalance(kelvin: Double, tint: Double) throws {
    try withLockedDevice { device in
      let temperatureAndTint = AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(
        temperature: Float(kelvin),
        tint: Float(tint)
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

  /// 0 = éteinte, sinon intensité 0-1.
  func setTorchLevel(_ level: Double) throws {
    try withLockedDevice { device in
      guard device.hasTorch else { return }
      if level <= 0 {
        device.torchMode = .off
      } else {
        try device.setTorchModeOn(level: Float(min(max(level, 0.01), 1.0)))
      }
    }
  }

  func setFlashMode(_ mode: String) {
    sessionQueue.async {
      switch mode {
      case "on": self.flashMode = .on
      case "auto": self.flashMode = .auto
      default: self.flashMode = .off
      }
    }
  }

  func setQualityPrioritization(_ mode: String) {
    sessionQueue.async {
      self.session.beginConfiguration()
      switch mode {
      case "speed": self.photoOutput.maxPhotoQualityPrioritization = .speed
      case "balanced": self.photoOutput.maxPhotoQualityPrioritization = .balanced
      default: self.photoOutput.maxPhotoQualityPrioritization = .quality
      }
      self.session.commitConfiguration()
    }
  }

  func setHighResolution(_ enabled: Bool) {
    sessionQueue.async {
      self.preferHighResolution = enabled
      guard let device = self.device else { return }
      self.session.beginConfiguration()
      self.applyResolutionPreference(for: device)
      self.session.commitConfiguration()
    }
  }

  func setLivePhotoEnabled(_ enabled: Bool) {
    sessionQueue.async {
      self.livePhotoEnabled = enabled
      self.session.beginConfiguration()
      if self.photoOutput.isLivePhotoCaptureSupported {
        self.photoOutput.isLivePhotoCaptureEnabled = enabled
      }
      self.session.commitConfiguration()
    }
  }

  func setDepthEnabled(_ enabled: Bool) {
    sessionQueue.async {
      self.depthEnabled = enabled
      self.session.beginConfiguration()
      if self.photoOutput.isDepthDataDeliverySupported {
        self.photoOutput.isDepthDataDeliveryEnabled = enabled
      }
      self.session.commitConfiguration()
    }
  }

  // MARK: - Aides de visée

  func setAssistOptions(peaking: Bool, zebras: Bool, histogram: Bool) {
    processingQueue.async {
      self.processor.peakingEnabled = peaking
      self.processor.zebrasEnabled = zebras
      self.processor.histogramEnabled = histogram
    }
  }

  func setLoupeEnabled(_ enabled: Bool) {
    processingQueue.async {
      self.processor.loupeEnabled = enabled
    }
  }

  // MARK: - Pose longue (empilement)

  /// Progression de la pose ({frame, total}), poussée vers JS.
  var onLongExposureProgress: (([String: Any]) -> Void)?
  private var stackCancelled = false
  private var stackFramesDone = 0

  func cancelLongExposure() {
    sessionQueue.async { self.stackCancelled = true }
  }

  /// Pose longue sans plafond : capture continue de trames à ~1 s d'exposition
  /// (le maximum matériel), empilées en moyenne (« lueur », nuit propre) et/ou
  /// en fusion max (« étoiles », garde les traînées de météores).
  func startLongExposure(
    seconds: Double,
    iso: Double,
    mode: String,
    align: Bool,
    meteorFilter: Bool,
    completion: @escaping (Result<[String], Error>) -> Void
  ) {
    sessionQueue.async {
      guard self.session.isRunning, let device = self.device else {
        completion(.failure(CameraEngineError.notRunning))
        return
      }
      self.stackCancelled = false
      self.stackFramesDone = 0

      let frameDuration = min(1.0, device.activeFormat.maxExposureDuration.seconds)
      do {
        try device.lockForConfiguration()
        let clampedIso = min(max(Float(iso), device.activeFormat.minISO), device.activeFormat.maxISO)
        device.setExposureModeCustom(
          duration: CMTime(seconds: frameDuration, preferredTimescale: 1_000_000_000),
          iso: clampedIso,
          completionHandler: nil
        )
        device.unlockForConfiguration()
      } catch {
        completion(.failure(error))
        return
      }

      let totalFrames = max(2, Int((seconds / frameDuration).rounded()))
      let stacker = FrameStacker(mode: mode, align: align, meteorFilter: meteorFilter)
      self.captureStackFrame(remaining: totalFrames, total: totalFrames, stacker: stacker, completion: completion)
    }
  }

  private func captureStackFrame(
    remaining: Int,
    total: Int,
    stacker: FrameStacker,
    completion: @escaping (Result<[String], Error>) -> Void
  ) {
    if remaining == 0 || stackCancelled {
      finishStack(stacker: stacker, completion: completion)
      return
    }

    let settings: AVCapturePhotoSettings
    if let format = hevcFormat() {
      settings = AVCapturePhotoSettings(format: format)
    } else {
      settings = AVCapturePhotoSettings()
    }
    settings.photoQualityPrioritization = .speed

    let captureId = settings.uniqueID
    let delegate = PhotoCaptureDelegate { [weak self] result in
      guard let self else { return }
      self.sessionQueue.async {
        self.inFlightCaptures.removeValue(forKey: captureId)
        if case .success(let uris) = result, let uri = uris.first, let url = URL(string: uri) {
          stacker.add(url: url)
          try? FileManager.default.removeItem(at: url)
          self.stackFramesDone += 1
          self.onLongExposureProgress?(["frame": self.stackFramesDone, "total": total])
        }
        // Frame ratée : on continue, l'empilement tolère les trous.
        self.captureStackFrame(remaining: remaining - 1, total: total, stacker: stacker, completion: completion)
      }
    }
    inFlightCaptures[captureId] = delegate
    photoOutput.capturePhoto(with: settings, delegate: delegate)
  }

  private func finishStack(
    stacker: FrameStacker,
    completion: @escaping (Result<[String], Error>) -> Void
  ) {
    // Rendu final hors de la sessionQueue (peut prendre du temps), puis
    // retour en exposition auto.
    sessionQueue.async {
      guard let device = self.device else { return }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        if device.isExposureModeSupported(.continuousAutoExposure) {
          device.exposureMode = .continuousAutoExposure
        }
      } catch {
        // Verrou refusé : on laisse l'exposition telle quelle plutôt que de
        // toucher un device non verrouillé.
      }
    }
    DispatchQueue.global(qos: .userInitiated).async {
      completion(stacker.finalize())
    }
  }

  // MARK: - Capture

  func capturePhoto(
    raw: Bool,
    bracketStops: [Double],
    completion: @escaping (Result<[String], Error>) -> Void
  ) {
    sessionQueue.async {
      guard self.session.isRunning else {
        completion(.failure(CameraEngineError.notRunning))
        return
      }

      let settings: AVCapturePhotoSettings
      if !raw, bracketStops.count >= 2, self.photoOutput.maxBracketedCapturePhotoCount >= bracketStops.count {
        settings = self.makeBracketSettings(stops: bracketStops)
      } else {
        settings = self.makePhotoSettings(raw: raw)
      }

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

  private func hevcFormat() -> [String: Any]? {
    photoOutput.availablePhotoCodecTypes.contains(.hevc)
      ? [AVVideoCodecKey: AVVideoCodecType.hevc]
      : nil
  }

  private func makeBracketSettings(stops: [Double]) -> AVCapturePhotoBracketSettings {
    let bracketed = stops.map {
      AVCaptureAutoExposureBracketedStillImageSettings.autoExposureSettings(
        exposureTargetBias: Float($0)
      )
    }
    let settings: AVCapturePhotoBracketSettings
    if let format = hevcFormat() {
      settings = AVCapturePhotoBracketSettings(
        rawPixelFormatType: 0,
        processedFormat: format,
        bracketedSettings: bracketed
      )
    } else {
      settings = AVCapturePhotoBracketSettings(
        rawPixelFormatType: 0,
        processedFormat: nil,
        bracketedSettings: bracketed
      )
    }
    // Pas de maxPhotoDimensions ici : les brackets ne sont pas garantis en
    // haute résolution (servis en 12 MP en pratique, exception sinon).
    return settings
  }

  private func makePhotoSettings(raw: Bool) -> AVCapturePhotoSettings {
    let processedFormat = hevcFormat()

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

    if let device, device.hasFlash, photoOutput.supportedFlashModes.contains(flashMode) {
      settings.flashMode = flashMode
    }
    // Live Photo et profondeur : incompatibles avec le RAW.
    if !raw, photoOutput.isLivePhotoCaptureEnabled {
      settings.livePhotoMovieFileURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("persei-live-\(UUID().uuidString).mov")
    }
    if !raw, photoOutput.isDepthDataDeliveryEnabled {
      settings.isDepthDataDeliveryEnabled = true
      settings.embedsDepthDataInPhoto = true
    }
    return settings
  }
}

/// Collects every representation (RAW + processed + Live Photo movie) of a
/// single capture and resolves once the whole capture finishes.
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
    didFinishProcessingLivePhotoToMovieFileAt outputFileURL: URL,
    duration: CMTime,
    photoDisplayTime: CMTime,
    resolvedSettings: AVCaptureResolvedPhotoSettings,
    error: Error?
  ) {
    if let error {
      if firstError == nil { firstError = error }
      return
    }
    fileUris.append(outputFileURL.absoluteString)
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
