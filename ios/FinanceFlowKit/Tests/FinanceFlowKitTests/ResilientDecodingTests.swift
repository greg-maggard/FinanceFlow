import Testing
import Foundation
@testable import FinanceFlowKit

/// Validates that a single bad field can't take down the whole document — the
/// fix for the silent-data-loss class of bug.
@Suite("Resilient decoding")
struct ResilientDecodingTests {

    @Test("an unknown enum value decodes to a safe fallback, not a failure")
    func unknownEnumFallsBack() throws {
        var s = AppState.makeInitial()
        s.nodes[.Rent]?.data = .recurring(RecurringData(target: SourcedNumber(value: 100, source: .manual)))
        let data = try JSONCoder.encode(s)

        var obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        var nodes = try #require(obj["nodes"] as? [String: Any])
        var rent = try #require(nodes["Rent"] as? [String: Any])
        var dataObj = try #require(rent["data"] as? [String: Any])
        var target = try #require(dataObj["target"] as? [String: Any])
        target["source"] = "plaid_v2_unknown"        // a source this build doesn't know
        dataObj["target"] = target
        rent["data"] = dataObj
        nodes["Rent"] = rent
        obj["nodes"] = nodes

        let mutated = try JSONSerialization.data(withJSONObject: obj)
        let decoded = try JSONCoder.decode(mutated)   // must NOT throw

        #expect(decoded.node(.Rent).data?.recurring?.target.source == .manual)   // fell back
        #expect(decoded.node(.Rent).data?.recurring?.target.value == 100)        // value preserved
    }

    @Test("one structurally-corrupt node is isolated; the rest of the document survives")
    func corruptNodeIsolated() throws {
        var s = AppState.makeInitial()
        s.nodes[.Start]?.completed = true
        s.nodes[.IRA]?.data = .ira(IRAData(type: .roth, ytdContribution: .manual(1000), annualLimit: 7000))
        let data = try JSONCoder.encode(s)

        var obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        var nodes = try #require(obj["nodes"] as? [String: Any])
        var ira = try #require(nodes["IRA"] as? [String: Any])
        ira["data"] = ["annualLimit": "not a number"]   // breaks IRAData decode
        nodes["IRA"] = ira
        obj["nodes"] = nodes

        let mutated = try JSONSerialization.data(withJSONObject: obj)
        let decoded = try JSONCoder.decode(mutated)     // must NOT throw

        #expect(decoded.node(.IRA).data == nil)             // corrupt node reset to default
        #expect(decoded.node(.Start).completed == true)     // unrelated good data survived
    }
}
