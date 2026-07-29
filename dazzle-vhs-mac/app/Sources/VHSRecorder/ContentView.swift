import AppKit
import SwiftUI

struct ContentView: View {
    @ObservedObject var engine: CaptureEngine

    @AppStorage("standard") private var standardRaw = VideoStandard.pal.rawValue
    @AppStorage("input") private var inputRaw = VideoInput.composite.rawValue
    @AppStorage("quality") private var qualityRaw = Quality.standard.rawValue
    @AppStorage("deinterlace") private var deinterlace = true
    @AppStorage("audioName") private var audioName = ""
    @AppStorage("outputFolder") private var outputFolderPath = ""
    @AppStorage("limit") private var limitRaw = RecordingLimit.unlimited.rawValue
    @AppStorage("customMinutes") private var customMinutes = 180
    @State private var showLog = false

    private let minutesFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .none
        formatter.minimum = 1
        formatter.maximum = 600
        return formatter
    }()

    private var limit: RecordingLimit {
        RecordingLimit(rawValue: limitRaw) ?? .unlimited
    }

    private var outputFolder: URL {
        outputFolderPath.isEmpty
            ? FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask).first
              ?? FileManager.default.homeDirectoryForCurrentUser
            : URL(fileURLWithPath: outputFolderPath)
    }

    var body: some View {
        HStack(spacing: 0) {
            preview
            Divider()
            controls
                .frame(width: 320)
        }
        .onAppear {
            applySettings()
            engine.refreshAudioDevices()
        }
        // L'autorisation micro peut arriver bien apres l'affichage : la liste
        // se remplit alors toute seule, et la selection doit suivre.
        .onChange(of: engine.audioDevices) { devices in
            if !audioName.isEmpty && devices.contains(where: { $0.name == audioName }) {
                engine.audioDeviceName = audioName
            } else {
                audioName = engine.audioDeviceName ?? ""
            }
        }
    }

    // MARK: Preview

    private var preview: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black
                if let image = engine.previewImage {
                    Image(decorative: image, scale: 1.0)
                        .resizable()
                        .aspectRatio(4.0 / 3.0, contentMode: .fit)
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "play.rectangle")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text(engine.isStreaming
                             ? "En attente d'image du magnetoscope..."
                             : "Apercu arrete")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            statusBar
            if showLog {
                Divider()
                logPanel.frame(height: 180)
            }
        }
    }

    private var statusColor: Color {
        if engine.isRecording { return Color.red }
        return engine.isStreaming ? Color.green : Color.gray
    }

    private var statusBar: some View {
        HStack(spacing: 16) {
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)
            Text(engine.status)
                .lineLimit(1)
            Spacer()
            if engine.isRecording {
                Text(timeString(engine.recordedSeconds))
                    .monospacedDigit()
                if let remaining = engine.remainingSeconds {
                    Text("reste \(timeString(remaining))")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
            Text("\(engine.frameCount) trames")
                .monospacedDigit()
                .foregroundStyle(.secondary)
            Button(showLog ? "Masquer le journal" : "Journal") { showLog.toggle() }
                .buttonStyle(.link)
        }
        .font(.callout)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private var logPanel: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(engine.log.indices, id: \.self) { index in
                        Text(engine.log[index])
                            .font(.system(size: 11, design: .monospaced))
                            .textSelection(.enabled)
                            .id(index)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
            }
            .background(Color(nsColor: .textBackgroundColor))
            .onChange(of: engine.log.count) { count in
                proxy.scrollTo(count - 1, anchor: .bottom)
            }
        }
    }

    // MARK: Controls

    private var controls: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {

                section("Source") {
                    Picker("Norme", selection: $standardRaw) {
                        ForEach(VideoStandard.allCases) { std in
                            Text(std.label).tag(std.rawValue)
                        }
                    }
                    Picker("Entree", selection: $inputRaw) {
                        ForEach(VideoInput.allCases) { input in
                            Text(input.label).tag(input.rawValue)
                        }
                    }
                    Picker("Audio", selection: $audioName) {
                        Text("Aucun (video seule)").tag("")
                        ForEach(engine.audioDevices) { device in
                            Text(device.name).tag(device.name)
                        }
                    }
                    .onChange(of: audioName) { _ in applySettings() }

                    if let problem = engine.audioProblem {
                        Text(problem)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button("Rechercher les entrees audio") {
                        engine.refreshAudioDevices()
                    }
                    .buttonStyle(.link)
                }

                section("Enregistrement") {
                    Picker("Duree", selection: $limitRaw) {
                        ForEach(RecordingLimit.allCases) { value in
                            Text(value.label).tag(value.rawValue)
                        }
                    }
                    .onChange(of: limitRaw) { _ in applySettings() }

                    if limit == .custom {
                        HStack {
                            TextField("", value: $customMinutes, formatter: minutesFormatter)
                                .frame(width: 60)
                                .multilineTextAlignment(.trailing)
                                .onChange(of: customMinutes) { _ in applySettings() }
                            Text("minutes")
                            Spacer()
                        }
                    }
                    if limit != .unlimited {
                        Text("L'enregistrement s'arrete tout seul et le fichier est "
                             + "referme proprement. Le Mac est empeche de s'endormir "
                             + "pendant ce temps.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Picker("Qualite", selection: $qualityRaw) {
                        ForEach(Quality.allCases) { quality in
                            Text(quality.label).tag(quality.rawValue)
                        }
                    }
                    Toggle("Desentrelacer (recommande)", isOn: $deinterlace)
                    HStack {
                        Text(outputFolder.lastPathComponent)
                            .lineLimit(1)
                            .truncationMode(.head)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Dossier...") { chooseFolder() }
                    }
                }

                VStack(spacing: 10) {
                    Button {
                        applySettings()
                        if engine.isStreaming { engine.stop() } else { engine.start() }
                    } label: {
                        Label(engine.isStreaming ? "Arreter l'apercu" : "Demarrer l'apercu",
                              systemImage: engine.isStreaming ? "stop.fill" : "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .controlSize(.large)

                    Button {
                        if engine.isRecording {
                            engine.stopRecording()
                        } else {
                            applySettings()
                            if !engine.isStreaming { engine.start() }
                            engine.startRecording(to: outputFolder)
                        }
                    } label: {
                        Label(engine.isRecording ? "Arreter l'enregistrement" : "Enregistrer",
                              systemImage: engine.isRecording ? "stop.circle.fill" : "record.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .controlSize(.large)
                    .tint(engine.isRecording ? Color.red : Color.accentColor)

                    if engine.recordedURL != nil && !engine.isRecording {
                        Button("Afficher le fichier dans le Finder") {
                            engine.revealRecording()
                        }
                        .buttonStyle(.link)
                    }
                }
                .buttonStyle(.borderedProminent)

                section("Diagnostic") {
                    labelled("dvc100", engine.captureToolPath ?? "introuvable")
                    labelled("ffmpeg", engine.ffmpegPath ?? "introuvable - brew install ffmpeg")
                    Text("Si l'image reste noire : verifiez que le magnetoscope est en "
                         + "lecture, puis essayez l'autre norme (PAL/SECAM) et l'entree "
                         + "S-Video. Le detail des echanges avec le boitier est dans le "
                         + "journal.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(16)
        }
    }

    private func section<Content: View>(_ title: String,
                                        @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            content()
        }
        .pickerStyle(.menu)
    }

    private func labelled(_ key: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(key).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
                .lineLimit(1)
                .truncationMode(.head)
        }
    }

    // MARK: Helpers

    private func applySettings() {
        engine.standard = VideoStandard(rawValue: standardRaw) ?? .pal
        engine.input = VideoInput(rawValue: inputRaw) ?? .composite
        engine.quality = Quality(rawValue: qualityRaw) ?? .standard
        engine.deinterlace = deinterlace
        engine.audioDeviceName = audioName.isEmpty ? nil : audioName
        engine.recordingLimit = limit.seconds(customMinutes: customMinutes)
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = outputFolder
        panel.prompt = "Choisir"
        if panel.runModal() == .OK, let url = panel.url {
            outputFolderPath = url.path
        }
    }

    private func timeString(_ seconds: Double) -> String {
        let total = Int(seconds)
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }
}
