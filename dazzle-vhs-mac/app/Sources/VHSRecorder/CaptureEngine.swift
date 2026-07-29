import AppKit
import CoreImage
import CoreVideo
import Foundation

// MARK: - Types

enum VideoStandard: String, CaseIterable, Identifiable {
    case pal, secam, ntsc

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pal:   return "PAL (Europe, 25 i/s)"
        case .secam: return "SECAM (France, 25 i/s)"
        case .ntsc:  return "NTSC (US/Japon, 29,97 i/s)"
        }
    }

    var size: (width: Int, height: Int) {
        self == .ntsc ? (720, 480) : (720, 576)
    }

    var fps: Double {
        self == .ntsc ? 30000.0 / 1001.0 : 25.0
    }
}

enum VideoInput: String, CaseIterable, Identifiable {
    case composite, svideo

    var id: String { rawValue }

    var label: String {
        self == .composite ? "Composite (RCA jaune)" : "S-Video"
    }
}

enum Quality: String, CaseIterable, Identifiable {
    case archive, standard, compact

    var id: String { rawValue }

    var label: String {
        switch self {
        case .archive:  return "Archivage (gros fichier, quasi sans perte)"
        case .standard: return "Standard (recommande)"
        case .compact:  return "Compact"
        }
    }

    var crf: String {
        switch self {
        case .archive:  return "14"
        case .standard: return "18"
        case .compact:  return "23"
        }
    }

    var preset: String {
        self == .compact ? "medium" : "slow"
    }
}

struct AudioDevice: Identifiable, Hashable {
    let index: Int
    let name: String
    var id: Int { index }
}

/// Holds the pipe to ffmpeg. Frames are written from the USB reader thread —
/// never from the main thread, where a full pipe would freeze the interface.
/// Hence the lock: two threads look at `handle`.
final class FrameSink {
    private let lock = NSLock()
    private var handle: FileHandle?
    private(set) var lastError: String?

    func open(_ handle: FileHandle) {
        lock.lock(); defer { lock.unlock() }
        self.handle = handle
        lastError = nil
    }

    func close() {
        lock.lock(); defer { lock.unlock() }
        try? handle?.close()
        handle = nil
    }

    var isOpen: Bool {
        lock.lock(); defer { lock.unlock() }
        return handle != nil
    }

    /// Returns false if the write failed and the sink closed itself.
    @discardableResult
    func write(_ data: Data) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard let handle = handle else { return true }
        do {
            try handle.write(contentsOf: data)
            return true
        } catch {
            lastError = error.localizedDescription
            try? handle.close()
            self.handle = nil
            return false
        }
    }
}

// MARK: - Engine

/// Drives the `dvc100` capture process, renders a live preview, and pipes the
/// same frames into ffmpeg while recording. One USB reader, two consumers.
///
/// Everything except the frame reader runs on the main thread, and results
/// come back through DispatchQueue.main rather than Swift concurrency, so the
/// app builds with any Swift 5 toolchain.
final class CaptureEngine: ObservableObject {

    @Published private(set) var previewImage: CGImage?
    @Published private(set) var isStreaming = false
    @Published private(set) var isRecording = false
    @Published private(set) var frameCount: UInt64 = 0
    @Published private(set) var recordedSeconds: Double = 0
    @Published private(set) var recordedURL: URL?
    @Published private(set) var status: String = "Pret"
    @Published private(set) var log: [String] = []
    @Published private(set) var audioDevices: [AudioDevice] = []

    var standard: VideoStandard = .pal
    var input: VideoInput = .composite
    var quality: Quality = .standard
    var deinterlace = true
    var audioDeviceIndex: Int?

    private var captureProcess: Process?
    private var ffmpegProcess: Process?
    private let sink = FrameSink()
    private var readerThread: Thread?
    private var stopRequested = false
    private var recordingStart: Date?
    private var timer: Timer?

    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private var pixelBuffer: CVPixelBuffer?
    private var converting = false

    // MARK: Tool discovery

    /// Looks for a helper next to the app first (bundled build), then in the
    /// usual Homebrew locations, then on PATH.
    static func locateTool(_ name: String) -> String? {
        var candidates: [String] = []
        if let res = Bundle.main.resourceURL?.appendingPathComponent(name).path {
            candidates.append(res)
        }
        candidates += [
            "/opt/homebrew/bin/\(name)",
            "/usr/local/bin/\(name)",
            "/usr/bin/\(name)",
            FileManager.default.currentDirectoryPath + "/build/\(name)",
            FileManager.default.currentDirectoryPath + "/\(name)",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }
        // Last resort: ask the shell, which knows the user's PATH.
        let which = Process()
        which.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        which.arguments = ["which", name]
        let pipe = Pipe()
        which.standardOutput = pipe
        which.standardError = FileHandle.nullDevice
        try? which.run()
        which.waitUntilExit()
        let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return out.isEmpty ? nil : out
    }

    // Resolved once: locateTool() may spawn `which`, and the interface reads
    // these while frames are flowing.
    let captureToolPath: String? = CaptureEngine.locateTool("dvc100")
    let ffmpegPath: String? = CaptureEngine.locateTool("ffmpeg")

