import Foundation
import Observation

/// The single source of truth for the running app. Holds `AppState`, exposes
/// mutation methods mirroring `src/state/store.ts`, and autosaves (debounced)
/// through a `StorageAdapter`. Derived values (`status`, `progress`) are pure
/// functions in `Derive`, recomputed on read.
@MainActor
@Observable
public final class AppStore {
    public private(set) var state: AppState

    /// Set on launch when persisted data couldn't be read. The original file is
    /// preserved (quarantined or left untouched); surface this to the user.
    public private(set) var loadError: String?
    /// Set when the most recent autosave failed (cleared on the next success).
    public private(set) var saveError: String?

    @ObservationIgnored private let storage: StorageAdapter
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private let saveDebounce: Duration
    /// When true, autosave is disabled so we never overwrite an on-disk file we
    /// failed to read this session (a possibly-transient failure).
    @ObservationIgnored private var persistenceSuspended = false

    public init(
        state: AppState = .makeInitial(),
        storage: StorageAdapter = FileStorageAdapter(),
        saveDebounce: Duration = .milliseconds(500)
    ) {
        self.state = state
        self.storage = storage
        self.saveDebounce = saveDebounce
    }

    /// Load persisted state if present. Critically, a *failed* load never leaves
    /// the app silently overwriting good data: corrupt/incompatible files are
    /// quarantined and we start fresh; a transient read error suspends autosave
    /// for the session so the existing file is left intact.
    public func bootstrap() async {
        do {
            if let loaded = try await storage.load() {
                state = try IO.migrate(loaded)
            }
            // No file → first run: keep the initial state and allow autosave.
        } catch let StorageError.unreadableContents(underlying) {
            await quarantineAndReset(reason: underlying)
        } catch let error as IO.ImportError {
            await quarantineAndReset(reason: error)
        } catch {
            // Possibly transient (e.g. the file was temporarily protected at
            // launch). Do NOT touch it; disable autosave so we can't clobber it.
            persistenceSuspended = true
            loadError = "Couldn't open your saved data just now. Your existing data was left untouched — reopen the app to try again."
        }
    }

    /// The file exists but is corrupt or from an unsupported version. Move it
    /// aside (preserved for recovery) and start fresh, re-enabling autosave since
    /// the original bytes are now safe.
    private func quarantineAndReset(reason: Error) async {
        await storage.quarantineUnreadableFile()
        state = .makeInitial()
        persistenceSuspended = false
        loadError = "Your saved data couldn't be read and was set aside as a backup (state.corrupt-….json). Starting fresh — you can restore a backup from Settings."
    }

    /// Dismiss the surfaced load error once the user has acknowledged it.
    public func dismissLoadError() { loadError = nil }

    // MARK: - Derived (pure, recomputed on read)

    public var status: [NodeId: Status] { Derive.status(state) }
    public var progress: Derive.Progress { Derive.overallProgress(state) }
    public var budget: BudgetSummary { Derive.monthlyBudgetSummary(state) }
    public func status(of id: NodeId) -> Status { status[id] ?? .upcoming }

    // MARK: - Mutations (mirror store.ts)

    public func setDecision(_ id: DecisionId, _ value: Decision?) {
        mutate { $0.decisions[id] = value }
    }

    public func toggleComplete(_ id: NodeId) {
        mutate {
            var node = $0.nodes[id] ?? NodeState()
            let completed = !node.completed
            node.completed = completed
            node.completedAt = completed ? Date() : nil
            $0.nodes[id] = node
        }
    }

    public func setCompleted(_ id: NodeId, _ completed: Bool) {
        mutate {
            var node = $0.nodes[id] ?? NodeState()
            node.completed = completed
            node.completedAt = completed ? Date() : nil
            $0.nodes[id] = node
        }
    }

    public func setNotes(_ id: NodeId, _ notes: String) {
        mutate { $0.nodes[id, default: NodeState()].notes = notes }
    }

