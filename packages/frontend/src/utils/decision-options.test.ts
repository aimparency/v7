import { describe, it, expect } from 'vitest'
import { decide, decisionOptions } from './decision-options'
import type { Idea } from '../stores/data'

const idea = (id: string, state: string, comment = '', children: string[] = []) =>
  ({ id, text: id, archived: false, status: { state, comment, date: 1 }, supportingConnections: children.map(ideaId => ({ ideaId })) }) as unknown as Idea

describe('decisionOptions', () => {
  it('offers the prepared proposals first, then what fits the state', () => {
    const ideas = {
      question: idea('question', 'unclear', 'Which one?', ['first', 'second', 'work']),
      first: idea('first', 'ai-proposition'),
      second: idea('second', 'ai-proposition'),
      work: idea('work', 'open')
    }
    expect(decisionOptions(ideas.question, ideas).map(option => option.label)).toEqual(['first', 'second', 'Answer…', 'Drop'])
    expect(decisionOptions(idea('blocked', 'human-dependent'), ideas).map(option => option.kind)).toEqual(['done', 'reply', 'drop'])
    expect(decisionOptions(idea('built', 'review'), ideas).map(option => option.kind)).toEqual(['accept', 'reply', 'drop'])
  })
})

describe('decide', () => {
  it('opens the chosen proposal, turns down the others and hands the question back with the choice', () => {
    const ideas = {
      question: idea('question', 'unclear', 'Which one?', ['first', 'second']),
      first: idea('first', 'ai-proposition'),
      second: idea('second', 'ai-proposition')
    }
    const [, second] = decisionOptions(ideas.question, ideas)
    expect(decide(ideas.question, second!, ideas).map(change => [change.ideaId, change.status.state, change.status.comment])).toEqual([
      ['question', 'open', 'Chosen: second\n\nWhich one?'],
      ['first', 'cancelled', 'Not chosen; the human picked "second".'],
      ['second', 'open', 'Chosen by the human.']
    ])
  })

  it('keeps the evidence when accepting and puts an answer in front of the question', () => {
    const built = idea('built', 'review', 'tests pass')
    expect(decide(built, { kind: 'accept', label: 'Accept' }, {})[0]!.status).toEqual({ state: 'implemented', comment: 'tests pass', date: 1 })

    const question = idea('question', 'unclear', 'Which one?')
    expect(decide(question, { kind: 'reply', label: 'Answer…', placeholder: '' }, {}, ' the second ')[0]!.status.comment)
      .toBe('Answer: the second\n\nWhich one?')
    expect(decide(question, { kind: 'drop', label: 'Drop' }, {})[0]!.status.state).toBe('cancelled')
  })
})

describe('a standalone proposal', () => {
  it('is taken up as open work or dropped', () => {
    const proposal = idea('proposal', 'ai-proposition', 'Worth it?')
    const options = decisionOptions(proposal, {})
    expect(options.map(option => option.label)).toEqual(['Take it up', 'Answer…', 'Drop'])
    expect(decide(proposal, options[0]!, {})[0]!.status).toEqual({ state: 'open', comment: 'Taken up by the human.\n\nWorth it?', date: 1 })
  })
})
