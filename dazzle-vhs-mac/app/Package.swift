// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "VHSRecorder",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "VHSRecorder",
            path: "Sources/VHSRecorder"
        )
    ]
)