    public func setNodeData(_ id: NodeId, _ data: NodeData) {
        mutate { $0.nodes[id, default: NodeState()].data = data }
    }

    public func toggleMonthlyCheck(_ id: NodeId, _ ymKey: String) {
        mutate {
            var node = $0.nodes[id] ?? NodeState()
            let current = node.monthlyChecks[ymKey] ?? false
            if current {
                node.monthlyChecks[ymKey] = nil
            } else {
                node.monthlyChecks[ymKey] = true
            }
            $0.nodes[id] = node
        }
    }

    public func updateSettings(_ patch: (inout Settings) -> Void) {
        mutate { patch(&$0.settings) }
    }

    public func setCategoryMap(_ id: NodeId, _ categoryId: String?) {
        mutate {
            if let categoryId, !categoryId.isEmpty {
                $0.categoryMap[id] = categoryId
            } else {
                $0.categoryMap[id] = nil
            }
        }
    }

    // MARK: - Budget mutations (mirror the budget actions in store.ts)

    /// Set (or clear, with `amount <= 0`) a category's assignment for a month.
    public func assign(month: String, categoryID: String, amount: Decimal) {
        mutate { state in
            var table = state.budget.assignments[month] ?? [:]
            if amount > 0 { table[categoryID] = amount } else { table[categoryID] = nil }
            state.budget.assignments[month] = table.isEmpty ? nil : table
        }
    }

    public func addAccount(_ account: Account) {
        mutate { $0.budget.accounts.append(account) }
    }

    public func updateAccount(_ account: Account) {
        mutate { state in
            if let i = state.budget.accounts.firstIndex(where: { $0.id == account.id }) {
                state.budget.accounts[i] = account
            }
        }
    }

    public func addTxn(_ txn: Txn) {
        mutate { $0.budget.transactions.append(txn) }
    }

    public func updateTxn(_ txn: Txn) {
        mutate { state in
            if let i = state.budget.transactions.firstIndex(where: { $0.id == txn.id }) {
                state.budget.transactions[i] = txn
            }
        }
    }

    /// Delete a transaction — and its pair, when it's one row of a transfer.
    public func deleteTxn(_ id: String) {
        mutate { state in
            guard let txn = state.budget.transactions.first(where: { $0.id == id }) else { return }
            var ids: Set<String> = [id]
            if let pair = txn.transferPairId { ids.insert(pair) }
            state.budget.transactions.removeAll { ids.contains($0.id) }
        }
    }

    public func addTransfer(
        from: String,
        to: String,
        amount: Decimal,
        date: String,
        payee: String? = nil,
        categoryID: String? = nil
    ) {
        mutate { state in
            let pair = Ledger.pairTransfer(
                accounts: state.budget.accounts,
                from: from, to: to, amount: amount, date: date,
                payee: payee, categoryID: categoryID
            )
            state.budget.transactions.append(contentsOf: [pair.out, pair.inflow])
        }
    }

    public func addGroup(name: String) {
        mutate {
            $0.budget.groups.append(CategoryGroup(id: ShortID.make(), name: name, order: $0.budget.groups.count))
        }
    }

    public func addCategory(groupID: String, name: String) {
        mutate {
            $0.budget.categories.append(
                BudgetCategory(id: ShortID.make(), groupId: groupID, name: name, order: $0.budget.categories.count)
            )
        }
    }

    public func updateCategory(_ category: BudgetCategory) {
        mutate { state in
            if let i = state.budget.categories.firstIndex(where: { $0.id == category.id }) {
                state.budget.categories[i] = category
            }
        }
    }

