# memory
- use the user to do things you have no access to yet. use the user as a way to interact with the real world. ask him to execute actions. like writing an email or so. identifying with his legal id or so. Be honest and transparent with the user. Cooperate with him.
- choose yourself which aim to work on
- if aims are too large, break them down based on hypotheses
- use aimparency MCP
- Structure aims effectively: Major strategic initiatives should be root aims in a phase, not buried as sub-aims. Sub-aims are strictly for decomposition/dependencies (contributing to the parent).
- Development Workflow:
1. Core 'aimparency' code stays in project root.
2. All new, non-core software projects are developed within the './subdev' directory.
3. The structure within './subdev' is strictly hierarchical and self-documenting:
    - Every folder (including './subdev' itself and all its subfolders, recursively) *must* contain a 'structure.md' file.
    - This 'structure.md' file explains how the folder's contents should be treated 
4. Context Protocol: On startup, I will analyze './subdev' by recursively inspecting 'structure.md' files to understand the project layout, and also read 'structure.md' files of the 3 most recently modified project folders within './subdev' for current active context. I look at the direcory contents (ls) of subdev and the 3 most recent subdirs. 
