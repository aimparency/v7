# Prototype Fund user-research kit

## Purpose

Test whether open-source maintainers and agent-tool developers experience the
problem described in the application. This is discovery, not a sales call. Do
not count a friendly reaction as evidence, and do not write a quote into the
application without explicit permission.

## Minimum useful cohort

Recruit five people from at least three of these groups:

- maintainers who regularly review AI-assisted contributions;
- developers using more than one coding assistant;
- small teams handing agent work between contributors;
- developers of issue-tracker, planning, Git, or agent integrations.

Avoid filling the cohort entirely with close friends or existing Aimparency
supporters. Record the relationship in the tracker so the evidence stays
legible.

## Short invitation

> I’m testing a problem for an open-source funding application: code survives
> in Git, but the goals, dependencies, and reasoning behind AI-assisted changes
> often do not. Could I ask you about your actual workflow for 25 minutes? This
> is research, not a product pitch. I will not attribute anything publicly
> without asking you first.

## Interview opening

> I’m exploring a Git-native, tool-independent way to retain project intent.
> I want to understand your current practice before showing the idea. There are
> no correct answers. With your permission I’ll take notes. I will ask
> separately before quoting or naming you in an application.

## Questions

Ask for concrete recent events. Do not explain Aimparency until question 9.

1. Tell me about the last AI-assisted change you reviewed or handed to someone
   else. What information existed outside the code diff?
2. Where did the original goal, constraints, and reasoning live?
3. What happened to that context after the change was merged or abandoned?
4. When did an issue or task fail to express why work mattered or how it
   depended on other work?
5. Have you changed coding assistants or combined several? What context had to
   be recreated manually?
6. How do you decide whether an agent’s “done” claim is trustworthy?
7. Which parts of planning data must remain private, and which could safely be
   committed?
8. What have you tried already? Why was it sufficient or insufficient?
9. Show this one-sentence concept only now: “A small open protocol and CLI for
   storing goals, dependencies, rationale, and bounded implementation evidence
   in Git.” What is unclear, unnecessary, or missing?
10. Which existing tool would an adapter need to support before you would test
    this?
11. Would you try an early version in one repository? What would make that
    trial cheap enough, and what would stop you?

## End-of-call permission

Ask each question independently; silence is not consent.

> May I use an anonymous paraphrase of what you said in the application?

> Is there a sentence in my notes you would permit me to quote? I will send the
> exact wording for approval first.

> May I name you or your project as someone willing to test the prototype?

Record `yes`, `no`, or `pending` for each permission. Send any proposed quote
back to the participant verbatim before publication.

## Evidence quality rubric

| Strength | Evidence |
|---|---|
| 0 | General opinion or encouragement without a real example |
| 1 | Concrete workflow/problem example |
| 2 | Repeated problem plus failed or costly workaround |
| 3 | Problem plus explicit willingness to test in a named repository |
| 4 | Written pilot commitment with conditions and responsible person |

Negative evidence is valuable. Record when current GitHub/GitLab issues,
documentation, or chat history already solve the problem. Change the protocol
boundary if the same objection recurs; do not reinterpret rejection as demand.

## Synthesis after five interviews

Summarize only supported claims:

- number of interviews and cohort composition;
- recurring concrete problems and their frequency;
- existing solutions that already work;
- privacy objections;
- requested adapters;
- trial commitments and their conditions;
- changes made to the proposed scope;
- attributable quotes with approval status.

The application should distinguish interviews from repository trials. An
interview is evidence about the problem; it is not evidence that the protocol
works.

## Lightweight pilot commitment

> I’m willing to test an early open-source implementation of the Open Intent
> Protocol in **[repository/project]**, subject to **[conditions]**. This is an
> expression of interest, not a purchase commitment or endorsement. You may
> name **[me/project]** in the Prototype Fund application: **yes/no**.
>
> Name, role, date, preferred contact
