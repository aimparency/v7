# aimparency
Maintaining ideas/aims and reaching them by breaking them down.

Server (backend) + web app (UI) using backend API. Server persists to files, may create in-memory indices.

## Storage
File-based structure for git compatibility alongside projects.

```
aim {
  text: string,
  incoming: uuid[],
  outgoing: uuid[],
  status: {
    state: "open"|"done"|"cancelled"|"partially"|"failed",
    comment: string,
    date: number
  }
}

Phase {
  from: date,
  to: date,
  parent: uuid(phase)|null,
  commitments: uuid(aim)[],
  name: string
}
```

- basefolder/aims/<aim-uuid> (one file per aim)
- basefolder/phases/<phase-uuid> (one file per phase)
- basefolder/meta.json: { name: string, color: string }

## UI
Vi-intuitive navigation with infinite horizontal depth, flexible column count.

### Column Architecture
- **Column 0**: Root aims (uncommitted aims: no phase AND no outgoing aims)
- **Column 1+**: Phase columns via Vue Teleport - each selected phase owns/renders its child column
- **Navigation**: h/l moves between columns, j/k within columns
- **Bounds**: Can't go left of column 0, can't go right beyond empty columns
- **Viewport**: Shows 2 columns, CSS transforms for smooth scrolling
- **Performance**: Only visible + buffer columns rendered

### Phase Navigation
- j/k: Navigate phases vertically
- i: Enter phase edit mode
- o/O/Enter: Create new phase (modal with name, dates)
- l: Navigate to child column (if phases exist)
- h: Navigate to parent column 

### Phase Edit Mode
- **Entry**: i key, focuses first aim
- **Exit**: Esc key or j/k navigation leaving phase bounds
- **Aim Navigation**: j/k moves between aims, exits phase when reaching bounds
- **Aim Creation**: o (below), O (above) current aim
- **Expansion**: l expands aim (shows incoming), h collapses
- **Sub-aim Management** (future):
  - Shift+h/l: Change aim indentation
  - Shift+j/k: Move up/down within same indent level 

### Aim Adding Mode
- Input field with live search for existing aims
- Ctrl+j/k: Navigate search results
- Enter: Create new or select existing aim
- Esc: Cancel

### Aim Edit Mode
- i: Edit individual aim
- h/l: Navigate between status, comment, text
- j/k: Change status values
- i: Make comment/text editable
- Esc: Exit editing

### Project Selection
- LocalStorage persistence of project path
- Initial prompt for folder selection
- Header shows: connection status, project path, close project link 

## Technical Stack
- **Frontend**: Vite + Vue 3 Composition API + Pinia + TypeScript
- **Backend**: TypeScript + tRPC over WebSockets
- **Architecture**: Monorepo with git-compatible file storage
- **Input**: vi.js for enhanced input elements (future)

### Frontend Architecture
- **Vue Teleport**: Phase components own/render child columns
- **Smart Components**: Phases load their own data via tRPC
- **State Management**: Pinia stores (UI/Data separation)
- **Template Refs**: Direct component method calls (no DOM queries) 

## Future Ideas
- **Realtime collaboration**: Multi-client support with aim locking (keep-alive with 30s timeout)
- **Multiple parent aims**: h on collapsed aim shows outgoing aims popup
- **MCP API**: LLM interaction support

## Development Notes
- Dev servers are always running - don't start them