    // MARK: Audio devices

    func refreshAudioDevices() {
        guard let ffmpeg = ffmpegPath else { return }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: ffmpeg)
        proc.arguments = ["-hide_banner", "-f", "avfoundation",
                          "-list_devices", "true", "-i", ""]
        let pipe = Pipe()
        proc.standardError = pipe
        proc.standardOutput = FileHandle.nullDevice
        do { try proc.run() } catch { return }
        let text = String(data: pipe.fileHandleForReading.readDataToEndOfFile(),
                          encoding: .utf8) ?? ""
        proc.waitUntilExit()

        var devices: [AudioDevice] = []
        var inAudioSection = false
        for line in text.split(separator: "\n") {
            if line.contains("audio devices") { inAudioSection = true; continue }
            if line.contains("video devices") { inAudioSection = false; continue }
            guard inAudioSection, let device = line.matchesIndexedDevice() else { continue }
            devices.append(device)
        }
        audioDevices = devices
        if audioDeviceIndex == nil {
            audioDeviceIndex = devices.first?.index
        }
    }

    // MARK: Streaming

    func start() {
        guard !isStreaming else { return }
        guard let tool = captureToolPath else {
            status = "Outil dvc100 introuvable - lancez `make` dans le dossier du projet"
            return
        }

        let (w, h) = standard.size
        let frameSize = w * h * 2

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: tool)
        proc.arguments = ["stream",
                          "--standard", standard.rawValue,
                          "--input", input.rawValue]
        let out = Pipe()
        let err = Pipe()
        proc.standardOutput = out
        proc.standardError = err

        // Both handlers fire on background threads: hop to the main thread
        // before touching anything the interface observes.
        err.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty,
                  let text = String(data: data, encoding: .utf8),
                  let engine = self else { return }
            DispatchQueue.main.async { engine.appendLog(text) }
        }

        proc.terminationHandler = { [weak self] _ in
            guard let engine = self else { return }
            DispatchQueue.main.async { engine.handleCaptureExit() }
        }

        do {
            try proc.run()
        } catch {
            status = "Lancement de dvc100 impossible : \(error.localizedDescription)"
            return
        }

        captureProcess = proc
        stopRequested = false
        isStreaming = true
        frameCount = 0
        status = "Capture en cours"

        let fd = out.fileHandleForReading.fileDescriptor
        let thread = Thread { [weak self] in
            self?.readLoop(fd: fd, frameSize: frameSize, width: w, height: h)
        }
        thread.name = "dvc100-reader"
        thread.stackSize = 512 * 1024
        readerThread = thread
        thread.start()

        // Scheduled on the main run loop, so tick() is already on the main
        // thread when it fires.
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    func stop() {
        stopRequested = true
        if isRecording { stopRecording() }
        // Only ask the process to leave. Releasing it here would close the
        // pipe under the reader thread while it sits in read(); the
        // termination handler does the teardown once the child is really gone.
        captureProcess?.terminate()
        isStreaming = false
        status = "Arret en cours..."
    }

    private func handleCaptureExit() {
        captureProcess = nil
        readerThread = nil
        if isRecording { stopRecording() }
        timer?.invalidate()
        timer = nil
        let wasStreaming = isStreaming
        isStreaming = false
        status = stopRequested || !wasStreaming
            ? "Arrete"
            : "La capture s'est interrompue - voir le journal"
    }

    private func tick() {
        if let start = recordingStart {
            recordedSeconds = Date().timeIntervalSince(start)
        }
    }

    // MARK: Recording

    func startRecording(to folder: URL) {
        guard isStreaming else {
            status = "Demarrez d'abord l'apercu"
            return
        }
        guard let ffmpeg = ffmpegPath else {
            status = "ffmpeg introuvable - installez-le avec `brew install ffmpeg`"
            return
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        let url = folder.appendingPathComponent("Cassette_\(formatter.string(from: Date())).mp4")

        let (w, h) = standard.size
        var args: [String] = [
            "-hide_banner", "-loglevel", "warning",
            "-f", "rawvideo", "-pix_fmt", "yuyv422",
            "-s", "\(w)x\(h)", "-r", String(format: "%.4f", standard.fps),
            "-i", "pipe:0",
        ]
        if let idx = audioDeviceIndex {
            args += ["-f", "avfoundation", "-i", ":\(idx)",
                     "-c:a", "aac", "-b:a", "192k"]
        }
        if deinterlace {
            args += ["-vf", "yadif=1"]        // 25i -> 50p, plus agreable a revoir
        }
        args += ["-c:v", "libx264",
                 "-crf", quality.crf,
                 "-preset", quality.preset,
                 "-pix_fmt", "yuv420p",
                 "-aspect", "4:3",
                 "-movflags", "+faststart",
                 "-y", url.path]

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: ffmpeg)
        proc.arguments = args
        let stdinPipe = Pipe()
        proc.standardInput = stdinPipe
        proc.standardOutput = FileHandle.nullDevice
        let err = Pipe()
        proc.standardError = err
        err.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty,
                  let text = String(data: data, encoding: .utf8),
                  let engine = self else { return }
            DispatchQueue.main.async { engine.appendLog("ffmpeg: " + text) }
        }

        do {
            try proc.run()
        } catch {
            status = "Lancement de ffmpeg impossible : \(error.localizedDescription)"
            return
        }

        ffmpegProcess = proc
        sink.open(stdinPipe.fileHandleForWriting)
        recordedURL = url
        recordingStart = Date()
        recordedSeconds = 0
        isRecording = true
        status = "Enregistrement vers \(url.lastPathComponent)"
        appendLog("ffmpeg \(args.joined(separator: " "))")
    }

    func stopRecording() {
        guard isRecording else { return }
        isRecording = false
        sink.close()                 // ffmpeg sees EOF and finalises the file
        ffmpegProcess?.waitUntilExit()
        ffmpegProcess = nil
        recordingStart = nil
        if let url = recordedURL {
            status = "Enregistre : \(url.lastPathComponent)"
        }
    }

    func revealRecording() {
        guard let url = recordedURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    // MARK: Frame plumbing (background thread)

    /// Runs on its own thread for the whole capture session.
    private func readLoop(fd: Int32, frameSize: Int, width: Int, height: Int) {
        var buffer = [UInt8](repeating: 0, count: frameSize)
        var counter: UInt64 = 0

        while true {
            var got = 0
            while got < frameSize {
                let n = buffer.withUnsafeMutableBytes { raw -> Int in
                    guard let base = raw.baseAddress else { return -1 }
                    return read(fd, base.advanced(by: got), frameSize - got)
                }
                if n < 0 && errno == EINTR { continue }
                if n <= 0 { return }        // pipe closed: capture stopped
                got += n
            }

            let frame = Data(buffer)
            counter += 1

            // Recording first: this write may block until ffmpeg drains the
            // pipe, which is exactly the back-pressure we want on the USB side.
            if sink.isOpen && !sink.write(frame) {
                let reason = sink.lastError ?? "pipe ferme"
                DispatchQueue.main.async { [weak self] in
                    self?.appendLog("ecriture ffmpeg interrompue : \(reason)")
                    self?.stopRecording()
                }
            }

            // Preview at half rate; it is only there to check tracking and
            // colour, and every hop to the main thread costs a redraw.
            if counter % 2 == 0 {
                DispatchQueue.main.async { [weak self] in
                    self?.handleFrame(frame, width: width, height: height, framesRead: 2)
                }
            }
        }
    }

    private func handleFrame(_ frame: Data, width: Int, height: Int, framesRead: UInt64) {
        frameCount += framesRead

        // Skip rather than queue if conversion cannot keep up.
        guard !converting else { return }
        converting = true
        if let image = makeImage(from: frame, width: width, height: height) {
            previewImage = image
        }
        converting = false
    }

    /// YUYV maps directly onto CoreVideo's 'yuvs' pixel format, so the only
    /// work here is a row-by-row copy into a CVPixelBuffer.
    private func makeImage(from frame: Data, width: Int, height: Int) -> CGImage? {
        if pixelBuffer == nil {
            var pb: CVPixelBuffer?
            let attrs: [CFString: Any] = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary]
            CVPixelBufferCreate(kCFAllocatorDefault, width, height,
                                kCVPixelFormatType_422YpCbCr8_yuvs,
                                attrs as CFDictionary, &pb)
            pixelBuffer = pb
        }
        guard let pb = pixelBuffer else { return nil }

        CVPixelBufferLockBaseAddress(pb, [])
        defer { CVPixelBufferUnlockBaseAddress(pb, []) }
        guard let dst = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let dstStride = CVPixelBufferGetBytesPerRow(pb)
        let srcStride = width * 2

        frame.withUnsafeBytes { raw in
            guard let src = raw.baseAddress else { return }
            if dstStride == srcStride {
                memcpy(dst, src, srcStride * height)
            } else {
                for row in 0..<height {
                    memcpy(dst.advanced(by: row * dstStride),
                           src.advanced(by: row * srcStride),
                           srcStride)
                }
            }
        }

        let ci = CIImage(cvPixelBuffer: pb)
        return ciContext.createCGImage(ci, from: ci.extent)
    }

    // MARK: Log

    private func appendLog(_ text: String) {
        for line in text.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            log.append(trimmed)
            if trimmed.hasPrefix("FORMAT ") {
                status = "Flux \(trimmed.dropFirst(7))"
            }
        }
        if log.count > 400 {
            log.removeFirst(log.count - 400)
        }
    }
}

private extension Substring {
    /// Parses ffmpeg's `[AVFoundation indev @ 0x...] [1] Micro interne` lines.
    func matchesIndexedDevice() -> AudioDevice? {
        guard let bracket = range(of: "] [", options: .backwards) else { return nil }
        let rest = self[bracket.upperBound...]
        guard let close = rest.firstIndex(of: "]") else { return nil }
        guard let index = Int(rest[rest.startIndex..<close]) else { return nil }
        let name = rest[rest.index(after: close)...]
            .trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return nil }
        return AudioDevice(index: index, name: name)
    }
}
