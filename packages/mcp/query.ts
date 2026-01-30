import { trpc } from './src/client.js';

async function main() {
  const projectPath = '/home/felix/dev/aimparency/v7';
  
  // Get the main grant aim with context
  const grantAim = await trpc.aim.get.query({ 
    projectPath, 
    aimId: '16c7ebd4-7f1f-482a-b4c6-74f8fab21644'
  });
  
  console.log("=== MAIN GRANT AIM ===");
  console.log(JSON.stringify(grantAim, null, 2));
  
  // Get demo video aim
  const demoAim = await trpc.aim.get.query({ 
    projectPath, 
    aimId: 'e9f7d467-e347-41aa-a3cb-ad09cbd4b230'
  });
  
  console.log("\n=== DEMO VIDEO AIM ===");
  console.log(JSON.stringify(demoAim, null, 2));
  
  process.exit(0);
}

main();
