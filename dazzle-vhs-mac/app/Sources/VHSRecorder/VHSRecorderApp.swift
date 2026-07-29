import SwiftUI

@main
struct VHSRecorderApp: App {
    @StateObject private var engine = CaptureEngine()

    var body: some Scene {
        WindowGroup("VHS Recorder") {
            ContentView(engine: engine)
                .frame(minWidth: 940, minHeight: 620)
        }
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}