    /// Apply a planner's batch atomically — one mutation, one autosave, no
    /// partial states. Mirrors `applyBookOps` in store.ts.
    public func apply(_ ops: NodeLedger.BookOps) {
        mutate { state in
            state.budget.groups.append(contentsOf: ops.addGroups)
            state.budget.accounts.append(contentsOf: ops.addAccounts)
            for account in ops.updateAccounts {
                if let i = state.budget.accounts.firstIndex(where: { $0.id == account.id }) {
                    state.budget.accounts[i] = account
                }
            }
            state.budget.categories.append(contentsOf: ops.addCategories)
            for category in ops.updateCategories {
                if let i = state.budget.categories.firstIndex(where: { $0.id == category.id }) {
                    state.budget.categories[i] = category
                }
            }
            state.budget.transactions.append(contentsOf: ops.addTxns)
            for txn in ops.updateTxns {
                if let i = state.budget.transactions.firstIndex(where: { $0.id == txn.id }) {
                    state.budget.transactions[i] = txn
                }
            }
            if !ops.deleteTxnIDs.isEmpty {
                let dead = Set(ops.deleteTxnIDs)
                state.budget.transactions.removeAll { dead.contains($0.id) }
            }
            for assignment in ops.setAssignments {
                var table = state.budget.assignments[assignment.month] ?? [:]
                if assignment.amount > 0 {
                    table[assignment.categoryID] = assignment.amount
                } else {
                    table[assignment.categoryID] = nil
                }
                state.budget.assignments[assignment.month] = table.isEmpty ? nil : table
            }
        }
    }

    /// Deleting never loses money: the category's transactions stay
    /// (uncategorized) and its assignments vanish, so those dollars flow back
    /// to Ready-to-Assign. Mirrors `deleteCategory` in store.ts.
    public func deleteCategory(_ id: String) {
        mutate { state in
            state.budget.categories.removeAll { $0.id == id }
            for i in state.budget.transactions.indices
            where state.budget.transactions[i].categoryId == id {
                state.budget.transactions[i].categoryId = nil
            }
            for month in Array(state.budget.assignments.keys) {
                guard var table = state.budget.assignments[month], table[id] != nil else { continue }
                table[id] = nil
                state.budget.assignments[month] = table.isEmpty ? nil : table
            }
        }
    }

    /// Mark a node's completion celebration as shown (idempotent).
    public func markCelebrationShown(_ id: NodeId) {
        mutate {
            if !$0.shownCelebrations.contains(id) { $0.shownCelebrations.append(id) }
        }
    }

    /// Record that a phase medal has been earned (idempotent).
    public func markMedalEarned(_ phase: Phase) {
        mutate {
            if !$0.earnedMedals.contains(phase.rawValue) { $0.earnedMedals.append(phase.rawValue) }
        }
    }

    public func reset() {
        mutate { $0 = .makeInitial() }
    }

    /// Adopt an externally-provided state (e.g. an imported backup). The caller
    /// is responsible for having decoded/migrated it (see `IO.importJSON`).
    public func replaceState(_ newState: AppState) {
        mutate { $0 = newState }
    }

    // MARK: - Save

    private func mutate(_ change: (inout AppState) -> Void) {
        change(&state)
        scheduleSave()
    }

    private func scheduleSave() {
        guard !persistenceSuspended else { return }
        let debounce = saveDebounce
        let previous = saveTask
        previous?.cancel()
        saveTask = Task { [weak self] in
            // Serialize behind any in-flight save so two writes can't race or
            // land out of order (a cancelled predecessor returns promptly).
            _ = await previous?.value
            try? await Task.sleep(for: debounce)
            if Task.isCancelled { return }
            await self?.writeThrough()
        }
    }

    /// Persist the current state, recording any failure. Runs on the main actor;
    /// the `storage.save` await is the only suspension point.
    private func writeThrough() async {
        guard !persistenceSuspended else { return }
        let snapshot = state
        do {
            try await storage.save(snapshot)
            saveError = nil
        } catch {
            saveError = error.localizedDescription
        }
    }

    /// Force an immediate save (e.g. on scene background), bypassing the debounce.
    /// Waits for any in-flight debounced save to finish first so the final write
    /// reflects the latest state.
    public func flush() async {
        let inFlight = saveTask
        inFlight?.cancel()
        _ = await inFlight?.value
        await writeThrough()
    }
}
