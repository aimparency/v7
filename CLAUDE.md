# aimparency
In general, it's for maintaining ideas/aims and reaching them by breaking them down. 

We have a server that's the backend (that can easily be run locally) and
a web app as the UI, that uses the backend api. 

The server reads and creates files (persists stuff). 
It may create indices in memory. 

## storage
Create two directories for those 2 components

the folder structure is based on files, so that it's easy to track it inside a git repository - maybe alongside a project for which the aims are for. 

aim {
  text:string, 
  incoming: uuid[], 
  outgoing: uuid[], 
  status: {
    state:"open"|"done"|"cancelled"|"partially"|"failed"
    comment: string
    date
  }
}

Each new project has a base folder. 

Store aims (incl. status) in basefolder/aims/<aim-uuid> (one file per aim)

beside aims, there are phases: 
Phase {
  from: date, 
  to: date,
  parent: uuid(phase)|null, 
  commitments: uuid(aim)[],
  name: string
}

individually stored as files in basefolder/phases/<phase-uuid>

there is a basefolder/meta.json which contains: 
{
  name: string, 
  color: string, // hex e.g. '#f91238'
}

## UI 
Implement a vi-intuitive way of navigating: 

The UI is structured in Phases. There are two columns of phases. 

### Phase Columns 
The root phase (null) is not really a phase. It contains all aims that are not commited inside any aims. The root phase starts the hierarchy. Phase navigation supports infinite horizontal depth with flexible column count:

Navigation with h/l moves through hierarchy levels, while j/k moves within a column. When reaching phases with no children, show "No sub phases" state and prevent further navigation.
We can't go beyond the root column to the left.
And can't go beyond an empty column (no phases) on the right. 

Each column shows child phases of the selected phase from the previous column.

Smooth CSS transitions animate movement between hierarchy levels  
Render only visible columns + 2 buffer columns for performance

The columns may scroll vertically. Remember scroll position and selected phase for each column level when navigating back through the hierarchy.

Inside the columns we navigate the vertically arranged phases with j down and k up. 

The phase contains the committed aims. Root phase contains all aims that have no committedIn phases and no outgoing aims. 

Performance: Columns are hidden when too far (> 1) off the n columns that are shown on the screen. Selection state and scroll positions are preserved when navigating back to previously visited hierarchy levels. 

'o' or 'O' adds a new phase. the parent is the column left of the current column (we are adding siblings). Open a popup for entering name and choosing start and end date. Start and end date can only be within parent phase start and end(default). 

i key enters a phase (phase edit mode). 

### phase edit mode
Initially the first aim is focused
esc key leaves the phase edit mode. 

Phase aims are always fully visible without scrolling. Aims display status, comment, and text horizontally. Initially all aims are collapsed.

in phase edit mode, j and k moves the focus of an aim (down and up). 
l expands an aim (if it has incoming aims). h collapses an expanded aim. Expanded aims show incoming aims below with progressive indentation. 

'o' creates a new aim below the currently selected, 'O' above. Aims are create on the same level. 

If an aim does not have incoming aims (can't be expanded), l creates an incoming aim to the currently selected aim. 

### aim adding mode
input element for aim text. 
When typing the aim, the system will search for existing aims that can be selected with ctrl+j and ctrl+k

show search results below input

esc cancels, enter creates (new aim or selected search result)

'i' edits an aim: 

### aim edit mode
esc exits aim edit mode. 

an aim has 3 horizontal elements: status, status comment and text. These can be navigated with h and l (left and right)
initially, the text is focused. 
j and k on the status change the status. 
i on the status comment makes the comment editable in a textarea. 
i on the text makes text editable in a textarea. 

esc leaves the editing in textareas. 

### Project selection 
The project (local path to basefolder) is saved in localstorage. 
Initially, the web app prompts the user to enter it. 
Later, there is a narrow header containing: 
server connection status ('connecting', 'no connection', 'connected to', name (if connected)), local path and close project link (leads to entering a new path). 

## Technical choices
Use vite for the UI of the web app. The files should be git-compatible (so that you can check them in to your repository)
Use vi.js for input elements. 

Use Typescript for both components. 

Use tRPC over websockets for client server communication. 
Monorepo setup.

### Frontend Architecture
Use Vue 3 composition API with Pinia for state management. Component-based architecture:
- Phase components are smart components that load their own data via tRPC
- Aim components handle their own expansion/editing state  
- PhaseColumn component is reusable for both left/right columns
- Centralized keyboard navigation through Pinia stores
- UI/Data/Keyboard stores for separation of concerns 

## Future Ideas (not relevant for implementation yet)
### Realtime collaboration
Additionally to git interoperability: 
The backend should be able to deal with multiple clients being able to connect at the same time. E.g. it should allow clients to subscribe to aims and then send updates, if someone changes them. It should prevent overwrites by locking aims (use keep alive lock, otherwise clear lock after 30s) and display a: "someone else is editing this aim right now, try again in a minute" or so.

### Multiple parent aims UI
if an aim is selected and collapsed, h should show all outgoing aims in a popup. There another aim can be created or searched - same as when adding incoming aims. 

### MCP API
for interaction through LLMs

## Answers to open questions

#
- dev servers are always running. no need to start them
- dev servers are usually already running. don't try to start them.