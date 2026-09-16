// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "applekit",
    platforms: [
        .macOS("26.0")
    ],
    targets: [
        .executableTarget(
            name: "applekit",
            path: "Sources/applekit"
        )
    ]
)
