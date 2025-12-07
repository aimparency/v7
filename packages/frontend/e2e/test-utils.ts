import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

export interface MockAim {
  id?: string;
  text: string;
  status?: string;
  tags?: string[];
  incoming?: string[];
  outgoing?: string[];
  committedIn?: string[];
}

export interface MockPhase {
  id?: string;
  name: string;
  from?: number;
  to?: number;
  commitments?: string[];
  parent?: string | null;
}

export function seedProject(projectPath: string, data: { phases?: MockPhase[], aims?: MockAim[] }) {
  mkdirSync(join(projectPath, 'aims'), { recursive: true });
  mkdirSync(join(projectPath, 'phases'), { recursive: true });

  // Write Meta
  writeFileSync(join(projectPath, 'meta.json'), JSON.stringify({
    name: 'Test Project',
    color: '#ff0000'
  }, null, 2));

  // Write Phases
  const phaseMap = new Map<string, string>(); // Name -> ID
  
  data.phases?.forEach(p => {
    const id = p.id || randomUUID();
    phaseMap.set(p.name, id);
    
    const phase = {
      id,
      name: p.name,
      from: p.from || Date.now(),
      to: p.to || Date.now() + 1000000,
      parent: p.parent || null,
      commitments: p.commitments || []
    };
    
    writeFileSync(join(projectPath, 'phases', `${id}.json`), JSON.stringify(phase, null, 2));
  });

  // Write Aims
  data.aims?.forEach(a => {
    const id = a.id || randomUUID();
    
    const aim = {
      id,
      text: a.text,
      tags: a.tags || [],
      status: {
        state: a.status || 'open',
        comment: '',
        date: Date.now()
      },
      incoming: a.incoming || [],
      outgoing: a.outgoing || [],
      committedIn: a.committedIn || []
    };

    writeFileSync(join(projectPath, 'aims', `${id}.json`), JSON.stringify(aim, null, 2));
  });
}
