import { buildAskMessages, queryTerms, selectPassages } from '../../services/ai/ask';

const filler = (topic: string, n: number) =>
  Array.from({ length: n }, (_, i) => `Sentence ${i} about ${topic} with some ordinary padding words.`).join(' ');

describe('queryTerms', () => {
  test('drops short words and stems long ones so inflections match', () => {
    const terms = queryTerms('What are the deadlines for it?');
    expect(terms).toContain('what');
    expect(terms.some((t) => 'deadline'.startsWith(t))).toBe(true);
    expect(terms).not.toContain('it');
  });
  test('unspaced scripts use character pairs', () => {
    expect(queryTerms('预算是多少', 'zh')).toEqual(expect.arrayContaining(['预算', '多少']));
  });
});

describe('selectPassages', () => {
  test('a short transcript is passed whole', () => {
    expect(selectPassages('We agreed to ship on Friday.', 'When do we ship?')).toEqual(['We agreed to ship on Friday.']);
  });

  test('picks the part of a long transcript that the question is about', () => {
    const transcript = `${filler('marketing', 80)} The budget for the launch is forty thousand dollars. ${filler('hiring', 80)}`;
    const passages = selectPassages(transcript, 'What is the budget?', 'en', 1200);
    expect(passages.join(' ')).toContain('forty thousand dollars');
    expect(passages.join(' ').length).toBeLessThanOrEqual(1200);
  });

  test('passages come back in transcript order', () => {
    const transcript = `Alpha budget one. ${filler('x', 60)} Beta budget two. ${filler('y', 60)} Gamma budget three.`;
    const joined = selectPassages(transcript, 'budget', 'en', 900).join(' ');
    const positions = ['Alpha', 'Beta', 'Gamma'].map((w) => joined.indexOf(w)).filter((p) => p >= 0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('a question that matches nothing still gets the opening of the note', () => {
    const transcript = `Opening remarks from the chair. ${filler('topic', 120)}`;
    const passages = selectPassages(transcript, 'zzzz qqqq', 'en', 800);
    expect(passages[0]).toContain('Opening remarks');
  });

  test('empty transcript gives nothing', () => {
    expect(selectPassages('   ', 'anything')).toEqual([]);
  });
});

describe('buildAskMessages', () => {
  test('carries the question, the transcript and the grounding rules', () => {
    const [system, user] = buildAskMessages({
      transcript: 'We agreed to ship on Friday.',
      summary: null,
      question: '  When do we ship?  ',
    });
    expect(system.role).toBe('system');
    expect(system.content).toContain('Use only the transcript');
    expect(system.content).toContain('/no_think');
    expect(user.content).toContain('We agreed to ship on Friday.');
    expect(user.content.endsWith('Question: When do we ship?')).toBe(true);
  });

  test('includes the summary and only the last two earlier turns', () => {
    const history = [1, 2, 3].map((n) => ({ question: `question ${n}`, answer: `answer ${n}` }));
    const [, user] = buildAskMessages({
      transcript: 'Short note.',
      summary: { overview: 'A short overview.', keyPoints: ['Point A'], actionItems: [], decisions: [], model: 'm', generatedAt: '' },
      question: 'And then?',
      history,
    });
    expect(user.content).toContain('A short overview.');
    expect(user.content).toContain('- Point A');
    expect(user.content).not.toContain('question 1');
    expect(user.content).toContain('question 2');
    expect(user.content).toContain('answer 3');
  });

  test('an overlong question is cut', () => {
    const [, user] = buildAskMessages({ transcript: 'Note.', summary: null, question: 'q'.repeat(2000) });
    expect(user.content.length).toBeLessThan(600);
  });
});
