// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FinanceFlowKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "FinanceFlowKit", targets: ["FinanceFlowKit"]),
    ],
    targets: [
        .target(name: "FinanceFlowKit"),
        .testTarget(
            name: "FinanceFlowKitTests",
            dependencies: ["FinanceFlowKit"]
        ),
    ]
)
