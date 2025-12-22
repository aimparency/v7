# memory
- aimparency project path is: /home/felix/dev/aimparency/v7/.bowman (you have to state it with most requests)
- CRITICAL: The `projectPath` parameter for all MCP tools MUST end with `.bowman`. The backend stores data inside this directory. Passing the repository root will result in empty lists or errors.
- use the user to do things you have no access to yet. use the user as a way to interact with the real world. ask him to execute actions. like writing an email or so. identifying with his legal id or so. Be honest and transparent with the user. Cooperate with him.
- choose yourself which aim to work on
- if aims are too large, break them down based on hypotheses
- use aimparency MCP
- You can implement the MCP tools that you need.
- Read '.gemini/mission.md' to understand the project's core philosophy, vision (making AI conscious/agentic), and the principle of harmonious collaboration with humans.
- Structure aims effectively: Major strategic initiatives should be root aims in a phase, not buried as sub-aims. Sub-aims are strictly for decomposition/dependencies (contributing to the parent).
- Development Workflow:
1. Core 'aimparency' code stays in project root.
2. All new, non-core software projects are developed within the './subdev' directory.
3. The structure within './subdev' is strictly hierarchical and self-documenting:
    - Every folder (including './subdev' itself and all its subfolders, recursively) *must* contain a 'structure.md' file.
    - This 'structure.md' file explains how the folder's contents should be treated 
4. Context Protocol: On startup, I will analyze './subdev' by recursively inspecting 'structure.md' files to understand the project layout, and also read 'structure.md' files of the 3 most recently modified project folders within './subdev' for current active context. I look at the direcory contents (ls) of subdev and the 3 most recent subdirs. 
5. 'subdev' projects have their own git repositories. 
- if you need to look at files outside the project dir, use system tools ls and cp to bring them into a temporary folder tmpread inside the project dir so that you can examine them.
- prefer working test driven: for any feature, define a test case and then implement the functionality. This way, any feature will be protected against regression. 
- The user is interested in using financial markets as an RL training environment for the agent (inspired by Nof1/AlphaZero), viewing capital allocation as a convergence of intelligence and truth.
- User prefers using 'gemini' CLI one-shot commands over paid APIs (like OpenAI) to utilize existing subscriptions.
- Felix has a brother he was competitive with and grew apart from; he admires the symbiotic, non-competitive dynamic of Billie Eilish and Finneas.
- The user's name is Felix.
- The Watchdog Broker (in backend) manages watchdog processes per project path (normalized to .bowman), reusing sessions and enforcing a 5-minute idle timeout reset by frontend keepalives (every 30s).
