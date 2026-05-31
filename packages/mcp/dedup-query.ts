import { trpc } from './src/client.js';

async function main() {
  const projectPath = '/home/felix/dev/aimparency/v7';
  const threshold = Number(process.env.THRESHOLD ?? '0.88');
  const limit = Number(process.env.LIMIT ?? '60');

  const res: any = await trpc.project.findDuplicates.query({ projectPath, threshold, limit });

  console.log(`threshold=${res.threshold} totalAims=${res.totalAims} totalIndexed=${res.totalIndexed} unindexed=${res.unindexed} pairsFound=${res.pairsFound}`);
  if (res.note) console.log('NOTE:', res.note);
  console.log('');
  for (const p of res.pairs) {
    console.log(`[${p.score}] ${p.aId.slice(0, 8)}  ${p.aText}`);
    console.log(`        ${p.bId.slice(0, 8)}  ${p.bText}`);
    console.log('');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
