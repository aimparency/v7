import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { AIMPARENCY_DIR_NAME } from 'shared';

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
  childPhaseIds?: string[];
}

export function seedProject(projectPath: string, data: { phases?: MockPhase[], aims?: MockAim[], meta?: { name?: string, color?: string, statuses?: any[], rootPhaseIds?: string[], dataModelVersion?: number } }) {
  const bowmanPath = join(projectPath, AIMPARENCY_DIR_NAME);
  mkdirSync(join(bowmanPath, 'aims'), { recursive: true });
  mkdirSync(join(bowmanPath, 'phases'), { recursive: true });

  // Write Meta
  writeFileSync(join(bowmanPath, 'meta.json'), JSON.stringify({
    name: data.meta?.name || 'Test Project',
    color: data.meta?.color || '#ff0000',
    statuses: data.meta?.statuses || [],
    rootPhaseIds: data.meta?.rootPhaseIds || [],
    dataModelVersion: data.meta?.dataModelVersion ?? 2
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
      childPhaseIds: p.childPhaseIds || [],
      commitments: p.commitments || []
    };
    
    writeFileSync(join(bowmanPath, 'phases', `${id}.json`), JSON.stringify(phase, null, 2));
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
      supportingConnections: (a.incoming || []).map(childId => ({ 
        aimId: childId, 
        weight: 1, 
        relativePosition: [0, 0] 
      })),
      supportedAims: a.outgoing || [],
      committedIn: a.committedIn || []
    };

    writeFileSync(join(bowmanPath, 'aims', `${id}.json`), JSON.stringify(aim, null, 2));
  });
}
