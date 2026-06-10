import Testing
import Foundation
@testable import FinanceFlowKit

/// Write normalization keeps the legacy scalar mirrors in sync with sub-goal
/// lists, so documents written by this app stay meaningful to readers that
/// predate the lists (notably web builds that still show the single balance).
@Suite("write normalization")
struct NormalizationTests {
    @Test("EF data mirrors balance = Σ bucket balances while buckets exist")
    func efMirrorsBalance() {
        let d = SmallEFData(balance: .manual(999), items: [
            EFBucket(name: "Medical", target: 1000, balance: .manual(800)),
            EFBucket(name: "Car", target: 500, balance: .manual(Decimal(string: "200.50")!)),
        ]).normalized()
        #expect(d.balance == .manual(Decimal(string: "1000.50")!))
        #expect(d.items?.count == 2)

        let big = BigEFData(targetMonths: 6, balance: .manual(0), items: [
            EFBucket(target: 4000, balance: .manual(2500)),
        ]).normalized()
        #expect(big.balance == .manual(2500))
        #expect(big.targetMonths == 6)
    }

    @Test("empty sub-goal lists collapse to nil")
    func emptyListsCollapse() {
        #expect(SmallEFData(balance: .manual(500), items: []).normalized().items == nil)
        #expect(BigEFData(targetMonths: 3, balance: .manual(0), items: []).normalized().items == nil)
        #expect(RecurringData(target: .manual(100), items: []).normalized().items == nil)
        #expect(SavePurchaseData(goalName: "Car", items: []).normalized().items == nil)
    }

    @Test("SavePurchase mirrors the legacy scalars from its goals")
    func savePurchaseMirrors() {
        let d = SavePurchaseData(goalName: "stale", target: 1, saved: .manual(1), byDate: "2020-01", items: [
            PurchaseGoal(name: "Down payment", target: 40000, saved: .manual(15000), byDate: "2028-06"),
            PurchaseGoal(name: "New car", target: 12000, saved: .manual(Decimal(string: "0.1")!)),
        ]).normalized()
        #expect(d.goalName == "Down payment")
        #expect(d.target == 52000)
        #expect(d.saved == .manual(Decimal(string: "15000.1")!))
        #expect(d.byDate == "2028-06")
        #expect(d.items?.count == 2)
    }

    @Test("data without lists is untouched")
    func identityWithoutLists() {
        let ef = SmallEFData(balance: .manual(500))
        #expect(ef.normalized() == ef)
        let recurring = RecurringData(target: .manual(100), funded: .manual(50))
        #expect(recurring.normalized() == recurring)
    }

    @Test("payloads without sub-goal lists pass through NodeData.normalized unchanged")
    func nodeDataPassThrough() {
        let debts = NodeData.debts([Debt(name: "Card", balance: 100)])
        #expect(debts.normalized() == debts)
    }

    @MainActor
    @Test("AppStore.setNodeData applies normalization on every write")
    func storeNormalizesOnWrite() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.setNodeData(.SmallEF, .smallEF(SmallEFData(balance: .manual(0), items: [
            EFBucket(name: "Medical", target: 1000, balance: .manual(750)),
        ])))
        #expect(store.state.node(.SmallEF).data?.smallEF?.balance == .manual(750))

        store.setNodeData(.Rent, .recurring(RecurringData(target: .manual(100), items: [])))
        #expect(store.state.node(.Rent).data?.recurring?.items == nil)
    }
}
