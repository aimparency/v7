# Demo Teleprompter

Target duration: 2:35. Read naturally; pauses are already budgeted.

We gave our goal-management system one very concrete goal: win the hackathon
judging goal-management systems. This application is the experiment. If the
jury says “it won,” the jury supplies the external proof.

Aimparency is a local-first graph where humans express aims and AI helps
realize them while humans remain the final authority. Goals, supporting aims,
phases, and repository dependencies live beside the code.

GPT-5.6 in Codex queried Aimparency through MCP, followed the aim to its root
goal, selected actionable work, and preserved steps requiring human judgment.
Felix chose the wager and acceptance condition; Codex executed.

Now, when a commit references an aim UUID prefix, the aim view reads the real
Git history and shows that implementation evidence beside its dependency
context. We can see what we intended, what supported it, and the exact code
output that realized it.

The extension has focused backend and interface tests, production build
verification, and a dated commit. The repository clearly separates the
pre-existing product from the work created during Build Week.

The small loop closes at the commit. The larger loop closes with you, the
jury. Aimparency gives human intention durable structure, gives Codex the why,
and lets reality judge the outcome. So: did it work?

