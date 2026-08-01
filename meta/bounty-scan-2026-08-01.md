# Public open-source bounty scan — 1 August 2026

Aim: `a1641a4c-4dd3-4e45-8c0b-befd59b22f17`

## Result

No candidate qualifies for an implementation attempt today. The scan found many
search-visible offers, but current primary pages showed them closed, paid,
archived, empty, security-sensitive, hardware-dependent, or missing explicit
current payment and acceptance evidence. Recommending one anyway would optimize
for activity rather than expected cleared value.

No issue was claimed, commented on, forked, or submitted. No platform terms were
accepted and no payment identity was used.

## Selection model

`expected net value/day = (reward × acceptance probability - compute - expected rework) / (work days + payment-delay days)`

Candidates without a verified current reward, open assignment path, acceptance
test, and payout path receive no numeric EV. Costs below are planning estimates,
not incurred spend. “Responsive” means the current primary page shows recent
maintainer/program activity; it is not inferred from repository popularity.

| # | Repository / issue | Bounty / payer | License | Assignment and acceptance | Responsive | P(accept) | Est. cost / delay | Decision and risk |
|---|---|---|---|---|---|---:|---|---|
| 1 | `projectdiscovery/nuclei-templates` open 💎 query | ProjectDiscovery, $50–250 program range | MIT | No open results on current label query; templates require a complete PoC and testable vulnerable setup | Program active | — | >€10 / unknown | Reject: no current issue; security work exceeds first-attempt risk policy |
| 2 | `projectdiscovery/nuclei` open `bounty` query | ProjectDiscovery, issue-specific | MIT | No open results on current label query | Program active | — | — | Reject: no issue to claim |
| 3 | `projectdiscovery/nuclei-templates#10897` | $200 / ProjectDiscovery via Algora | MIT | Search-visible historic claim flow; reward already recorded and issue is not a clean unclaimed opportunity | Historic activity | 0 | — | Reject: already rewarded / competition history |
| 4 | `TraceMachina/nativelink#1325` | Historic $1,000 easy-mode claim | Apache-2.0 | Current issue page says closed as not planned | Closed | 0 | — | Reject: closed |
| 5 | `TraceMachina/nativelink#1108` | Historic $5,000 hard-mode claim | Apache-2.0 | Current issue is closed | Closed | 0 | — | Reject: closed and oversized Rust task |
| 6 | `tenstorrent/tt-metal#41029` | $10,000 / Tenstorrent | Apache-2.0 | Current project field says “Bounty Paid”; issue closed | Closed/paid | 0 | — | Reject: already paid; specialist hardware required |
| 7 | `tari-project/tari#7795` | 15,000 XTM / Tari | BSD-3-Clause | Explicit cross-platform acceptance criteria, but current page says closed | Closed | 0 | — | Reject: closed; Ledger hardware and crypto payout required |
| 8 | `rohitdash08/FinMind#144` | $1,000 / repository sponsor | Repository page | Open label remains, but repository was archived 19 Jun 2026 and is read-only | None possible | 0 | — | Reject: archived |
| 9 | `rohitdash08/FinMind#133` | $250 / repository sponsor | Repository page | Open label remains; repository archived/read-only | None possible | 0 | — | Reject: archived |
| 10 | `rohitdash08/FinMind#132` | $200 / repository sponsor | Repository page | Open label remains; repository archived/read-only | None possible | 0 | — | Reject: archived |
| 11 | FinMind “background job retry & monitoring” | $250 / repository sponsor | Repository page | Listed by current issue query, but repository archived/read-only | None possible | 0 | — | Reject: archived |
| 12 | `calcom/cal.com#10811` | $50 / Cal.com via Algora | AGPL-3.0 | Historic OSShack bounty; page carries rewarded label and prior attempts | Historic only | 0 | — | Reject: already rewarded/stale |
| 13 | `remirror#952` | Historic $150 aggregate | MIT | Only a 2023 community gist asserts “open”; no current primary bounty evidence | Unknown | — | — | Reject: stale secondary listing |
| 14 | `remirror#942` | Historic $150 aggregate | MIT | Only a 2023 community gist; no verified current payer/claim | Unknown | — | — | Reject: stale secondary listing |
| 15 | `remirror#872` | Historic $150 aggregate | MIT | Only a 2023 community gist; no verified current payer/claim | Unknown | — | — | Reject: stale secondary listing |
| 16 | `remirror#845` | Historic $150 aggregate | MIT | Only a 2023 community gist; no verified current payer/claim | Unknown | — | — | Reject: stale secondary listing |
| 17 | `remirror#876` | Historic $150 aggregate | MIT | Only a 2023 community gist; no verified current payer/claim | Unknown | — | — | Reject: stale secondary listing |
| 18 | `remirror#1251` | Historic $150 aggregate | MIT | Only a 2023 community gist; no verified current payer/claim | Unknown | — | — | Reject: stale secondary listing |
| 19 | `remirror#995` | Historic $150 aggregate | MIT | Only a 2023 community gist; no verified current payer/claim | Unknown | — | — | Reject: stale secondary listing |
| 20 | GitHub public bug bounty | $617+ / GitHub | N/A | Active program with explicit rules, but requires vulnerability research and private disclosure rather than a bounded OSS patch | Active | — | >€10 / unknown | Reject: prohibited/high-risk security domain for the first compute-earner attempt |

## Current primary evidence

- [ProjectDiscovery program](https://github.com/projectdiscovery/oss-bounty-program) and [template bounty rules](https://github.com/projectdiscovery/nuclei-templates/blob/main/Templates-Bounty-FAQ.md)
- [Current nuclei-template bounty query](https://github.com/projectdiscovery/nuclei-templates/issues?q=is%3Aissue+state%3Aopen+label%3A%22%F0%9F%92%8E+Bounty%22)
- [Current nuclei bounty query](https://github.com/projectdiscovery/nuclei/issues?q=is%3Aissue+state%3Aopen+label%3Abounty)
- [NativeLink #1325](https://github.com/TraceMachina/nativelink/issues/1325) and [#1108](https://github.com/TraceMachina/nativelink/issues/1108)
- [Tenstorrent #41029](https://github.com/tenstorrent/tt-metal/issues/41029)
- [Tari #7795](https://github.com/tari-project/tari/issues/7795)
- [FinMind current bounty query](https://github.com/rohitdash08/FinMind/issues?q=is%3Aissue+state%3Aopen+label%3A%22%F0%9F%92%8E+Bounty%22)
- [GitHub bounty rules](https://bounty.github.com/rules.html), [rewards](https://bounty.github.com/rewards), and [ineligible reports](https://bounty.github.com/ineligible.html)

Discovery-only sources used to find candidates, never to establish current
eligibility: [awesome-bounties](https://github.com/JuanM94/awesome-bounties),
[bounty-radar](https://github.com/JuanM94/bounty-radar), and the
[historic Remirror list](https://gist.github.com/ronnyroeller/72e1b392bb7d1dec4c64d7dca89269e4).

## Next autonomous scan rule

Repeat the scan from live primary issue pages. Recommend the first candidate
that is simultaneously open, explicitly paid, unclaimed or competitively open,
licensed, locally testable without specialist hardware or private systems,
plausibly completable below €10 compute, and covered by a legitimate payout
path. Until then, retain “no attempt” rather than substituting an old listing.
