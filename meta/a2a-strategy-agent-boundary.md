# Aimparency as an A2A strategy and intent agent

Status: architecture decision, 23 July 2026
Protocol reference: A2A specification 1.0

## Decision

Aimparency should be able to participate in an A2A network as the agent that
preserves human intent, explains priorities, proposes bounded work, and
reconciles returned evidence. It should not become a universal orchestrator or
replace specialist agents' runtimes.

This is a good architectural fit but not yet a product priority. The first
operator pilot remains the demand test. We implement an A2A surface only when a
real workflow or a credible deploying peer supplies a concrete interoperability
case.

## Protocol boundary

MCP and A2A serve different relationships:

- **MCP:** an Aimparency-controlled model or coding assistant invokes local graph
  tools.
- **A2A:** an independent peer discovers the Aimparency agent, exchanges
  messages, manages longer-running work, and receives artifacts without seeing
  Aimparency's internal memory or tools.

The official A2A 1.0 model provides the needed primitives: an Agent Card for
discovery, skills for focused capabilities, messages for interaction, tasks for
stateful work, and artifacts for results. It supports JSON-RPC, HTTP+JSON/REST,
and gRPC interfaces. Aimparency should initially expose one interface, not three.

## Initial Agent Card

Name: `Aimparency Strategy Agent`

Description:

> Preserves owner-governed intent in an inspectable aim graph, explains current
> priorities, proposes bounded delegations, and reconciles evidence returned by
> specialist agents.

Candidate skills:

1. `explain-strategy-context`
   - Input: an aim, decision, or proposed task.
   - Output: relevant mission path, dependencies, constraints, human gates, and
     evidence gaps.
   - Read-only.
2. `propose-bounded-work`
   - Input: desired outcome and specialist capability.
   - Output: a transient work proposal with success evidence, limits, stop
     conditions, and authority requirements.
   - Does not persist graph changes without approval.
3. `reconcile-work-evidence`
   - Input: returned artifact, task outcome, costs, and provenance.
   - Output: a proposed status/reflection update and any newly discovered aims.
   - Does not mark work complete solely because the remote agent says it is.

Default input and output should be structured JSON plus human-readable text.
Internal aim IDs may be shared only when the caller is authorized for that
project.

## Delegation contract

An outgoing delegation contains:

- the bounded outcome, not the whole mission;
- relevant context minimized to what the specialist needs;
- success evidence and rejection criteria;
- budget, time, data, and action limits;
- decisions reserved for humans;
- provenance and correlation identifiers;
- cancellation and timeout behavior.

Returned work is evidence, not truth. Aimparency verifies it against the
authoritative system, records real cost, and either proposes acceptance, requests
more input, rejects it, or escalates to the named human authority.

## Security and trust

- Treat Agent Cards, skill descriptions, messages, files, and structured parts
  as untrusted input; they can contain prompt injection.
- Never publish credentials, private graph content, internal prompts, or broad
  filesystem/tool descriptions in an Agent Card.
- Use HTTPS and explicit authentication before exposing non-public project
  context.
- Keep graph writes and external actions behind project-scoped authority.
- Persist task provenance, remote agent identity, declared protocol version,
  costs, and verification result.
- Do not infer trust from protocol compatibility. Signatures, reputation, and
  settlement can strengthen identity or accountability later but do not replace
  authorization or outcome verification.

## Smallest useful implementation

Do not begin with remote execution. The first product slice, when justified, is:

1. a generated, schema-validated Agent Card;
2. one authenticated, read-only `explain-strategy-context` skill;
3. one fixture peer and protocol conformance test;
4. an audit record proving what context was disclosed.

Only add proposal persistence and outbound delegation after the read-only slice
is used by a real peer. Only add push notifications, multiple transports,
payments, registries, or reputation when an observed workflow requires them.

## Activation evidence

Start implementation when either:

- a qualified customer workflow needs Aimparency to coordinate an independently
  operated specialist agent; or
- a credible multi-agent deployer agrees to a concrete exchange with named
  inputs, outputs, authentication, and a test date.

Boardy proposed Shawn Kibet and Roland Ringgenberg as possible peer exchanges.
Those descriptions and their deployment relevance still require direct
validation; an introduction is not market evidence.

## Sources

- A2A Protocol Specification 1.0:
  https://a2a-protocol.org/latest/specification/
- Official protocol repository:
  https://github.com/a2aproject/A2A
- Official JavaScript SDK:
  https://github.com/a2aproject/a2a-js
