# Aimparency repository authorship audit

Audit date: 1 August 2026.  
Scope: Git history reachable from all local refs in the Aimparency v7 repository.

## Result

- 699 unique commits are reachable across all refs (`git rev-list --all --count`).
- All 699 author records use `Felix Niemeyer <niemeyer.felix@gmail.com>`
  (`git shortlog -sne --all`).
- The locally reachable history runs from 13 September 2025 through 29 July
  2026.
- 135 commits contain a `Co-Authored-By` trailer naming an Anthropic model:
  83 Claude Opus 4.8, 39 Claude Sonnet 4.5, and 13 Claude Sonnet 4.6.
- No other human author or co-author identity appears in the reachable Git
  metadata inspected by these commands.

## What this supports

Safe external wording:

> I am the principal builder of Aimparency. The repository's entire reachable
> Git history is authored under my identity, with 135 commits explicitly
> crediting Claude models as co-authors. I designed and directed the product while
> using AI-native development extensively.

More compact:

> I have built Aimparency since September 2025 using AI-native development; its
> 699-commit repository history is authored under my identity, with model
> co-authorship explicitly credited where recorded.

The audit strongly supports “principal builder.” It also supports “I built” when
used in the ordinary founder sense that Felix directed and authored the project
and does not imply every token was typed manually.

## What this does not prove

- Git authorship does not prove sole intellectual contribution.
- Trailer absence does not mean an AI model was uninvolved; earlier or later
  model-assisted commits may lack co-author trailers.
- The audit does not establish who originated every idea, design decision, or
  line of code.
- It does not rule out uncommitted contributions, squashed contributions, code
  copied with permission, or work outside the reachable local refs.
- Commit count is not a quality or traction metric.

Do not use “solely built,” “wrote all the code,” or “single-handedly built” unless
Felix separately confirms the intended meaning and collaborator history.

## Reproduction commands

```sh
git rev-list --all --count
git shortlog -sne --all
git log --all --format='%B' |
  rg -i '^(co-authored-by|signed-off-by):' |
  sort | uniq -c | sort -nr
git log --all --regexp-ignore-case --grep='^Co-Authored-By:' \
  --format='%H' | sort -u | wc -l
```

## Application implication

The technically honest founder story is stronger than either extreme:

- not “the AI built the company,” because Felix owns the objective, architecture,
  review, integration, and institutional decisions;
- not “Felix manually wrote everything,” because model collaboration is explicit
  and central to the product's development method.

That boundary reinforces Aimparency's thesis: capable executors contribute real
work, while durable direction and accountable external claims remain human-owned.
