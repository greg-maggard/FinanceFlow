import SwiftUI
import FinanceFlowKit

/// Hand-authored layered layout for the 32-node graph. The main spine runs
/// straight down the centre column; branch tasks offset right; the terminal
/// Options split goes left (Early) / right (Goals). Computed once and cached.
enum GraphLayout {
    static let columnSpacing: CGFloat = 168
    static let rowSpacing: CGFloat = 98
    static let nodeSize = CGSize(width: 152, height: 68)
    static let margin: CGFloat = 44

    /// (column, row). Column 0 is the centre spine; +1/+2 branch right; -1 left.
    static let grid: [NodeId: (col: CGFloat, row: CGFloat)] = [
        .Start: (0, 0),
        .Rent: (0, 1),
        .Food: (0, 2),
        .Essential: (0, 3),
        .Income: (0, 4),
        .Health: (0, 5),
        .MinDebt: (0, 6),
        .SmallEF: (0, 7),
        .NonEssential: (0, 8),
        .Q_Match: (0, 9),
        .Match: (1, 10),
        .Q_HighDebt: (0, 11),
        .HighDebt: (1, 12),
        .BigEF: (0, 13),
        .Q_ModDebt: (0, 14),
        .ModDebt: (1, 15),
        .IRA: (0, 16),
        .Q_Purchase: (0, 17),
        .SavePurchase: (1, 18),
        .Q_15pct: (0, 19),
        .Q_401k: (0, 20),
        .Increase401k: (1, 21),
        .SelfEmp: (2, 21),
        .Q_HSA: (0, 22),
        .HSA: (1, 23),
        .Q_College: (0, 24),
        .College: (1, 25),
        .Options: (0, 26),
        .Q_Early: (-1, 27),
        .Q_Goals: (1, 27),
        .Early: (-1, 28),
        .Goals: (1, 28),
    ]

    private static let minCol: CGFloat = grid.values.map { $0.col }.min() ?? 0
    private static let maxCol: CGFloat = grid.values.map { $0.col }.max() ?? 0
    private static let maxRow: CGFloat = grid.values.map { $0.row }.max() ?? 0

    static func position(_ id: NodeId) -> CGPoint {
        let cell = grid[id] ?? (0, 0)
        let x = margin + (cell.col - minCol) * columnSpacing + nodeSize.width / 2
        let y = margin + cell.row * rowSpacing + nodeSize.height / 2
        return CGPoint(x: x, y: y)
    }

    static let canvasSize = CGSize(
        width: margin * 2 + (maxCol - minCol) * columnSpacing + nodeSize.width,
        height: margin * 2 + maxRow * rowSpacing + nodeSize.height
    )

    /// True if an edge goes "upward" on the board (the retirement loop-backs).
    static func isLoopBack(from: NodeId, to: NodeId) -> Bool {
        (grid[to]?.row ?? 0) < (grid[from]?.row ?? 0)
    }
}
