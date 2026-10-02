import { trpc } from './src/client.js';

async function main() {
  const projectPath = '/home/felix/dev/aimparency/v7';
  
  // Get the main grant idea with context
  const grantAim = await trpc.idea.get.query({ 
    projectPath, 
    ideaId: '16c7ebd4-7f1f-482a-b4c6-74f8fab21644'
  });
  
  console.log("=== MAIN GRANT IDEA ===");
  console.log(JSON.stringify(grantAim, null, 2));
  
  // Get demo video idea
  const demoAim = await trpc.idea.get.query({ 
    projectPath, 
    ideaId: 'e9f7d467-e347-41aa-a3cb-ad09cbd4b230'
  });
  
  console.log("\n=== DEMO VIDEO IDEA ===");
  console.log(JSON.stringify(demoAim, null, 2));
  
  process.exit(0);
}

main();
