import readline from 'node:readline';

// Terminal questions for the setup and the accounts CLI. Answers are read as
// lines, so piped input (tests, scripts) works the same as typing.
let reader;
let lines;

function nextLine() {
  if (!reader) {
    reader = readline.createInterface({ input: process.stdin, terminal: false });
    lines = reader[Symbol.asyncIterator]();
  }
  return lines.next().then(({ value, done }) => {
    if (done) throw new Error('No answer: input ended.');
    return value;
  });
}

export function closeQuestions() {
  reader?.close();
  reader = undefined;
}

export async function ask(question, fallback = '') {
  process.stdout.write(fallback ? `${question} [${fallback}] ` : `${question} `);
  return (await nextLine()).trim() || fallback;
}

export async function askYesNo(question, fallback = false) {
  const answer = (await ask(`${question} (${fallback ? 'Y/n' : 'y/N'})`)).toLowerCase();
  return answer ? answer.startsWith('y') : fallback;
}

// Typed without echo in a terminal.
export async function askHidden(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question} `);
    const value = await nextLine();
    process.stdout.write('\n');
    return value;
  }
  closeQuestions();
  process.stdout.write(`${question} `);
  const { stdin } = process;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\r' || char === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on('data', onData);
  });
}

export async function askNewPassword(who) {
  for (;;) {
    const password = await askHidden(`Password for ${who} (8+ characters):`);
    if (password.length < 8) {
      console.log('Too short.');
      continue;
    }
    if (await askHidden('Again:') === password) return password;
    console.log('The two did not match.');
  }
}
